module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create a new table with the updated schema
    await queryInterface.createTable('ApiCronJobs', {
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
        allowNull: true,
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
      callbackUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      token: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      body: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      removeOnComplete: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('ApiCronJobs');
  },
};
