const throng = require('throng');
const bb = require('bluebird');
const R = require('ramda');
require('util').inspect.defaultOptions.depth = null;
const { CronJobs } = require('../models');
const fakePlugin = require('../test/plugin');

const { queue, saveResult, addJob } = require('./queue');

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
        hint,
        userId,
        inTesting,
      },
      id,
      data: params,
    } = job;
    console.log(`job ${id} > running ${pluginName}:${method} for ${userId}`);
    const plugins = await (async() => {
      if (inTesting) {
        return [...pluginsParam, await new fakePlugin({ name: pluginName })];
      }
      return pluginsParam;
    })();
    const thePlugin = plugins.find(({ name }) => name == pluginName)
    const resultValue = await thePlugin[method](params);
    console.log(`job ${id} > completed`);
    await saveResult({ id: job.id, resultValue });
  });
};


module.exports = async args => {
  return throng({
    workers,
    worker: worker(args),
    signals: ['SIGUSR2', 'SIGTERM', 'SIGINT'],
  });
};


