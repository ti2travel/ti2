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
        method,
        userId,
        inTesting,
        payload = {}
      },
      id: jobId,
      data: params,
    } = job;
    if (type === 'api') {
      const {
        method,
        url,
        payload,
        headers,
      } = params;

      let code, result;
      try {
        // Require supertest only when needed to avoid memory leaks
        const request = require('supertest');
        
        const app = await require('../index')({
          pluginsInstantiated: pluginsParam,
          startServer: false,
          worker: false,
        });

        console.log(`Worker processing API job ${jobId} for ${url}`);
        
        // Use supertest to make the request directly to the app
        const reqMethod = request(app)[method.toLowerCase()];
        if (!reqMethod) {
          throw new Error(`Unsupported HTTP method: ${method}`);
        }
        
        // Set up the request with headers and payload
        let req = reqMethod(url);
        
        // Add headers
        if (headers) {
          Object.entries(R.omit(['content-length'], headers)).forEach(([key, value]) => {
            req = req.set(key, value);
          });
        }
        
        // Add payload for non-GET requests
        if (method.toUpperCase() !== 'GET' && payload) {
          req = req.send(R.omit(['backgroundJob'], payload));
        }
        
        // Execute the request
        const response = await req;
        
        code = response.status;
        result = response.body;
        console.log(`Worker API job ${jobId} completed with code ${code}`);
      } catch (error) {
        // Handle errors during app init or supertest request
        console.error(`Worker API job error for ${jobId}:`, error.message);
        code = 500;
        result = { message: error.message };
      }
      
      return {
        code,
        result,
        success: code >= 200 && code < 300,
      };
    }
    if (type === 'callback') {
      const {
        callbackUrl,
        request,
        result,
      } = payload;

      console.log(`job ${jobId} > sending callback to ${callbackUrl}`);
      await require('../lib/callback').sendCallback({
        callbackUrl,
        request,
        result,
      });
      return { success: true };
    }
    console.log(`job ${jobId} > running ${pluginName}:${method} for ${userId}`);
    const plugins = await (async () => {
      if (inTesting) {
        const fakePlugin = require('../test/plugin');
        return [...pluginsParam, await new fakePlugin({ name: pluginName })];
      }
      return pluginsParam;
    })();
    const thePlugin = plugins.find(({ name }) => name === pluginName);
    const resultValue = await thePlugin[method]({
      ...params.payload,
      token: params.token,
      plugins,
      typeDefsAndQueries: require('../controllers/bookings').typeDefsAndQueries,
    });
    console.log(`job ${jobId} > completed`);
    await saveResult({ id: jobId, resultValue });
  });
};

module.exports = async args => throng({
  workers,
  worker: worker(args),
  signals: ['SIGUSR2', 'SIGTERM', 'SIGINT'],
});
