const assert = require('assert');

const { UserAppKey } = require('../models/index');

module.exports = async ({ plugins, appKey, userId, hint }) => {
  const app = plugins.find(({ name }) => name === appKey);
  assert(app, 'could not find the app ' + appKey);
  const userAppKey = await UserAppKey.findOne({
    where: {
      userId,
      integrationId: appKey,
      ...(hint && { hint }),
    },
  });
  assert(userAppKey, 'could not find the app key');
  const token = await userAppKey.token;
  return { app, token };
};
