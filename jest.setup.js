/* global beforeAll afterAll */

const closeAll = require('./closeAll');
const models = require('./models');

// Setup global beforeAll and afterAll hooks
beforeAll(async () => {
  // Ensure database connection is established before tests
  if (models.sequelize && typeof models.sequelize.authenticate === 'function') {
    await models.sequelize.authenticate();
  }
});

// Make sure all connections are properly closed after tests
afterAll(async () => {
  // Wait a bit to ensure all pending operations are completed
  await global.sleep(100);
  
  // Then close all connections
  await closeAll();
});

global.sleep = (ms = 300) => new Promise(r => {
  setTimeout(r, ms);
});
