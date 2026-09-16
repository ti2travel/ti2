const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');

const sqldb = require('../models');
const { removeJob } = require('../worker/queue');

const identityWhere = ({ userId, integrationId, hint }) => ({
  userId,
  integrationId,
  hint,
});

const lifecycleError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const newRequestId = () => crypto.randomBytes(16).toString('hex');

const callCatalogLifecycle = async ({
  action,
  userId,
  integrationId,
  hint,
  generation,
}) => {
  const catalogLifecycleUrl = process.env.PYFILEMATCH_URL;
  if (!catalogLifecycleUrl) {
    return {
      status: action === 'activate' ? 'active' : 'deleted',
      generation,
      skipped: true,
      reason: 'catalog_lifecycle_not_configured',
    };
  }
  const response = await axios.post(
    `${catalogLifecycleUrl}/productSync/integration-lifecycle`,
    {
      action,
      companyId: userId,
      integrationId,
      hint,
      generation,
    },
    { timeout: Number(process.env.PYFILEMATCH_TIMEOUT_MS) || 30e3 },
  );
  return response.data;
};

const prepareActivation = async ({
  userId,
  integrationId,
  hint,
  transaction,
}) => {
  const where = identityWhere({ userId, integrationId, hint });
  let lifecycle = await sqldb.IntegrationLifecycle.findOne({
    where,
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (lifecycle && ['deleting', 'external_cleanup', 'failed'].includes(lifecycle.status)) {
    throw lifecycleError(409, 'Integration removal must finish before this integration can be saved again.');
  }
  if (!lifecycle) {
    lifecycle = await sqldb.IntegrationLifecycle.create({
      ...where,
      generation: 1,
      status: 'provisioning',
      requestId: newRequestId(),
      retryCount: 0,
      requestedAt: new Date(),
      artifacts: { requiresCatalogActivation: false },
    }, { transaction });
  } else if (lifecycle.status === 'complete') {
    lifecycle.generation += 1;
    lifecycle.status = 'provisioning';
    lifecycle.requestId = newRequestId();
    lifecycle.retryCount = 0;
    lifecycle.requestedAt = new Date();
    lifecycle.lastError = null;
    lifecycle.artifacts = { requiresCatalogActivation: true };
    await lifecycle.save({ transaction });
  } else {
    lifecycle.status = 'provisioning';
    lifecycle.lastError = null;
    if (!lifecycle.artifacts || typeof lifecycle.artifacts !== 'object') {
      lifecycle.artifacts = { requiresCatalogActivation: false };
    }
    await lifecycle.save({ transaction });
  }
  return lifecycle;
};

const activateCatalog = async lifecycle => {
  const result = await callCatalogLifecycle({
    action: 'activate',
    userId: lifecycle.userId,
    integrationId: lifecycle.integrationId,
    hint: lifecycle.hint,
    generation: lifecycle.generation,
  });
  if (!result || result.status !== 'active') {
    throw lifecycleError(409, 'A newer integration lifecycle already exists.');
  }
  return result;
};

const completeActivation = lifecycle => sqldb.IntegrationLifecycle.update({
  status: 'active',
  artifacts: null,
  lastError: null,
}, {
  where: {
    ...identityWhere(lifecycle),
    generation: lifecycle.generation,
    status: 'provisioning',
  },
});

const failActivation = (lifecycle, error) => sqldb.IntegrationLifecycle.update({
  status: 'failed_activation',
  lastError: error.message,
}, {
  where: {
    ...identityWhere(lifecycle),
    generation: lifecycle.generation,
    status: 'provisioning',
  },
});

const beginDeletion = async ({
  userId,
  integrationId,
  hint,
  requestedBy,
}) => {
  const where = identityWhere({ userId, integrationId, hint });
  return sqldb.sequelize.transaction(async transaction => {
    await sqldb.User.findOne({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    let lifecycle = await sqldb.IntegrationLifecycle.findOne({
      where,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (lifecycle && ['complete', 'external_cleanup'].includes(lifecycle.status)) {
      return lifecycle;
    }
    if (lifecycle && lifecycle.status === 'provisioning') {
      throw lifecycleError(409, 'Integration save is still finishing. Retry removal shortly.');
    }
    if (!lifecycle) {
      lifecycle = await sqldb.IntegrationLifecycle.create({
        ...where,
        generation: 1,
        status: 'deleting',
        requestId: newRequestId(),
        retryCount: 0,
        requestedBy,
        requestedAt: new Date(),
      }, { transaction });
      return lifecycle;
    }
    if (['active', 'failed_activation'].includes(lifecycle.status)) {
      lifecycle.generation += 1;
      lifecycle.requestId = newRequestId();
      lifecycle.retryCount = 0;
      lifecycle.requestedAt = new Date();
    } else {
      lifecycle.retryCount += 1;
    }
    lifecycle.status = 'deleting';
    lifecycle.requestedBy = requestedBy;
    lifecycle.lastError = null;
    await lifecycle.save({ transaction });
    return lifecycle;
  });
};

const cleanupSchedules = async ({
  userId,
  integrationId,
  hint,
}) => {
  const where = {
    userId,
    hint,
    pluginName: integrationId,
  };
  return sqldb.sequelize.transaction(async transaction => {
    const schedules = await sqldb.CronJobs.findAll({
      where,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    /* eslint-disable no-await-in-loop */
    // Sequential removal keeps each Bull deletion paired with its locked database row.
    for (const schedule of schedules) { // eslint-disable-line no-restricted-syntax
      const references = await sqldb.CronJobs.findAll({
        where: { bullJobId: schedule.bullJobId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (references.length === 1) await removeJob(schedule.bullJobId);
      await schedule.destroy({ transaction });
    }
    /* eslint-enable no-await-in-loop */
    return schedules.length;
  });
};

const cleanupCredentialAndSettings = ({ userId, integrationId, hint }) => (
  sqldb.sequelize.transaction(async transaction => {
    await sqldb.User.findOne({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const credentials = await sqldb.UserAppKey.destroy({
      where: identityWhere({ userId, integrationId, hint }),
      transaction,
    });
    const remainingHints = await sqldb.UserAppKey.count({
      where: { userId, integrationId },
      transaction,
    });
    const settings = remainingHints === 0
      ? await sqldb.UserIntegrationSettings.destroy({
        where: { userId, integrationId },
        transaction,
      })
      : 0;
    return { credentials, settings };
  })
);

const deleteIntegration = async ({
  userId,
  integrationId,
  hint,
  requestedBy,
  deferCompletion = false,
}) => {
  const lifecycle = await beginDeletion({
    userId,
    integrationId,
    hint,
    requestedBy,
  });
  if (['complete', 'external_cleanup'].includes(lifecycle.status)) {
    return lifecycle.get({ plain: true });
  }

  const where = identityWhere({ userId, integrationId, hint });
  let failureStage = 'schedule cleanup';
  let observedArtifacts = lifecycle.artifacts || {};
  try {
    const cronJobs = await cleanupSchedules({ userId, integrationId, hint });
    const previousArtifacts = { ...observedArtifacts };
    delete previousArtifacts.failureStage;
    observedArtifacts = {
      ...previousArtifacts,
      cronJobs: Math.max(previousArtifacts.cronJobs || 0, cronJobs),
    };
    await sqldb.IntegrationLifecycle.update({ artifacts: observedArtifacts }, {
      where: {
        ...where,
        generation: lifecycle.generation,
        status: { [Op.in]: ['deleting', 'failed'] },
      },
    });
    failureStage = 'credential and settings cleanup';
    const { credentials, settings } = await cleanupCredentialAndSettings({
      userId,
      integrationId,
      hint,
    });
    observedArtifacts = {
      ...observedArtifacts,
      credentials: Math.max(observedArtifacts.credentials || 0, credentials),
      settings: Math.max(observedArtifacts.settings || 0, settings),
    };
    await sqldb.IntegrationLifecycle.update({ artifacts: observedArtifacts }, {
      where: {
        ...where,
        generation: lifecycle.generation,
        status: { [Op.in]: ['deleting', 'failed'] },
      },
    });
    failureStage = 'product catalog cleanup';
    const catalog = await callCatalogLifecycle({
      action: 'delete',
      userId,
      integrationId,
      hint,
      generation: lifecycle.generation,
    });
    if (!catalog || catalog.status !== 'deleted') {
      throw new Error('Product catalog cleanup did not complete.');
    }
    const artifacts = {
      ...observedArtifacts,
      catalog,
    };
    const status = deferCompletion ? 'external_cleanup' : 'complete';
    await sqldb.IntegrationLifecycle.update({
      status,
      artifacts,
      lastError: null,
    }, {
      where: {
        ...where,
        generation: lifecycle.generation,
        status: { [Op.in]: ['deleting', 'failed'] },
      },
    });
    return {
      ...where,
      generation: lifecycle.generation,
      requestId: lifecycle.requestId,
      requestedAt: lifecycle.requestedAt,
      retryCount: lifecycle.retryCount,
      status,
      artifacts,
    };
  } catch (error) {
    await sqldb.IntegrationLifecycle.update({
      status: 'failed',
      artifacts: { ...observedArtifacts, failureStage },
      lastError: error.message,
    }, {
      where: {
        ...where,
        generation: lifecycle.generation,
        status: 'deleting',
      },
    });
    throw lifecycleError(
      503,
      `Integration cleanup stopped at ${failureStage} and can be retried: ${error.message}`,
    );
  }
};

const completeDeletion = async ({
  userId,
  integrationId,
  hint,
  generation,
  externalArtifacts,
}) => sqldb.sequelize.transaction(async transaction => {
  const where = identityWhere({ userId, integrationId, hint });
  const lifecycle = await sqldb.IntegrationLifecycle.findOne({
    where,
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!lifecycle || lifecycle.generation !== generation) {
    throw lifecycleError(409, 'Integration cleanup generation no longer matches.');
  }
  if (lifecycle.status === 'complete') return lifecycle.get({ plain: true });
  if (lifecycle.status !== 'external_cleanup') {
    throw lifecycleError(409, 'Integration cleanup is not ready to finalize.');
  }
  lifecycle.status = 'complete';
  lifecycle.artifacts = {
    ...(lifecycle.artifacts || {}),
    external: externalArtifacts || {},
  };
  lifecycle.lastError = null;
  await lifecycle.save({ transaction });
  return lifecycle.get({ plain: true });
});

module.exports = {
  activateCatalog,
  completeActivation,
  completeDeletion,
  deleteIntegration,
  failActivation,
  prepareActivation,
};
