const jwt = require('jsonwebtoken');
const { omit } = require('ramda');
const assert = require('assert');
const { Umzug, SequelizeStorage } = require('umzug');
const path = require('path');
const Sequelize = require('sequelize');
const fs = require('fs'); // Changed to synchronous fs for initial load
const yaml = require('js-yaml');
const bb = require('bluebird');
const R = require('ramda');

// Load OpenAPI schema
let openApiSchema = null;
try {
  const schemaPath = path.join(__dirname, '..', 'api.yml'); // Assuming api.yml is in the parent directory of controllers
  const schemaFile = fs.readFileSync(schemaPath, 'utf8');
  openApiSchema = yaml.load(schemaFile);
} catch (e) {
  console.error('Failed to load OpenAPI schema:', e);
  // Handle error appropriately, perhaps by preventing the app from starting
  // or by using a default empty schema to prevent crashes later.
  // For now, we'll let it potentially crash if openApiSchema is null and accessed.
}

const sqldb = require('../models');
const {
  queue,
  addJob,
  jobStatus,
  removeJob,
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
    return res.json({
      template: {
        ...template,
        // ttlProducts and doNotCallPluginForProducts are being used at ti2 level
        // hence we should just by default allow them for all ti2 plugins
        ttlForProducts: {
          type: 'number',
          regExp: /.+/,
          default: 60 * 60 * 24, // 1 day
        },
        doNotCallPluginForProducts: {
          type: 'boolean',
          regExp: /.+/,
          default: false,
        },
      },
    });
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
              let rawBullJobId = await addJob(jobPayload, jobParams);
              existing.bullJobId = (rawBullJobId && typeof rawBullJobId === 'object' && rawBullJobId.id) ? rawBullJobId.id : rawBullJobId;
              await existing.save();
            } else {
              // make sure the cron is the same
              // bullJobId here is from existing.bullJobId, which should be a string.
              // The queue.getJob expects a string ID.
              const bullCron = R.path(
                ['opts', 'repeat', 'cron'],
                await queue.getJob(existing.bullJobId), // Use existing.bullJobId
              );
              if (bullCron !== job.cron) {
                await queue.removeJobs(existing.bullJobId); // Use existing.bullJobId
                let rawBullJobId = await addJob(jobPayload, jobParams);
                existing.bullJobId = (rawBullJobId && typeof rawBullJobId === 'object' && rawBullJobId.id) ? rawBullJobId.id : rawBullJobId;
                await existing.save();
              }
            }
          } else {
            let rawBullJobId = await addJob(jobPayload, jobParams);
            const actualBullJobId = (rawBullJobId && typeof rawBullJobId === 'object' && rawBullJobId.id) ? rawBullJobId.id : rawBullJobId;
            await sqldb.CronJobs.create({ ...where, bullJobId: actualBullJobId });
          }
        });
      }
    });


    return res.json({ value: newAppKey.get('id').toString() });
  } catch (err) {
    return next(err);
  }
};

const updateAppToken = async (req, res, next) => {
  const {
    body: {
      configuration,
      hint,
    },
    params: {
      app: integrationId,
      userId,
    },
  } = req;
  // check if the user exists
  const userRecord = await sqldb.User.findOne({ where: { userId } });
  if (!userRecord) return next({ status: 404, message: 'User does not exists' });
  await sqldb.UserAppKey.update({
    configuration,
  }, {
    where: {
      integrationId,
      userId,
      hint,
    },
    raw: true,
  });
  return res.json({ message: `${hint} updated ` });
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
    await fs.promises.access(migrationsPath);
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
}) => {
  const where = R.reject(R.isNil)({
    pluginName: integrationId,
    userId,
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
    return next({ status: 404, message: `User integratio is not found for ${integrationId}:${userId}:${hint}` });
  }
  return res.json({ token: await userAppKey.token });
};

const createCronjob = async (req, res, next) => {
  const {
    params: {
      userId,
    },
    body: {
      method,
      url,
      cron,
      callbackUrl,
      body,
      removeOnComplete,
    },
  } = req;

  let transaction;

  try {
    // Validate required fields
    if (!method || !url || !cron) {
      const error = new Error('method, url, and cron are required fields');
      error.status = 400;
      throw error;
    }

    // Validate URL path
    const validUrlPattern = /^\/[\w\-\/\.]+$/;
    if (!validUrlPattern.test(url)) {
      const error = new Error('Invalid URL path');
      error.status = 400;
      throw error;
    }
  
    // Helper function to find a matching path in the OpenAPI schema
    const findMatchingOpenApiPath = (requestUrl, schemaPaths) => {
      if (!schemaPaths) return null;
      for (const schemaPathKey in schemaPaths) {
        // Convert schemaPathKey to a regex: e.g., /products/{id} -> ^/products/[^/]+$
        const regexPattern = '^' + schemaPathKey.replace(/{[^}]+}/g, '[^/]+') + '$';
        const regex = new RegExp(regexPattern);
        if (regex.test(requestUrl)) {
          return schemaPathKey; // Return the original schema path key
        }
      }
      return null;
    };

    const matchedSchemaPathKey = findMatchingOpenApiPath(url, openApiSchema ? openApiSchema.paths : null);

    // Validate URL and method against OpenAPI schema
    if (!openApiSchema || !matchedSchemaPathKey || !openApiSchema.paths[matchedSchemaPathKey][method.toLowerCase()]) {
      const errorMessage = openApiSchema && openApiSchema.paths ?
        `Invalid URL ('${url}') or method ('${method}') combination not found in API schema, or schema path not matched.` :
        'API schema not loaded, cannot validate URL and method.';
      const error = new Error(errorMessage);
      error.status = 400;
      throw error;
    }

    // Create a user token for the job test
    const jobToken = jwt.sign({ userId }, process.env.jwtSecret);

    // Start transaction
    transaction = await sqldb.sequelize.transaction();

    // Create job in database
    const cronJobData = {
      userId,
      // bullJobId will be set by the hook
      cron,
      method,
      url,
      token: jobToken,
      body: { // Ensure body includes callbackUrl if present, or is an empty object if body is null/undefined
        ...(body || {}),
        ...(callbackUrl ? { callbackUrl } : {}),
      },
      removeOnComplete: removeOnComplete || false, // Ensure it defaults to false if not provided
    };
    
    const cronJob = await sqldb.ApiCronJobs.create(cronJobData, { transaction });

    await transaction.commit();
    // The cronJob instance returned here should have bullJobId populated by the hook
    return res.json(R.omit(['token'], cronJob.get({ plain:true })));
  } catch (err) {
    if (transaction) await transaction.rollback();
    // No need to manually cleanup bullJobId here.
    // If hook failed, transaction is rolled back by the hook re-throwing,
    // or by create itself failing.
    // If create itself failed before hook, no bull job was created.
    return next(err);
  }
};

