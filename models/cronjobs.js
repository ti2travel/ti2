const Sequelize = require('sequelize');
const db = require('./db');

const CronJobs = db.define('CronJobs', {
  pluginName: {
    type: Sequelize.STRING,
    primaryKey: true,
  },
  pluginJobId: {
    type: Sequelize.STRING,
    primaryKey: true,
  },
  cron: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  bullJobId: {
    type: Sequelize.STRING,
    allowNull: false,
  },
}, {});

module.exports = CronJobs;
