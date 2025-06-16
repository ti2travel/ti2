const Queue = require('bull');
const R = require('ramda');
const Redis = require('ioredis');
const sqldb = require('../models');
const { env: { redisHost, redisPort } } = process;
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

const removeJob = async (jobId) => {
  // For repeat jobs, the ID is in the format 'repeat:jobId:timestamp'
  const jobIdParts = jobId.split(':');
  const isRepeatJob = jobIdParts[0] === 'repeat';

  if (isRepeatJob) {
    // Get all repeatable jobs
    const repeatableJobs = await queue.getRepeatableJobs();

    // Find the job with matching cron pattern
    const cronJob = await sqldb.CronJobs.findOne({
      where: {
        bullJobId: jobId,
      },
    });

    if (cronJob) {
      // First remove all repeatable jobs with matching cron pattern
      for (const repeatableJob of repeatableJobs) {
        if (repeatableJob.cron === cronJob.cron) {
          await queue.removeRepeatableByKey(repeatableJob.key);
        }
      }

      // Then remove all jobs with this pattern
      const jobs = await queue.getJobs(['active', 'wait', 'delayed']);
      for (const job of jobs) {
        if (job.opts.repeat && job.opts.jobId === jobId) {
          await job.remove();
        }
      }

      // Wait for the queue to process the removals
      await new Promise(resolve => setTimeout(resolve, 500));

      // Clean up any remaining jobs
      const remainingJobs = await queue.getJobs(['active', 'wait', 'delayed']);
      for (const job of remainingJobs) {
        if (job.opts.repeat && job.opts.jobId === jobId) {
          await job.remove();
        }
      }

      await redisResults.del(jobId);
      return;
    }

    // If we couldn't find the repeatable job, just delete from the database
    // This can happen if the job was already removed from Bull but still exists in our database
    return;
  }

  // If not a repeatable job, try to remove as a regular job
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
