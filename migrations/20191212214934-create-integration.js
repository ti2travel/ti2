module.exports = {
  up: (queryInterface, Sequelize) => queryInterface
    .createTable('Integrations', {
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      packageName: {
        type: Sequelize.STRING,
      },
      adminEmail: {
        type: Sequelize.STRING,
      },
      apiKey: {
        type: Sequelize.STRING,
      },
      lastSeen: {
        type: Sequelize.INTEGER,
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
  down: queryInterface => queryInterface.dropTable('Integrations'),
};
