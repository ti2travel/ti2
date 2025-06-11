const Sequelize = require('sequelize');
const db = require('./db');

const ApiCronJobs = db.define('ApiCronJobs', {
  id: {
    type: Sequelize.UUID,
    defaultValue: Sequelize.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  bullJobId: {
    type: Sequelize.STRING,
    // It might be null initially until the afterCreate hook successfully adds the job
    allowNull: true,
  },
  cron: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  method: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  url: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  token: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  body: {
    type: Sequelize.JSON,
    allowNull: true, // Assuming body can be optional
  },
  removeOnComplete: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  }
}, {
  hooks: {
    afterCreate: async (apiCronJob, options) => {
      const { addJob } = require('../worker/queue');
      const jobPayload = {
        type: 'api',
        method: apiCronJob.method,
        url: apiCronJob.url,
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${apiCronJob.token}`,
        },
        payload: (apiCronJob.body || {}),
      };

        const jobParams = {
          repeat: {
            cron: apiCronJob.cron,
          },
          removeOnComplete: apiCronJob.removeOnComplete,
        };

      try {
        // The addJob must be part of the same transaction that created apiCronJob
        const bullJobId = await addJob(jobPayload, jobParams, options.transaction);
        // Update the instance with the bullJobId and save it within the same transaction
        // Note: This will trigger update hooks if any are defined, which is generally fine.
        // apiCronJob.bullJobId = bullJobId;
        await apiCronJob.update({ bullJobId }, { transaction: options.transaction, hooks: false });
      } catch (err) {
        // If addJob or the subsequent save fails, the transaction should be rolled back
        // by the controller that initiated it.
        // We re-throw the error to ensure the transaction is rolled back.
        console.error('Failed to create Bull job or save bullJobId:', err);
        throw err; // This will trigger the rollback in the controller
      }
    },
    beforeDestroy: async (apiCronJob, options) => {
      const { removeJob } = require('../worker/queue');
      try {
        // The removeJob must be part of the same transaction
        await removeJob(apiCronJob.bullJobId, options.transaction);
      } catch (err) {
        // If removeJob fails, the transaction should be rolled back.
        console.error('Failed to remove Bull job:', err);
        throw err; // This will trigger the rollback in the controller
      }
    },
  },
});

module.exports = ApiCronJobs;

