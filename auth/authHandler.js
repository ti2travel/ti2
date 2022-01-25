const jsonwebtoken = require('jsonwebtoken');
const Promise = require('bluebird');
const assert = require('assert');

const sqldb = require('../models');

const {
  env: {
    frontendKey,
    adminKey,
    jwtSecret,
  },
} = process;

const invalid = next => next({ status: 401, message: 'Unauthorized' });
const getToken = ({ req }) => {
  if (
    !req.header('Authorization')
    || req.header('Authorization').substring(0, 7) !== 'Bearer '
  ) return null;
  return req.header('Authorization').split(' ')[1];
};
// the authentication middleware
const app = async (req, res, next) => {
  if (!req.pathParams || !req.pathParams.app) return invalid(next);
  const token = getToken({ req });
  if (!token) return invalid(next);
  // try {
  const appRecord = await sqldb.Integration.findOne({
    where: {
      name: req.pathParams.app,
    },
  });
  if (!appRecord) return invalid(next);
  if (appRecord.apiKey !== token) {
    return invalid(next);
  }
  req.appRecord = appRecord.dataValues;
  return next();
};

// The requester is an admin; createApps and other admin tasks
const admin = async (req, res, next) => {
  const token = getToken({ req });
  if (token !== adminKey) return invalid(next);
  return next();
};

// the request is from a user, checke the userId agains the url param
const user = async (req, res, next) => {
  const token = getToken({ req });
  if (!token) return invalid(next);
  try {
    const { userId } = jsonwebtoken.verify(token, jwtSecret);
    assert(userId);
    if (req.params.userId && userId !== req.params.userId) return invalid(next);
  } catch (err) {
    return invalid(next);
  }
  return next();
};

// The requester comes from frontend; frontend driven tasks
const frontend = async (req, res, next) => {
  const token = getToken({ req });
  if (token !== frontendKey) return invalid(next);
  return next();
};

const adminOrUser = levels => async (req, res, next) => {
  result = await Promise.all(levels.map(
    level => level(req, res, err => err),
  ));
  if (result.some(val => (!Boolean(val)))) {
    return next();
  }
  return next(result[0]);
};

module.exports = {
  app,
  frontend,
  admin,
  user,
  'admin,user': adminOrUser([admin, user]),
  'admin,app,user': adminOrUser([admin, app, user]),
};
