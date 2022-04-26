const throng = require('throng');
const bb = require('bluebird');
const R = require('ramda');
// const closeAll = require('./closeAll.js');
require('util').inspect.defaultOptions.depth = null;
const { CronJobs } = require('../models');

const { queue, saveResult, addJob } = require('./queue');

const workers = process.env.WEB_CONCURRENCY || 2;

const maxJobsPerWorker = 1;

const worker = ({ plugins }) => (id, disconnect) => {
  console.log(`Started worker ${id}`);

  const bye = () => {
    console.log(`Worker ${id} exiting`);
    disconnect();
    // closeAll().then(() => {
    process.exit(0);
    // });
  };

  process.on('SIGTERM', bye);
  process.on('SIGUSR2', bye);
  process.on('SIGINT', bye);

  queue.process(maxJobsPerWorker, async job => {
    const {
      data: {
        file,
        action,
        params,
        // callbackUrl,
        // inTesting,
      },
      id,
    } = job;
    console.log(`job ${id} > running ${file}:${action}`);
    const worker = require(`./${file}`)[action];
    const resultValue = await worker(...params);
    console.log(`job ${id} > completed`);
    // USE callbackUrl and ping with the result
    await saveResult({ id: job.id, resultValue });
  });
};

const master = ({ plugins }) => async () => {
  await bb.each(plugins, async plugin => {
    if (Array.isArray(plugin.jobs)) {
      await bb.each(plugin.jobs, async job => {
        const where = {
          pluginName: plugin.name,
          pluginJobId: job.id,
        };
        const existing = await CronJobs.findOne({ where });
        const jobPayload = {
          pluginName: plugin.name,
          ...job.payload,
        };
        const jobParams = {
          ...(job.cron ? {
            repeat: {
              cron: job.cron,
            }
          } : {}),
          ...(job.params || {}),
          removeOnComplete: false,
        }
        let bullJobId;
        if (existing) {
          let bullJob = await queue.getJob(job.bullJobId);
          if (!bullJob) {
            bullJobId = await addJob(jobPayload, jobParams);
            existing.bullJobId =  bullJobId;
            await existing.save();
          } else {
            // make sure the cron is the same
            const bullCron = R.path(
              ['opts','repeat', 'cron'],
              await queue.getJob(bullJobId)
            );
            if (bullCron !== job.cron) {
              await queue.removeJobs(bullJobId);
              bullJobId = await addJob(jobPayload, jobParams);
              existing.bullJobId =  bullJobId;
              await existing.save();
            }
          }
        } else {
          bullJobId = await addJob(jobPayload, jobParams);
          await CronJobs.create({ ...where, bullJobId  })
        }
      });
    }
  });
};

module.exports = async args => {
  return throng({
    master: master(args),
    workers,
    worker: worker(args),
    signals: ['SIGUSR2', 'SIGTERM', 'SIGINT'],
  });
};


