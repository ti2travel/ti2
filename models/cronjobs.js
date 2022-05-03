const Sequelize = require('sequelize');
const db = require('./db');

const CronJobs = db.define('CronJobs', {
  pluginName: {
    type: Sequelize.STRING,
    primaryKey: true,
  },
  userId: {
    type: Sequelize.STRING,
    primaryKey: true,
  },
  hint: {
    type: Sequelize.STRING,
    primaryKey: true,
  },
  pluginJobId: {
    type: Sequelize.STRING,
    primaryKey: true,
  },
  bullJobId: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  cron: {
    type: Sequelize.STRING,
    allowNull: false,
  },
}, {});

module.exports = CronJobs;
