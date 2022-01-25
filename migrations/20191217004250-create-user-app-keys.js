module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.createTable('UserAppKeys', {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: Sequelize.INTEGER,
    },
    integrationId: {
      type: Sequelize.STRING,
      allowNull: false,
      references: {
        model: 'Integrations',
        key: 'name',
      },
    },
    userId: {
      type: Sequelize.STRING,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'userId',
      },
    },
    appKey: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    hint: {
      type: Sequelize.STRING,
      allowNull: false,
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
  down: queryInterface => queryInterface.dropTable('UserAppKeys'),
};
