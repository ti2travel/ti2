const jwt = require('jsonwebtoken');
const Sequelize = require('sequelize');
const { omit } = require('ramda');
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
      const newValue = jwt.sign(value, dbCryptoKey);
      this.setDataValue(field, newValue);
    },
    get: function getter(field) {
      const retValue = jwt.verify(this.getDataValue(field), dbCryptoKey);
      return omit(['iat'], retValue);
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
