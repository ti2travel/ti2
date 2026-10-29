const assert = require('assert');

const { UserAppKey } = require('../models/index');
const { createCredentialClient, redactCredentialError } = require('../lib/credential-request');

const queryAllotment = plugins => async (req, res, next) => {
  const {
    axios,
    params: {
      appKey,
      hint,
      userId,
    },
    query,
  } = req;
  try {
    const app = plugins.find(({ name }) => name === appKey);
    assert(app, `could not find the app ${appKey}`);
    const userAppKeys = await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint && { hint }),
      },
    });
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.queryAllotment, 'could not find the allotment method');
    const results = await app.queryAllotment({
      axios: req.method === 'POST'
        ? createCredentialClient(app, req.requestId) : axios,
      token,
      payload: req.method === 'POST' ? req.body : query,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(req.method === 'POST'
      ? redactCredentialError(err, 'Allotment request failed') : err);
  }
};

module.exports = plugins => ({
  queryAllotment: queryAllotment(plugins),
});
