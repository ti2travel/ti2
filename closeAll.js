const { redisResults, queue } = require('./worker/queue');
const { cache } = require('./cache');

module.exports = async () => {
  await queue.close();
  await redisResults.quit();
  await cache.quit();
};
