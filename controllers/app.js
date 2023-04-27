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

const tokenTemplate = async (req, res, next) => {
  const {
    params: {
      appKey: pluginName,
    },
  } = req;
  try {
    const thePlugin = req.app.plugins.find(({ name }) => name === pluginName);
    assert(thePlugin);
    let template = thePlugin.tokenTemplate();
    const safeRegExp = el => ({
      ...el,
      regExp: {
        flags: el.regExp.flags,
        source: el.regExp.source,
      },
    });
    template = R.map(safeRegExp, template);
    return res.json({ template });
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
    // check if the user already has the same app with the same hint
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

const validateAppToken = plugins => async (req, res, next) => {
  const {
    axios,
    body: {
      tokenHint: hint,
    },
    params: {
      app: appKey,
      userId,
    },
  } = req;
  try {
    const app = plugins.find(({ name }) => name === appKey);
    assert(app, `could not find the app ${appKey}`);
    const userAppKeys = await sqldb.UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    });
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.validateToken, `could not find the validateToken method for ${appKey}`);
    const valid = await app.validateToken({
      axios,
      token,
      requestId: req.requestId,
    });
    return res.json({ valid });
  } catch (err) {
    return next(err);
  }
};

const getAffiliates = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body: payload,
  } = req;
  try {
    const app = plugins.find(({ name }) => name === appKey);
    assert(app, `could not find the app ${appKey}`);
    const userAppKeys = await sqldb.UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    });
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.getAffiliates, `could not find the getAffiliates method for ${appKey}`);
    const retVal = await app.getAffiliates({
      axios,
      token,
      requestId: req.requestId,
      payload,
    });
    return res.json(retVal);
  } catch (err) {
    return next(err);
  }
};

const listAppTokens = async (req, res, next) => {
  const { params: { app: integrationId } } = req;
  try {
    const userAppKeys = (await sqldb.UserAppKey.findAll({ where: { integrationId } }))
      .map(userAppKey => userAppKey.dataValues);
    return res.json({ userAppKeys: userAppKeys.map(userAppKey => omit(['appKey', 'id', 'token'], userAppKey)) });
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

const createAppSettings = async (req, res, next) => {
  const {
    body: {
      settings,
    },
    params: {
      appKey: integrationId,
      userId,
    },
  } = req;
  try {
    const payload = {
      integrationId,
      userId,
      settings,
    };
    // check if the user exists
    const userRecord = await sqldb.User.findOne({ where: { userId } });
    if (!userRecord) { // create the user record
      await sqldb.User.create({ userId });
    }
    // check if the user already has the same app settings
    const userSettings = await sqldb.UserIntegrationSettings.findOne({
      where: { userId, integrationId },
    });
    if (userSettings) {
      userSettings.settings = settings;
      await userSettings.save();
    } else {
      await sqldb.UserIntegrationSettings.create(payload);
    }
    return res.json({ success: true });
  } catch (err) {
    console.log(err.stack);
    return next(err);
  }
};

const deleteAppSettings = async (req, res, next) => {
  const {
    params: {
      appKey: integrationId,
      userId,
    },
  } = req;
  // check if the user exists
  const userRecord = await sqldb.User.findOne({ where: { userId } });
  if (!userRecord) return next({ status: 404, message: 'User does not exists' });
  const retVal = await sqldb.UserIntegrationSettings.destroy({
    where: {
      integrationId,
      userId,
    },
  });
  if (retVal === 0) return next({ status: 404, message: 'Settings not found' });
  return res.json({ success: true });
};

const getAppSettings = async (req, res, next) => {
  const {
    params: {
      appKey: integrationId,
      userId,
    },
  } = req;
  // check if the user exists
  const userRecord = await sqldb.User.findOne({ where: { userId } });
  if (!userRecord) return next({ status: 404, message: 'User does not exists' });
  const userIntegrationSettings = await sqldb.UserIntegrationSettings.findOne({
    where: { userId, integrationId },
  });
  if (!userIntegrationSettings) {
    return res.json({ settings: {} });
  }
  return res.json({ settings: userIntegrationSettings.settings });
};

const getAppToken = async (req, res, next) => {
  const {
    params: {
      app: integrationId,
      userId,
      hint,
    },
  } = req;
  // check if the user exists
  const userRecord = await sqldb.User.findOne({ where: { userId } });
  if (!userRecord) return next({ status: 404, message: 'User does not exists' });
  const userAppKey = await sqldb.UserAppKey.findOne({
    where: {
      userId,
      integrationId,
      ...(hint ? { hint } : {}),
    },
  });
  if (!userAppKey) {
    return next({ status: 404, message: 'User integratio is not found' });
  }
  return res.json({ token: await userAppKey.token });
};

module.exports = plugins => ({
  createAppToken,
  getAppToken,
  createAppSettings,
  getAppSettings,
  deleteAppToken,
  deleteAppSettings,
  getAppScheduledJobs,
  getJobStatus,
  jwtEncode,
  listAppTokens,
  migrateApp,
  runAppJob,
  tokenTemplate,
  validateAppToken: validateAppToken(plugins),
  getAffiliates: getAffiliates(plugins),
});
