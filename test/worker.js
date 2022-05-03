// tests only file, should not be execute by itself

const worker = require('../worker/index')({ plugins: [] });

worker.then(() => {});
