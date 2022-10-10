const jwt = require('jwt-promise');
const { omit } = require('ramda');
const assert = require('assert');
const { Umzug, SequelizeStorage } = require('umzug');
const path = require('path');
const Sequelize = require('sequelize');
const fs = require('fs').promises;
const bb = require('bluebird');
const R = require('ramda');

const sqldb = require('../models');
const {
  queue,
  addJob,
  jobStatus,
} = require('../worker/queue');

const { env: { jwtSecret } } = process;

const jwtEncode = async (req, res, next) => {
  try {
    const value = await jwt.sign(req.body, `${req.appRecord.name}.${jwtSecret}`);
    return res.json({ value });
  } catch (err) {
    return next(err);
  }
};

const createAppToken = async (req, res, next) => {
  const {
    body: {
      tokenHint: hint,
      token: appKey,
    },
    params: {
      app: integrationId,
      userId,
    },
  } = req;
  try {
    const payload = {
      integrationId,
      userId,
      hint,
      appKey,
    };
    // check if the user exists
    const userRecord = await sqldb.User.findOne({ where: { userId } });
    if (!userRecord) { // create the user record
      await sqldb.User.create({ userId });
    }
    // check if the user alrady has the same app with the same hint
    const userAppKeyDup = await sqldb.UserAppKey.findOne({
      where: { userId, integrationId, hint },
    });
    if (userAppKeyDup) await userAppKeyDup.destroy();
    const newAppKey = await sqldb.UserAppKey.create(payload);
    // create any cronjobs related to the app
    await bb.each(req.app.plugins, async plugin => {
      if (Array.isArray(plugin.jobs)) {
        const validJobs = plugin.jobs.filter(job => Boolean(job.cron) && Boolean(job.method));
        await bb.each(validJobs, async job => {
          const where = {
            pluginName: plugin.name,
            pluginJobId: job.method,
            userId,
            hint,
            cron: job.cron,
          };
          const existing = await sqldb.CronJobs.findOne({
            where: R.omit(['cron'], where),
          });
          const jobPayload = {
            ...where,
            ...job.payload,
          };
          const jobParams = {
            ...(job.cron ? {
              repeat: {
                cron: job.cron,
              },
            } : {}),
            ...(job.params || {}),
            removeOnComplete: false,
          };
          let bullJobId;
          if (existing) {
            const bullJob = await queue.getJob(job.bullJobId);
            if (!bullJob) {
              bullJobId = await addJob(jobPayload, jobParams);
              existing.bullJobId = bullJobId;
              await existing.save();
            } else {
              // make sure the cron is the same
              const bullCron = R.path(
                ['opts', 'repeat', 'cron'],
                await queue.getJob(bullJobId),
              );
              if (bullCron !== job.cron) {
                await queue.removeJobs(bullJobId);
                bullJobId = await addJob(jobPayload, jobParams);
                existing.bullJobId = bullJobId;
                await existing.save();
              }
            }
          } else {
            bullJobId = await addJob(jobPayload, jobParams);
            await sqldb.CronJobs.create({ ...where, bullJobId });
          }
        });
      }
    });

    return res.json({ value: newAppKey.get('id').toString() });
  } catch (err) {
    return next(err);
  }
};

const deleteAppToken = async (req, res, next) => {
  const {
    body: {
      tokenHint: hint,
    },
    params: {
      app: integrationId,
      userId,
    },
  } = req;
  // check if the user exists
  const userRecord = await sqldb.User.findOne({ where: { userId } });
  if (!userRecord) return next({ status: 404, message: 'User does not exists' });
  const retVal = await sqldb.UserAppKey.destroy({
    where: {
      integrationId,
      userId,
      hint,
    },
  });
  if (retVal === 0) return next({ status: 404, message: 'Key not found' });
  return res.json({ message: `${retVal} erased` });
};

const listAppTokens = async (req, res, next) => {
  const { params: { app: integrationId } } = req;
  try {
    const userAppKeys = (await sqldb.UserAppKey.findAll({ where: { integrationId } }))
      .map(userAppKey => userAppKey.dataValues);
    return res.json({ userAppKeys: userAppKeys.map(userAppKey => omit(['appKey', 'id'], userAppKey)) });
  } catch (err) {
    return next(err);
  }
};

const migrateApp = async ({ integrationId, action }) => {
  const { sequelize } = sqldb;
  assert(integrationId);
  assert(action);
  const migrationsPath = path.join(
    __dirname,
    '../',
    '../',
    integrationId,
    'migrations',
  );
  try {
    await fs.access(migrationsPath);
  } catch (err) {
    throw Error(`Could not find any migrations for ${integrationId} on ${migrationsPath}`);
  }
  const umzug = new Umzug({
    migrations: {
      glob: `${migrationsPath}/*.js`,
      resolve: ({ name, path: migPath, context }) => {
        const migration = require(migPath);
        return {
          name,
          up: async () => migration.up(context, Sequelize),
          down: async () => migration.down(context, Sequelize),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({
      sequelize,
      tableName: `SequelizeMeta-${integrationId}`,
    }),
    logger: console,
  });
  if (action === 'migrate') {
    return umzug.up();
  }
  if (action === 'revert') {
    return umzug.down({ to: 0 });
  }
  throw Error('No recognized action');
};

const getAppScheduledJobs = async ({
  integrationId,
  userId,
  hint,
}) => {
  const where = R.reject(R.isNil)({
    pluginName: integrationId,
    userId,
    hint,
  });
  const jobs = await sqldb.CronJobs.findAll({
    where,
    raw: true,
  });
  return { jobs };
};

const runAppJob = async (req, res, next) => {
  const {
    body: {
      payload,
      jobParams,
    },
    params: {
      app: pluginName,
      hint,
      userId,
    },
  } = req;
  try {
    const bullJobId = await addJob({
      ...payload,
      pluginName,
      hint,
      userId,
    }, jobParams);
    assert(bullJobId);
    return res.json(await jobStatus({ jobId: bullJobId }));
  } catch (err) {
    return next(err);
  }
};

const getJobStatus = async (req, res, next) => {
  const {
    params: {
      jobId,
    },
  } = req;
  try {
    const returnValue = await jobStatus({ jobId });
    return res.json(returnValue);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createAppToken,
  deleteAppToken,
  getAppScheduledJobs,
  getJobStatus,
  jwtEncode,
  listAppTokens,
  migrateApp,
  runAppJob,
};
