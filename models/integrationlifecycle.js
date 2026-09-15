const Sequelize = require('sequelize');
const db = require('./db');

const IntegrationLifecycle = db.define('IntegrationLifecycle', {
  userId: {
    type: Sequelize.STRING(64),
    primaryKey: true,
  },
  integrationId: {
    type: Sequelize.STRING(100),
    primaryKey: true,
  },
  hint: {
    type: Sequelize.STRING(256),
    primaryKey: true,
  },
  generation: {
    type: Sequelize.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 1,
  },
  status: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  requestId: {
    type: Sequelize.STRING(64),
    allowNull: false,
  },
  retryCount: {
    type: Sequelize.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
  },
  requestedBy: Sequelize.STRING,
  requestedAt: {
    type: Sequelize.DATE,
    allowNull: false,
  },
  artifacts: Sequelize.JSON,
  lastError: Sequelize.TEXT,
}, {});

module.exports = IntegrationLifecycle;
