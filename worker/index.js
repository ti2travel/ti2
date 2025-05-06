const throng = require('throng');
require('util').inspect.defaultOptions.depth = null;

const { queue, saveResult } = require('./queue');

const workers = process.env.WEB_CONCURRENCY || 2;

const maxJobsPerWorker = 1;

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
      console.log('job params', params)
      const {
        method,
        url,
        payload,
        headers,
      } = params;
      const request = require('supertest');
      // Initialize the app properly
      const appReq = require('../index');
      const app = await appReq({
        startServer: false,
        plugins: {}
      });
      console.log({method, url, payload, headers})
      const response = await request(app)[method.toLowerCase()](url)
        .set(headers)
        .send(payload);
      const code = response.statusCode;
      const result = response.body;
      console.log('job result', result)
      return {
        code,
        result,
        success: code === 200,
       };
    }
    // Handle callback jobs
    if (type === 'callback') {
      const {
        callbackUrl,
        operationId,
        operationPayload,
        operationResult,
        integrationId,
        hint
      } = payload;

      console.log(`job ${jobId} > sending callback to ${callbackUrl}`);
      await require('../lib/callback').sendCallback({
        callbackUrl,
        operationId,
        payload: operationPayload,
        result: operationResult,
        userId,
        integrationId,
        hint
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
