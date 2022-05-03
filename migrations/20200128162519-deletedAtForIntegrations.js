module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn(
    'Integrations',
    'deletedAt',
    {
      type: Sequelize.DATE,
      allowNull: true,
      validate: {
      },
    },
  ),
  down: queryInterface => queryInterface.removeColumn('Integrations', 'deletedAt'),
};
