const jwt = require('jsonwebtoken');
const Sequelize = require('sequelize');
const { omit, pathOr } = require('ramda');
const { encrypt, decrypt } = require('../lib/security');
const db = require('./db');

const { env: { dbCryptoKey } } = process;

const UserAppKey = db.define('UserAppKey', {
  id: {
    allowNull: false,
    type: Sequelize.INTEGER(10),
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: Sequelize.STRING,
    allowNull: false,
    validate: {
      is: /^((?!true|false|TRUE|FALSE).){1,255}$/,
    },
  },
  integrationId: {
    type: Sequelize.STRING,
    allowNull: false,
    validate: {
      is: /^((?!true|false|TRUE|FALSE).){1,255}$/,
    },
  },
  hint: {
    type: Sequelize.STRING,
    allowNull: false,
    validate: {
      is: /^((?!true|false|TRUE|FALSE).){1,255}$/,
    },
  },
  appKey: {
    type: Sequelize.TEXT,
    allowNull: false,
    set: function setter(value, field) {
      if (typeof value === 'object') {
        const newValue = encrypt(JSON.stringify(value));
        this.setDataValue(field, newValue);
      } else {
        this.setDataValue(field, value);
      }
    },
  },
  token: {
    type: Sequelize.VIRTUAL,
    async get() {
      const sqldb = require('./index');
      const userIntegrationSettings = await sqldb.UserIntegrationSettings.findOne({
        where: { userId: this.getDataValue('userId'), integrationId: this.getDataValue('integrationId') },
      });
      const appKey = JSON.parse(decrypt(this.getDataValue('appKey')));
      return {
        ...pathOr({}, ['settings'], userIntegrationSettings),
        ...appKey,
      };
    },
  },
}, {});
UserAppKey.associate = models => {
  UserAppKey.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user',
  });
  UserAppKey.belongsTo(models.Integration, {
    foreignKey: 'integrationId',
    as: 'integration',
  });
};
module.exports = UserAppKey;
