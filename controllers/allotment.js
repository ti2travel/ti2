const assert = require('assert');

const { UserAppKey } = require('../models/index');
const { configureAxiosSSL } = require('../lib/sslConfig');

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
        ? configureAxiosSSL(
          app.axios.create({ headers: { requestId: req.requestId } }),
          process.env.SSL_INSECURE_ALLOWED_DOMAINS,
        ) : axios,
      token,
      payload: req.method === 'POST' ? req.body : query,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    if (req.method === 'POST' && err && err.isAxiosError) {
      const error = new Error('Allotment request failed');
      const status = Number(err.response && err.response.status);
      error.status = Number.isInteger(status) && status >= 400 && status <= 599
        ? status : (err.code === 'ECONNABORTED' ? 504 : 502);
      return next(error);
    }
    return next(err);
  }
};

module.exports = plugins => ({
  queryAllotment: queryAllotment(plugins),
});
