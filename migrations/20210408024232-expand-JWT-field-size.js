module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.changeColumn('UserAppKeys', 'appKey', {
    type: Sequelize.TEXT,
    allowNull: false,
  }),
  down: (queryInterface, Sequelize) =>  queryInterface.changeColumn('UserAppKeys', 'appKey', {
    type: Sequelize.STRING,
    allowNull: false,
  })
};
