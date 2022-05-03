/* global afterAll */

const closeAll = require('./closeAll');

afterAll(async () => {
  await closeAll();
});

global.sleep = (ms = 300) => new Promise(r => {
  setTimeout(r, ms);
});
