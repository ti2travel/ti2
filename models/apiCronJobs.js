const Sequelize = require('sequelize');
const db = require('./db');

const ApiCronJobs = db.define('ApiCronJobs', {
  id: {
    type: Sequelize.UUID,
    defaultValue: Sequelize.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  bullJobId: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  cron: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  method: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  url: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  token: {
    type: Sequelize.STRING,
    allowNull: false,
  }
}, {});

module.exports = ApiCronJobs;

