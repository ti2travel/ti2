const jwt = require('jsonwebtoken');
const assert = require('assert');
const { omit } = require('ramda');
const { Umzug, SequelizeStorage } = require('umzug');
const Sequelize = require('sequelize');
const fs = require('fs').promises;
const path = require('path');

const sqldb = require('../models');

const { env: { jwtSecret } } = process;

const createApp = async (req, res, next) => {
  const {
    name,
    packageName,
    adminEmail,
  } = req.body;
  try {
    const existing = await sqldb.Integration.findByPk(name, { paranoid: false });
    const apiKey = await (async () => {
      if (existing) {
        await existing.restore();
        return existing.apiKey;
      }
      const newApp = await sqldb.Integration.create({
        name,
        packageName,
        adminEmail,
      });
      return newApp.apiKey;
    })();
    return res.json({ value: apiKey });
  } catch (err) {
    return next(err);
  }
};

const deleteApp = async (req, res, next) => {
  const { pathParams: { appKey: name } } = req;
  try {
    const newApp = await sqldb.Integration.destroy({
      where: { name },
    });
    const { apiKey } = newApp;
    return res.json({ value: apiKey });
  } catch (err) {
    console.log({ err });
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

const migrate = async ({ action }) => {
  const { sequelize } = sqldb;
  const migrationsPath = path.join(
    __dirname,
    '../',
    'migrations',
  );
  try {
    await fs.access(migrationsPath);
  } catch (err) {
    throw Error(`Could not find any migrations on ${migrationsPath}`);
  }
  const umzug = new Umzug({
    migrations: {
      glob: `${migrationsPath}/*.js`,
      // inject sequelize's QueryInterface in the migrations
      resolve: ({ name, path: migPath, context }) => {
        const migration = require(migPath);
        return {
          // adjust the parameters Umzug will
          // pass to migration methods when called
          name,
          up: async () => migration.up(context, Sequelize),
          down: async () => migration.down(context, Sequelize),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({
      sequelize,
    }),
    logger: console,
  });
  if (action === 'migrate') {
    return umzug.up();
  }
  if (action === 'revert') {
    return umzug.down({ to: 0 });
  }
  throw Error('No recognized action');
};

module.exports = {
  createApp,
  deleteApp,
  createUserToken,
  listApps,
  resetIntegrationToken,
  migrate,
};
