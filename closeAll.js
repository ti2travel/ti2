const { redisResults, queue } = require('./worker/queue');
const { cache } = require('./cache');
const { sequelize } = require('./models');

module.exports = async () => {
  // Close queue and redis connections
  await queue.close();
  await redisResults.quit();
  await cache.quit();
  
  // Close database connection if it exists and is open
  if (sequelize && typeof sequelize.close === 'function') {
    try {
      await sequelize.close();
    } catch (err) {
      // If connection is already closed, ignore the error
      if (!err.message.includes('Connection already closed')) {
        console.error('Error closing sequelize connection:', err);
      }
    }
  }
};
