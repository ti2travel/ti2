module.exports = {
  up: (queryInterface, Sequelize) => queryInterface
    .createTable('UserIntegrationSettings', {
      integrationId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
      },
      userId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
      },
      settings: {
        allowNull: false,
        type: Sequelize.TEXT,
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
  down: queryInterface => queryInterface.dropTable('UserIntegrationSettings'),
};
