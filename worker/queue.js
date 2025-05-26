const Queue = require('bull');
const Redis = require('ioredis');
const R = require('ramda');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const itemsTTL = 3 * 60 * 60; // 3 hours

const queue = new Queue('work', `${REDIS_URL}/0`);
const redisResults = new Redis(`${REDIS_URL}/1`);

const getPending = async () => {
  const pending = await queue.count();
  const running = await queue.getActiveCount();
  return pending + running;
};

const allDone = async () => {
  const left1 = await getPending();
  if (left1 === 0) return true;
  return (new Promise(resolve => {
    queue.on('global:completed', async () => {
      const left = await getPending();
      if (left === 0) resolve();
    });
  }));
};

queue.on('failed', (job, err) => {
  console.log(`job ${job.id} failed`, err);
});

const addJob = async (payload, paramsParam) => {
  const params = paramsParam || {};
  const inTesting = Boolean(process.env.JEST_WORKER_ID);
  const id = R.path(['id'], await queue.add({
    ...payload,
    inTesting,
  }, {
    removeOnComplete: true,
    ...params,
  }));
  return id;
};

const saveResult = async ({ id, resultValue }) => {
  await redisResults.set(id, JSON.stringify(resultValue), 'EX', itemsTTL);
};

const removeJob = async (jobId) => {
  const job = await queue.getJob(jobId);
  if (!job) {
    throw new Error('Job not found');
  }
  await job.remove();
  await redisResults.del(jobId);
};

const jobStatus = async ({ jobId }) => {
  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      // check if it is done
      const result = JSON.parse(await redisResults.get(jobId));
      // await global.sleep();
      if (result) {
        return {
          jobId,
          status: 'success',
          result,
        };
      }
      return { // 404
        jobId,
        status: 'failed',
      };
    }
    const state = await job.getState();
    return {
      jobId,
      status: state.toLowerCase(),
    };
  } catch (err) {
    console.log(`could not get job status for ${jobId}`, err);
    return { // 500
      jobId,
      status: 'failed',
    };
  }
};
module.exports = {
  addJob,
  allDone,
  jobStatus,
  queue,
  saveResult,
  redisResults,
  removeJob,
};
