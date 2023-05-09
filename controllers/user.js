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
