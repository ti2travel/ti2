const assert = require('assert');

const { UserAppKey } = require('../models/index');

const queryAllotment = plugins => async (req, res, next) => {
  const {
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
        ...(hint ? { hint } : {}),
      },
    });
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.queryAllotment, 'could not find the allotment method');
    const results = await app.queryAllotment({
      token,
      payload: query,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

module.exports = plugins => ({
  queryAllotment: queryAllotment(plugins),
});
