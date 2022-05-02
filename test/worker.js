// tests only file, should not be ran by itself

const worker = require('../worker/index')({ plugins: [] });

worker.then(() => {});
