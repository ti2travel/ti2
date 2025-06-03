const throng = require('throng');
require('util').inspect.defaultOptions.depth = null;
const R = require('ramda');
const { queue, saveResult } = require('./queue');

const workers = process.env.WEB_CONCURRENCY || 2;
const maxJobsPerWorker = process.env.MAX_JOBS_PER_WORKER || 1;

const worker = ({ plugins: pluginsParam }) => (id, disconnect) => {
  console.log(`Started worker ${id}`);

  const bye = () => {
    console.log(`Worker ${id} exiting`);
    disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', bye);
  process.on('SIGUSR2', bye);
  process.on('SIGINT', bye);

  queue.process(maxJobsPerWorker, async job => {
    const {
      data: {
        type = 'plugin',
        pluginName,
        inTesting,
        payload = {}
      },
      id: jobId,
      data: params,
    } = job;
    let resultValue;
    const jobLog = msg => console.log(`job ${jobId} > `, msg)
    const jobErr = msg => console.error(`job ${jobId} > `, msg)
    jobLog(`of type ${type} started`);
    if (type === 'api') {
      const {
        method,
        url,
        payload,
        headers,
      } = params;
      jobLog(`running method ${method} ${url}`)

      let code, result, server;
      const http = require('http');
      const axios = require('axios');
      try {
        const app = await require('../index')({
          pluginsInstantiated: pluginsParam,
          startServer: false,
          worker: false,
        });

        // Manually start server on random port
        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); 
        const { address, port } = server.address();
        const baseURL = `http://${address}:${port}`;
        jobLog(`Worker internal server for job ${jobId} listening on: ${baseURL}`);

        // Extract token and body from payload
        const { token, body } = payload || {};
        const requestHeaders = {
          ...R.omit(['content-length'], headers),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        // Use axios to make the request
        const response = await axios({
          method: method.toLowerCase(),
          url: `${baseURL}${url}`,
          data: R.omit(['backgroundJob'], payload),
          headers: requestHeaders,
          validateStatus: () => true, // Prevent axios from throwing on non-2xx status
        });

        code = response.status;
        result = response.data;
        jobLog(`Worker internal request for job ${jobId} completed with code ${code}`);
      } catch (error) {
        // Handle errors during app init or axios request
        jobErr(`Worker internal request error for job ${jobId}:`, error.message);
        // If axios error has response, use its status
        code = R.pathOr(500, ['response', 'status'], error);
        result = R.pathOr({ message: error.message }, ['response', 'data'], error);
      } finally {
        // Ensure server is closed if it was created
        if (server) {
          await new Promise(resolve => server.close(resolve));
          jobLog(`Worker internal server for job ${jobId} closed.`);
        }
      }
      resultValue = {
        code,
        result,
        success: code >= 200 && code < 300,
       };
    } else if (type === 'callback') {
      const {
        callbackUrl,
        request,
        result,
      } = payload;
      jobLog(`job ${jobId} > sending callback to ${callbackUrl}`);
      await require('../lib/callback').sendCallback({
        callbackUrl,
        request,
        result,
      });
      resultValue = { success: true };
    } else if (type === 'plugin') {
      const {
        method,
        payload,
      } = params;
      const plugins = await (async () => {
        if (inTesting) {
          const fakePlugin = require('../test/plugin');
          return [...pluginsParam, await new fakePlugin({ name: pluginName })];
        }
        return pluginsParam;
      })();
      const thePlugin = plugins.find(({ name }) => name === pluginName);
      resultValue = await thePlugin[method]({
        ...payload,
        token: params.token,
        plugins,
        typeDefsAndQueries: require('../controllers/bookings').typeDefsAndQueries,
      });
    }
    jobLog(`job ${jobId} > completed`);
    await saveResult({ id: jobId, resultValue });
  });
};

module.exports = async args => throng({
  workers,
  worker: worker(args),
  signals: ['SIGUSR2', 'SIGTERM', 'SIGINT'],
});
