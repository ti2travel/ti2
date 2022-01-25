const jwt = require('jwt-promise');
const { omit } = require('ramda');
const sqldb = require('../models');

const { env: { jwtSecret } } = process;

const jwtEncode = async (req, res, next) => {
  try {
    const value = await jwt.sign(req.body, `${req.appRecord.name}.${jwtSecret}`);
    return res.json({ value });
  } catch (err) {
    return next(err);
  }
};

const createAppToken = async (req, res, next) => {
  const {
    body: {
      tokenHint: hint,
      token: appKey,
    },
    params: {
      app: integrationId,
      userId,
    },
  } = req;
  try {
    const payload = {
      integrationId,
      userId,
      hint,
      appKey,
    };
    // check if the user exists
    const userRecord = await sqldb.User.findOne({ where: { userId } });
    if (!userRecord) { // create the user record
      await sqldb.User.create({ userId });
    }
    // check if the user alrady has the same app with the same hint
    const userAppKeyDup = await sqldb.UserAppKey.findOne({
      where: { userId, integrationId, hint },
    });
    if (userAppKeyDup) await userAppKeyDup.destroy();
    const newAppKey = await sqldb.UserAppKey.create(payload);
    return res.json({ value: newAppKey.get('id').toString() });
  } catch (err) {
    return next(err);
  }
};

const deleteAppToken = async (req, res, next) => {
  const {
    body: {
      tokenHint: hint,
    },
    params: {
      app: integrationId,
      userId,
    },
  } = req;
  // check if the user exists
  const userRecord = await sqldb.User.findOne({ where: { userId } });
  if (!userRecord) return next({ status: 404, message: 'User does not exists' });
  const retVal = await sqldb.UserAppKey.destroy({
    where: {
      integrationId,
      userId,
      hint,
    },
  });
  if (retVal === 0) return next({ status: 404, message: 'Key not found' });
  return res.json({ message: `${retVal} erased` });
};

const listAppTokens = async (req, res, next) => {
  const { params: { app: integrationId } } = req;
  try {
    const userAppKeys = (await sqldb.UserAppKey.findAll({ where: { integrationId } }))
      .map(userAppKey => userAppKey.dataValues);
    return res.json({ userAppKeys: userAppKeys.map(userAppKey => omit(['appKey', 'id'], userAppKey)) });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  jwtEncode,
  createAppToken,
  deleteAppToken,
  listAppTokens,
};
