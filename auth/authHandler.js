const jsonwebtoken = require('jsonwebtoken');
const Promise = require('bluebird');

const sqldb = require('../models');

const {
  env: {
    frontendKey,
    adminKey,
    jwtSecret,
  },
} = process;

const invalid = (res, msg) => res.status(401).json({ error: msg || 'Unauthorized' });

const getToken = ({ req }) => {
  if (
    !req.header('Authorization')
    || req.header('Authorization').substring(0, 7) !== 'Bearer '
  ) return null;
  return req.header('Authorization').split(' ')[1];
};

// the authentication middleware
const appCheck = async req => {
  if (!req.pathParams || !req.pathParams.app) {
    return 'App parameters not found';
  }
  const token = getToken({ req });
  if (!token) return 'Api key not found';
  const appRecord = await sqldb.Integration.findOne({
    where: {
      name: req.pathParams.app,
    },
  });
  if (!appRecord) return 'App not found';
  if (appRecord.apiKey !== token) {
    return 'Invalid api key';
  }
  req.appRecord = appRecord.dataValues;
  return undefined;
};

const app = async (req, res, next) => {
  const error = await appCheck(req);
  if (error) {
    return invalid(res, error);
  }
  return next();
};

// The requester is an admin; createApps and other admin tasks
const adminCheck = async req => {
  const token = getToken({ req });
  if (token !== adminKey) return 'Invalid admin key';
  return undefined;
};

const admin = async (req, res, next) => {
  const error = await adminCheck(req);
  if (error) {
    return invalid(res, error);
  }
  return next();
};

// the request is from a user, checke the userId agains the url param
const userCheck = async req => {
  const token = getToken({ req });
  if (!token) return 'Token not found';
  let userId;
  try {
    ({ userId } = jsonwebtoken.verify(token, jwtSecret));
  } catch (err) {
    return 'Invalid token';
  }
  if (!userId) return 'UserId not found';
  if (req.params.userId && userId !== req.params.userId) {
    return 'Non matching user id';
  }
  return undefined;
};

const user = async (req, res, next) => {
  const error = await userCheck(req);
  if (error) {
    return invalid(res, error);
  }
  return next();
};

// The requester comes from frontend; frontend driven tasks
const frontendCheck = async req => {
  const token = getToken({ req });
  if (token !== frontendKey) {
    return 'Invalid frontend token';
  }
  return undefined;
};

const frontend = async (req, res, next) => {
  const error = await frontendCheck(req);
  if (error) {
    return invalid(res, error);
  }
  return next();
};

const multipleAuthEval = levels => async (req, res, next) => {
  // res.send = true;
  const results = await Promise.all(levels.map(
    levelCheck => levelCheck(req),
  ));
  if (results.some(val => !val)) {
    return next();
  }
  return invalid(res, results.join(' or '));
};

module.exports = {
  app,
  frontend,
  admin,
  user,
  'admin,user': multipleAuthEval([adminCheck, userCheck]),
  'admin,app,user': multipleAuthEval([adminCheck, appCheck, userCheck]),
};
