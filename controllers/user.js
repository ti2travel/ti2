// controllers/user.js
const { Op } = require('sequelize');

const { IntegrationLifecycle, UserAppKey } = require('../models');

const pendingCleanupStatuses = ['deleting', 'external_cleanup', 'failed'];
const integrationKey = ({ integrationId, hint }) => JSON.stringify([integrationId, hint]);

const userAppList = async (req, res, next) => {
  const { params: { userId } } = req;
  try {
    const [credentials, pendingCleanups] = await Promise.all([
      UserAppKey.findAll({
        where: { userId },
        raw: true,
        attributes: ['integrationId', 'userId', 'hint', 'createdAt', 'updatedAt'],
      }),
      IntegrationLifecycle.findAll({
        where: {
          userId,
          status: { [Op.in]: pendingCleanupStatuses },
        },
        raw: true,
        attributes: ['integrationId', 'userId', 'hint', 'status'],
      }),
    ]);
    const cleanupByIntegration = new Map(
      pendingCleanups.map(cleanup => [integrationKey(cleanup), cleanup]),
    );
    const userAppKeys = credentials.map(credential => {
      const cleanup = cleanupByIntegration.get(integrationKey(credential));
      if (!cleanup) return credential;
      cleanupByIntegration.delete(integrationKey(credential));
      return { ...credential, cleanupStatus: cleanup.status };
    });
    cleanupByIntegration.forEach(cleanup => userAppKeys.push({
      integrationId: cleanup.integrationId,
      userId: cleanup.userId,
      hint: cleanup.hint,
      cleanupStatus: cleanup.status,
    }));
    return res.json({ userAppKeys });
  } catch (err) {
    return next(err);
  }
};

// source: https://stackoverflow.com/questions/31054910/get-functions-methods-of-a-class
const getAllFuncs = toCheck => {
  const props = [];
  let obj = toCheck;
  do {
    props.push(...Object.getOwnPropertyNames(obj));
  } while (obj = Object.getPrototypeOf(obj));

  return props.sort().filter((e, i, arr) => {
    try {
      if (e === 'cache') return false;
      if (e !== arr[i + 1] && typeof toCheck[e] === 'function') return true;
    } catch {
      return undefined;
    }
    return undefined;
  });
};

const getAppMethods = plugins => async (req, res, next) => {
  const { params: { appKey } } = req;
  try {
    const app = plugins.filter(({ name }) => name === appKey)[0];
    const methods = getAllFuncs(app);
    return res.json({
      capabilities: app.capabilities || {},
      methods,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = plugins => ({
  getAllFuncs,
  getAppMethods: getAppMethods(plugins),
  userAppList,
});
