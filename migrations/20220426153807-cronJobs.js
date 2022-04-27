module.exports = {
  up: (queryInterface, Sequelize) => queryInterface
    .createTable('CronJobs', {
      pluginName: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
      },
      userId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
      },
      hint: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
      },
      pluginJobId : {
        allowNull: false,
        type: Sequelize.STRING,
      },
      bullJobId : {
        allowNull: false,
        type: Sequelize.STRING,
      },
      cron : {
        allowNull: false,
        type: Sequelize.STRING,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    }),
  down: queryInterface => queryInterface.dropTable('CronJobs'),
};
