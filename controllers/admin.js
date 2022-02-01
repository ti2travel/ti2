const jwt = require('jsonwebtoken');
const assert = require('assert');
const { omit } = require('ramda');
const sqldb = require('../models');

const { env: { jwtSecret } } = process;

const createApp = async (req, res, next) => {
  const {
    name,
    packageName,
    adminEmail,
  } = req.body;
  try {
    const newApp = await sqldb.Integration.create({
      name,
      packageName,
      adminEmail,
    });
    const { apiKey } = newApp;
    return res.json({ value: apiKey });
  } catch (err) {
    return next(err);
  }
};

const listApps = async (req, res, next) => {
  try {
    const integrations = (await sqldb.Integration.findAll())
      .map(int => omit(['apiKey'], int.dataValues));
    return res.json({ integrations });
  } catch (err) {
    return next(err);
  }
};

const createUserToken = async (req, res, next) => {
  const {
    body: {
      userId,
    },
  } = req;
  if (!userId) {
    assert(userId, 'No user provided');
    // return next({ status: 404 });
  }
  try {
    // check that the user exists or create it
    if (!(await sqldb.User.findOne(({ where: { userId }, raw: true })))) {
      await sqldb.User.create({ userId });
    }
    const value = jwt.sign({ userId }, jwtSecret);
    return res.json({ value });
  } catch (err) {
    return next(err);
  }
};

const resetIntegrationToken = async (req, res, next) => {
  const { pathParams: { appKey: name } } = req;
  try {
    const integration = await sqldb.Integration.findOne({ where: { name } });
    assert(Boolean(integration) !== false);
    const value = sqldb.Integration.generateKey();
    integration.apiKey = value;
    integration.save();
    return res.json({ value });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createApp,
  createUserToken,
  listApps,
  resetIntegrationToken,
};
