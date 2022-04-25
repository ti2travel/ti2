const throng = require('throng');
// const closeAll = require('./closeAll.js');
require('util').inspect.defaultOptions.depth = null;

const { queue, saveResult } = require('./queue');

const workers = process.env.WEB_CONCURRENCY || 2;

const maxJobsPerWorker = 1;

const worker = (id, disconnect) => {
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
// process.on('SIGTERM', () => {
//   console.log(`Master exiting`)
//   process.exit(0);
// })
// })

throng({ workers, worker, signals: ['SIGUSR2', 'SIGTERM', 'SIGINT'] });

