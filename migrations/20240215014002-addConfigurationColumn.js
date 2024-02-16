module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn(
    'UserAppKeys',
    'configuration',
    {
      type: Sequelize.JSON,
      allowNull: true,
      validate: {},
    },
  ),
  down: queryInterface => queryInterface.removeColumn('UserAppKeys', 'configuration'),
};
