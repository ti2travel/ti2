const { redisResults, queue } = require('./worker/queue');

module.exports = async () => {
  await queue.close();
  await redisResults.quit();
};
