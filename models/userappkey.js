const jwt = require('jsonwebtoken');
const Sequelize = require('sequelize');
const R = require('ramda');
const { encrypt, decrypt } = require('../lib/security');
const db = require('./db');

const { env: { dbCryptoKey } } = process;
const removeEmptyAttributes = obj => R.reject(R.anyPass([R.isEmpty, R.isNil]))(obj);

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
        this.setDataValue(field, encrypt(value));
      }
    },
  },
  token: {
    type: Sequelize.VIRTUAL,
    async get() {
      if (!this.getDataValue('appKey')) return {};
      if (!decrypt(this.getDataValue('appKey'))) return {};
      const sqldb = require('./index');
      const userIntegrationSettings = await sqldb.UserIntegrationSettings.findOne({
        where: { userId: this.getDataValue('userId'), integrationId: this.getDataValue('integrationId') },
      });
      const appKey = JSON.parse(decrypt(this.getDataValue('appKey')));
      return {
        ...R.pathOr({}, ['settings'], userIntegrationSettings),
        ...removeEmptyAttributes(appKey),
        ...(this.getDataValue('configuration') ? { configuration: this.getDataValue('configuration') } : {}),
      };
    },
  },
  configuration: {
    type: Sequelize.JSON,
    allowNull: true,
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
