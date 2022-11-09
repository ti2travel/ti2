const Sequelize = require('sequelize');
const db = require('./db');
const { encrypt, decrypt } = require('../lib/security');

const UserIntegrationSettings = db.define('UserIntegrationSettings', {
  userId: {
    primaryKey: true,
    type: Sequelize.STRING,
    allowNull: false,
    validate: {
      is: /^((?!true|false|TRUE|FALSE).){1,255}$/,
    },
  },
  integrationId: {
    primaryKey: true,
    type: Sequelize.STRING,
    allowNull: false,
    validate: {
      is: /^((?!true|false|TRUE|FALSE).){1,255}$/,
    },
  },
  settings: {
    type: Sequelize.TEXT,
    allowNull: false,
  },
}, {
  getterMethods: {
    settings() {
      if (!this.getDataValue('settings')) { // there is no setting
        return {};
      }
      return JSON.parse(decrypt(this.getDataValue('settings')));
    },
  },
  setterMethods: {
    settings(value) {
      this.setDataValue('settings', encrypt(JSON.stringify(value)));
    },
  },
});

UserIntegrationSettings.associate = models => {
  UserIntegrationSettings.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user',
  });
  UserIntegrationSettings.belongsTo(models.Integration, {
    foreignKey: 'integrationId',
    as: 'integration',
  });
};
module.exports = UserIntegrationSettings;
