module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('CronJobs', 'token', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('CronJobs', 'token');
  }
};