const listCronjobs = async (req, res, next) => {
  const {
    params: {
      userId,
    },
  } = req;

  try {
    // Get all jobs from Bull queue
    const bullJobs = await queue.getJobs(['active', 'wait', 'delayed']);
    const bullJobIds = new Set(bullJobs.map(job => job.id));

    // Get repeatable jobs
    const repeatableJobs = await queue.getRepeatableJobs();
    const repeatablePatterns = new Set(repeatableJobs.map(job => job.cron));

    // Get jobs from database
    const jobs = await sqldb.ApiCronJobs.findAll({
      where: {
        userId,
      },
      attributes: { exclude: ['token'] },
      raw: true,
    });

    // Add inQueue status to jobs
    const jobsWithStatus = jobs.map(job => {
      const jobIdParts = job.bullJobId.split(':');
      const isRepeatJob = jobIdParts[0] === 'repeat';
      let isInQueue = false;

      if (isRepeatJob) {
        isInQueue = repeatablePatterns.has(job.cron);
      } else {
        isInQueue = bullJobIds.has(job.bullJobId);
      }
      return { ...job, inQueue: isInQueue };
    });

    return res.json({ jobs: jobsWithStatus });
  } catch (err) {
    return next(err);
  }
};

const deleteCronjob = async (req, res, next) => {
  const {
    params: {
      userId,
      id, // Changed from jobId to id
    },
  } = req;

  // Extract token from Authorization header
  const getToken = (req) => {
    if (
      !req.header('Authorization') ||
      req.header('Authorization').substring(0, 7) !== 'Bearer '
    ) return null;
    return req.header('Authorization').split(' ')[1];
  };
  
  const token = getToken(req);
  let transaction; // Add transaction variable for deleteCronjob

  try {
    // Check if user is admin
    const isAdmin = token === process.env.adminKey;

    // For non-admin users, verify token
    if (!isAdmin) {
      try {
        const decoded = jwt.verify(token, process.env.jwtSecret);
        // Verify userId in token matches requested userId
        if (!decoded || !decoded.userId || decoded.userId !== userId) {
          throw new Error('User ID mismatch');
        }
      } catch (err) {
        return res.status(403).json({
          status: 403,
          message: 'Forbidden'
        });
      }
    }

    // Find the cronjob in the database
    const cronJob = await sqldb.ApiCronJobs.findOne({
      where: {
        userId,
        id, // Changed from bullJobId to id
      },
    });

    // If cronjob doesn't exist, return 404
    if (!cronJob) {
      const error = new Error('Cronjob not found');
      error.status = 404;
      return next(error);
    }

    // For non-admin users, verify ownership of the cronjob
    if (!isAdmin && userId !== cronJob.userId) {
      return res.status(403).json({
        status: 403,
        message: 'Forbidden'
      });
    }

    // Start transaction
    transaction = await sqldb.sequelize.transaction();

    // Remove from database. The beforeDestroy hook in ApiCronJobs model
    // will handle removing the job from the Bull queue.
    // Pass the transaction to ensure atomicity.
    // The destroy operation will only succeed if the beforeDestroy hook (including removeJob) succeeds.
    const destroyedRows = await sqldb.ApiCronJobs.destroy({
      where: {
        // id, // cronJob instance is already fetched and verified
        id: cronJob.id, // Use the id from the fetched cronJob instance
        userId: cronJob.userId, // Ensure we are deleting the correct user's job
      },
      transaction, // Pass transaction to destroy
    });

    // It's good practice to check if any rows were actually deleted,
    // though in this flow, cronJob existence is checked prior.
    if (destroyedRows === 0) {
        // This case should ideally not be reached if cronJob was found
        if (transaction) await transaction.rollback();
        const error = new Error('Cronjob not found for deletion, though it was fetched prior.');
        error.status = 404; // Or 500 for internal inconsistency
        return next(error);
    }
    
    await transaction.commit();
    // Return success response
    return res.json({ success: true });
  } catch (err) {
    if (transaction) await transaction.rollback(); // Rollback transaction on error
    // Pass along errors with status
    if (err.status) {
      return next(err);
    }
    
    // Otherwise, create a generic 500 error
    const error = new Error(err.message || 'Internal Server Error');
    error.status = 500;
    return next(error); // Changed from next(err) to next(the new error object) for consistency
  }
};

module.exports = plugins => ({
  createAppToken,
  getAppToken,
  createAppSettings,
  getAppSettings,
  updateAppToken,
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
  createCronjob,
  deleteCronjob,
  listCronjobs,
});
