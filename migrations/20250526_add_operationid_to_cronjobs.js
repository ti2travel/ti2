const Sequelize = require('sequelize');

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.addColumn('CronJobs', 'operationId', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('CronJobs', 'callbackUrl', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'URL to send operation results to',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('CronJobs', 'operationId');
    await queryInterface.removeColumn('CronJobs', 'callbackUrl');
  }
};
