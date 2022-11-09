const Sequelize = require('sequelize');
const db = require('./db');
const { generateKey, encrypt, decrypt } = require('../lib/security');

const Integration = db.define('Integration', {
  name: {
    type: Sequelize.STRING,
    primaryKey: true,
    allowNull: false,
    validate: {
      is: /^((?!true|false|TRUE|FALSE).){1,255}$/,
    },
  },
  packageName: Sequelize.STRING,
  adminEmail: Sequelize.STRING,
  apiKey: {
    type: Sequelize.STRING,
    defaultValue: () => {
      const newKey = generateKey();
      return encrypt(newKey);
    },
  },
  lastSeen: Sequelize.INTEGER,
}, {
  paranoid: true,
  getterMethods: {
    apiKey() {
      if (!this.getDataValue('apiKey')) { // there is no secret, probably is a combined request
        return generateKey();
      }
      return decrypt(this.getDataValue('apiKey'));
    },
  },
  setterMethods: {
    apiKey(value) {
      return encrypt(value);
    },
  },
});

Integration.associate = models => {
  Integration.hasMany(models.UserAppKey, {
    foreignKey: 'integrationId',
  });
  Integration.hasMany(models.UserIntegrationSettings, {
    foreignKey: 'integrationId',
  });
};
Integration.generateKey = generateKey;

module.exports = Integration;
