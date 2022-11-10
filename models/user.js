const Sequelize = require('sequelize');
const db = require('./db');

const User = db.define('User', {
  userId: {
    type: Sequelize.STRING,
    primaryKey: true,
  },
}, {});
User.associate = models => {
  User.hasMany(models.UserAppKey, {
    foreignKey: 'userId',
  });
  User.hasMany(models.UserIntegrationSettings, {
    foreignKey: 'userId',
  });
  // associations can be defined here
};

module.exports = User;
