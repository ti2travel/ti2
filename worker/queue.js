const Queue = require('bull');
const crypto = require('crypto');
const R = require('ramda');
const Redis = require('ioredis');

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
  const job = await queue.add({
    ...payload,
    inTesting,
  }, {
    removeOnComplete: true,
    ...params,
  });
  // For repeat jobs, we need to store the full repeat key
  const id = job.opts.repeat ? job.opts.jobId : job.id;
  return id;
};

const saveResult = async ({ id, resultValue }) => {
  await redisResults.set(id, JSON.stringify(resultValue), 'EX', itemsTTL);
};

const removeJob = async jobId => {
  if (!jobId) return;
  // Bull occurrence IDs use the format 'repeat:<repeat-definition-hash>:<timestamp>'.
  const jobIdParts = jobId.split(':');
  const isRepeatJob = jobIdParts[0] === 'repeat';

  if (isRepeatJob) {
    const job = await queue.getJob(jobId);
    let repeatKey = R.path(['opts', 'repeat', 'key'], job);
    if (!repeatKey) {
      // Bull v4 does not expose occurrence-to-definition lookup. Recreate its
      // internal hash only for legacy rows whose scheduled occurrence has expired.
      const repeatHash = jobIdParts[1];
      const repeatableJobs = await queue.getRepeatableJobs();
      const repeatable = repeatableJobs.find(candidate => {
        const candidateJobId = candidate.id ? `${candidate.id}:` : ':';
        const namespace = crypto.createHash('md5').update(candidate.key).digest('hex');
        const candidateHash = crypto.createHash('md5')
          .update(`${candidate.name}${candidateJobId}${namespace}`)
          .digest('hex');
        return candidateHash === repeatHash;
      });
      repeatKey = repeatable && repeatable.key;
    }
    if (repeatKey) await queue.removeRepeatableByKey(repeatKey);
    if (job) {
      try {
        await job.remove();
      } catch (error) {
        if (error.message && !error.message.includes('not found')) throw error;
      }
    }
    await redisResults.del(jobId);
    return;
  }

  // If not a repeatable job, try to remove as a regular job
  const job = await queue.getJob(jobId);
  if (!job) return;
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
