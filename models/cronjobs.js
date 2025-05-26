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
  operationId: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'OpenAPI operationId to execute as a cronjob',
  },
  callbackUrl: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'URL to send operation results to',
  }
}, {});

module.exports = CronJobs;
