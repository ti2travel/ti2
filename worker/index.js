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
        pluginName,
        method,
        userId,
        inTesting,
      },
      id: jobId,
      data: params,
    } = job;
    console.log(`job ${jobId} > running ${pluginName}:${method} for ${userId}`);
    const plugins = await (async () => {
      if (inTesting) {
        const fakePlugin = require('../test/plugin');
        return [...pluginsParam, await new fakePlugin({ name: pluginName })];
      }
      return pluginsParam;
    })();
    const thePlugin = plugins.find(({ name }) => name === pluginName);
    const resultValue = await thePlugin[method](params);
    console.log(`job ${jobId} > completed`);
    await saveResult({ id: jobId, resultValue });
  });
};

module.exports = async args => throng({
  workers,
  worker: worker(args),
  signals: ['SIGUSR2', 'SIGTERM', 'SIGINT'],
});
