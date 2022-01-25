const Sequelize = require('sequelize');

const {
  env: {
    DB_URL,
  },
} = process;

const options = {
  operatorsAliases: false,
  logging: false,
};

const sequelize = new Sequelize(DB_URL, options);

module.exports = sequelize;
