module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('IntegrationLifecycles', {
      userId: {
        type: Sequelize.STRING(64),
        allowNull: false,
        primaryKey: true,
      },
      integrationId: {
        type: Sequelize.STRING(100),
        allowNull: false,
        primaryKey: true,
      },
      hint: {
        type: Sequelize.STRING(256),
        allowNull: false,
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
      requestedBy: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      requestedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      artifacts: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      lastError: {
        type: Sequelize.TEXT,
        allowNull: true,
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

  down: async queryInterface => {
    await queryInterface.dropTable('IntegrationLifecycles');
  },
};
