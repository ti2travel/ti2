// controllers/user.js
const { omit } = require('ramda');

const { UserAppKey } = require('../models');

const userAppList = async (req, res, next) => {
  const { params: { userId } } = req;
  try {
    const userAppKeys = (await UserAppKey.findAll({ where: { userId } }))
      .map(userAppKey => userAppKey.dataValues);
    return res.json({ userAppKeys: userAppKeys.map(userAppKey => omit(['appKey', 'id'], userAppKey)) });
  } catch (err) {
    return next(err);
  }
};

const getAppMethods = plugins => async (req, res, next) => {
  const { params: { appKey } } = req;
  try {
    const app = plugins.filter(({ name }) => name === appKey)[0];
    const methods = Object.getOwnPropertyNames(app);
    return res.json({
      methods,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = plugins => ({
  userAppList,
  getAppMethods: getAppMethods(plugins),
});
