const throng = require('throng');
require('util').inspect.defaultOptions.depth = null;
const R = require('ramda');
const { queue, saveResult } = require('./queue');
const bookingsControllerFactory = require('../controllers/bookings');
const mainAxios = require('axios'); // Generic axios instance for direct calls

const workers = process.env.WEB_CONCURRENCY || 2;
const maxJobsPerWorker = process.env.MAX_JOBS_PER_WORKER || 1;

const worker = ({ plugins: pluginsParam }) => { // pluginsParam are instantiated plugins
  // Initialize bookingsCtrl once per worker instance using the passed instantiated plugins.
  const bookingsCtrl = bookingsControllerFactory(pluginsParam);

  return (id, disconnect) => {
    console.log(`Started worker ${id}`);

    const bye = () => {
      console.log(`Worker ${id} exiting`);
      disconnect();
      // Graceful shutdown of the queue connection
      queue.close().then(() => process.exit(0)).catch(() => process.exit(1));
    };

    process.on('SIGTERM', bye);
    process.on('SIGUSR2', bye);
    process.on('SIGINT', bye); // Good for local development

    queue.process(maxJobsPerWorker, async job => {
      const {
        data, // Full job.data object
        id: jobId,
      } = job;

      // Destructure from data for clarity and to match existing patterns
      const {
        type = 'plugin',        // Default job type if not specified
        pluginName,             // Name of the plugin context for the job
        inTesting,              // Flag if running in a testing environment
        payload: jobDataPayload, // This is job.data.payload (e.g., { methodName: '...', args: {...} } or other plugin args)
        method: jobDataMethod,   // This is job.data.method (e.g., 'searchProducts' for generic plugin calls)
                                // Note: 'token' can also be a top-level property in data (data.token)
      } = data;

      let resultValue; // This will be set by all job type handlers
      const jobLog = msg => console.log(`job ${jobId} (type: ${type}, plugin: ${pluginName || 'N/A'}) > `, msg);
      const jobErr = msg => console.error(`job ${jobId} (type: ${type}, plugin: ${pluginName || 'N/A'}) > `, msg);
      jobLog(`started`);

      try {
        if (type === 'api') {
          // params is job.data, so data.method, data.url etc. are correct here
          jobLog(`running method ${data.method} ${data.url}`);
          let code, result, server;
          const http = require('http');
          const axios = require('axios'); // Local axios for API call type
          try {
            const app = await require('../index')({
              pluginsInstantiated: pluginsParam, // Pass the already instantiated plugins
              startServer: false,
              worker: false,
            });

            server = http.createServer(app);
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const { address, port } = server.address();
            const baseURL = `http://${address}:${port}`;
            jobLog(`Worker internal server for job ${jobId} listening on: ${baseURL}`);

            // data.payload is the payload for the API call job type
            const { token: jwtTokenForHeader, ...requestBodyForWorker } = data.payload || {};

            const requestHeaders = {
              ...R.omit(['content-length', 'host', 'connection', 'accept-encoding'], data.headers),
              ...(jwtTokenForHeader ? { Authorization: `Bearer ${jwtTokenForHeader}` } : {})
            };

            const response = await axios({
              method: data.method.toLowerCase(),
              url: `${baseURL}${data.url}`,
              data: R.omit(['backgroundJob'], requestBodyForWorker),
              headers: requestHeaders,
              validateStatus: () => true,
            });

            code = response.status;
            result = response.data;
            jobLog(`Worker internal request for job ${jobId} completed with code ${code}`);
          } catch (error) {
            jobErr(`Worker internal request error for job ${jobId}: ${error.message}`);
            code = R.pathOr(500, ['response', 'status'], error);
            result = R.pathOr({ message: error.message }, ['response', 'data'], error);
          } finally {
            if (server) {
              await new Promise(resolve => server.close(resolve));
              jobLog(`Worker internal server for job ${jobId} closed.`);
            }
          }
          resultValue = { code, result, success: code >= 200 && code < 300 };

        } else if (type === 'callback') {
          const { callbackUrl, request, result } = jobDataPayload; // jobDataPayload is job.data.payload
          jobLog(`sending callback to ${callbackUrl}`);
          await require('../lib/callback').sendCallback({
            callbackUrl,
            request,
            result,
          });
          resultValue = { success: true };

        } else if (type === 'plugin') {
          // jobDataPayload is job.data.payload
          // jobDataMethod is job.data.method (for generic plugin calls)

          // Check for our specific controller-level background task
          if (jobDataPayload && jobDataPayload.methodName === '$bookingsProductSearchInternal') {
            jobLog(`Processing via bookingsCtrl.$bookingsProductSearchInternal`);
            
            const controllerArgs = jobDataPayload.args;
            if (!controllerArgs) {
              throw new Error('$bookingsProductSearchInternal job is missing "args" in its payload');
            }

            // Ensure appKey from args matches pluginName from job data if pluginName is used for context
            if (pluginName && controllerArgs.appKey !== pluginName) {
                jobErr(`Job data pluginName (${pluginName}) mismatch with args.appKey (${controllerArgs.appKey}). Using args.appKey for plugin context.`);
            }

            const executionPayload = {
              ...controllerArgs, // Contains appKey, userId, hint, payload (for $bps), headers
              axios: mainAxios,  // Provide the worker's generic axios instance
              requestId: jobId,  // Use job ID for tracing
              // plugins are already available to bookingsCtrl via its factory initialization
            };
            
            resultValue = await bookingsCtrl.$bookingsProductSearch(executionPayload);
            jobLog(`bookingsCtrl.$bookingsProductSearchInternal completed.`);

          } else {
            // Handle generic plugin method call
            jobLog(`Processing plugin method: ${jobDataMethod} for plugin ${pluginName}`);
            
            const currentJobPlugins = await (async () => {
              if (inTesting) {
                const fakePlugin = require('../test/plugin');
                const FakePluginClass = fakePlugin.default || fakePlugin;
                return [...pluginsParam, new FakePluginClass({ name: pluginName })];
              }
              return pluginsParam;
            })();

            const thePlugin = currentJobPlugins.find(({ name }) => name === pluginName);

            if (!thePlugin) {
              throw new Error(`Plugin ${pluginName} not found for job ${jobId}.`);
            }
            if (!jobDataMethod || typeof thePlugin[jobDataMethod] !== 'function') {
              throw new Error(`Method ${jobDataMethod} not found or not a function on plugin ${pluginName} for job ${jobId}.`);
            }

            // Execute the plugin method
            const pluginMethodResult = await thePlugin[jobDataMethod]({
              ...(jobDataPayload || {}), // Spread job.data.payload (e.g., contains inner 'payload' and 'userId')
              token: data.token,         // Pass job.data.token
              plugins: currentJobPlugins,
              typeDefsAndQueries: require('../controllers/bookings').typeDefsAndQueries, // As per existing pattern
              axios: mainAxios,          // Inject worker's axios instance
              requestId: jobId,          // Inject job ID as requestId
            });
            
            jobLog(`Plugin method ${jobDataMethod} for ${pluginName} completed.`);
            resultValue = pluginMethodResult; // The primary result of the job is the plugin's output

            // Post-processing step
            if (data.postProcess) {
              jobLog(`Initiating post-processing step: ${data.postProcess.controller}.${data.postProcess.action}`);
              if (data.postProcess.controller === 'bookings' && bookingsCtrl[data.postProcess.action]) {
                await bookingsCtrl[data.postProcess.action]({
                  ...(data.postProcess.args || {}), // Spread static args from job data
                  pluginResult: pluginMethodResult, // Pass the dynamic result from the plugin
                  requestId: jobId,                 // Pass job ID for tracing in post-process
                  // 'plugins' are already part of bookingsCtrl via its factory
                });
                jobLog(`Post-processing step ${data.postProcess.action} completed for job ${jobId}.`);
              } else {
                jobErr(`Post-processing action ${data.postProcess.action} on controller ${data.postProcess.controller} not found or controller not supported for job ${jobId}.`);
                // Depending on requirements, this could throw an error to fail the job
              }
            }
          }
        } else {
          jobErr(`Unknown job type: ${type} for job ${jobId}`);
          throw new Error(`Unknown job type: ${type} for job ${jobId}`);
        }

        jobLog(`completed`);
        await saveResult({ id: jobId, resultValue });

      } catch (error) {
        jobErr(`Processing failed: ${error.message}`);
        console.error(error.stack); // Log full stack for debugging
        throw error; // Re-throw to mark job as failed in Bull
      }
    });
  };
};

module.exports = async args => throng({
  workers,
  worker: worker(args),
  signals: ['SIGUSR2', 'SIGTERM', 'SIGINT'],
});
