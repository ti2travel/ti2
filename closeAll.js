const { redisResults, queue } = require('./worker/queue');
const { cache } = require('./cache');
const { sequelize } = require('./models');

module.exports = async () => {
  try {
    // Close database connection first
    if (sequelize && typeof sequelize.close === 'function') {
      await sequelize.close();
    }
    
    // Then close Redis connections
    if (queue && typeof queue.close === 'function') {
      await queue.close();
    }
    if (redisResults && typeof redisResults.quit === 'function') {
      await redisResults.quit();
    }
    if (cache && typeof cache.quit === 'function') {
      await cache.quit();
    }
  } catch (error) {
    console.error('Error closing connections:', error);
  }
};
