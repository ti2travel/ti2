const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');

const sqldb = require('../models');
const { removeJob } = require('../worker/queue');
const {
  beginSupplierCacheDeletion,
  dropIfValue,
  dropMatching,
  dropProductSearch,
  endSupplierCacheDeletion,
  expireIfValue,
  saveIfNotExists,
  supplierCacheWritesActive,
} = require('../cache');
const productSearchCacheKey = require('../lib/productSearchCacheKey');
const { getSupplierOptionsAndRatesStore } = require('../lib/tourplanNxSupplierOptionsAndRatesStore');
const {
  supplierCachePatterns,
  supplierCachePrefixes,
  validSupplierCachePrefixes,
} = require('../lib/tourplanNxSupplierCache');

const DEFAULT_PROVISIONING_TIMEOUT_MS = 5 * 60e3;
const deletionLockTtlSeconds = () => {
  const configured = Number(process.env.DELETION_LOCK_TTL_SECONDS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 120;
};
const REFRESH_STILL_RUNNING = 'A product refresh is still running. Retry removal shortly.';
const SEARCH_STILL_WRITING = 'A search is still writing cached data. Retry removal shortly.';

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

const provisioningTimeoutMs = () => {
  const configured = Number(process.env.INTEGRATION_PROVISIONING_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_PROVISIONING_TIMEOUT_MS;
};

const provisioningIsStale = lifecycle => {
  const lastUpdatedAt = lifecycle.updatedAt || lifecycle.requestedAt;
  const lastUpdatedMs = new Date(lastUpdatedAt).getTime();
  return Number.isFinite(lastUpdatedMs)
    && Date.now() - lastUpdatedMs >= provisioningTimeoutMs();
};

const catalogLifecycleEndpoint = () => {
  const eventsUrl = process.env.ti2_events2url_eventsURL;
  if (!eventsUrl) return null;
  const endpoint = new URL(eventsUrl);
  endpoint.pathname = '/productSync/integration-lifecycle';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
};

const callCatalogLifecycle = async ({
  action,
  userId,
  integrationId,
  hint,
  generation,
}) => {
  const endpoint = catalogLifecycleEndpoint();
  if (!endpoint) {
    return {
      status: action === 'activate' ? 'active' : 'deleted',
      generation,
      skipped: true,
      reason: 'catalog_lifecycle_not_configured',
    };
  }
  try {
    const response = await axios.post(
      endpoint,
      {
        action,
        companyId: userId,
        integrationId,
        hint,
        generation,
      },
      {
        headers: {
          Authorization: process.env.ti2_events2url_authorization,
        },
        timeout: Number(process.env.INTEGRATION_LIFECYCLE_TIMEOUT_MS) || 30e3,
      },
    );
    return response.data;
  } catch (error) {
    const responseData = error.response && error.response.data;
    if (responseData && ['retry', 'superseded'].includes(responseData.status)) {
      return responseData;
    }
    throw error;
  }
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
  if (result && result.status === 'active') return result;
  if (result && result.status === 'superseded') {
    throw lifecycleError(409, 'A newer integration lifecycle already exists.');
  }
  if (result && result.status === 'retry') {
    throw lifecycleError(503, 'Product catalog activation is not ready and can be retried.');
  }
  throw lifecycleError(502, 'Product catalog activation returned an unexpected response.');
};

const activationWhere = lifecycle => ({
  ...identityWhere(lifecycle),
  generation: lifecycle.generation,
  status: 'provisioning',
});

const assertActivationOwnership = updatedRows => {
  if (updatedRows !== 1) {
    throw lifecycleError(409, 'Integration save was superseded by a newer lifecycle.');
  }
};

const touchActivation = async lifecycle => {
  const [updatedRows] = await sqldb.IntegrationLifecycle.update({
    updatedAt: new Date(),
  }, {
    where: activationWhere(lifecycle),
  });
  if (updatedRows === 1) return;
  // MySQL reports zero changed rows when a sub-second heartbeat rounds to the
  // same stored timestamp, so confirm the fenced row before treating it as lost.
  const current = await sqldb.IntegrationLifecycle.findOne({
    where: activationWhere(lifecycle),
  });
  if (!current) assertActivationOwnership(updatedRows);
};

const completeActivation = async lifecycle => {
  const [updatedRows] = await sqldb.IntegrationLifecycle.update({
    status: 'active',
    artifacts: null,
    lastError: null,
  }, {
    where: activationWhere(lifecycle),
  });
  assertActivationOwnership(updatedRows);
};

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
    if (
      lifecycle
      && lifecycle.status === 'provisioning'
      && !provisioningIsStale(lifecycle)
    ) {
      throw lifecycleError(409, 'Integration save is still finishing. Retry removal shortly.');
    }
    if (!lifecycle) {
      const credential = await sqldb.UserAppKey.findOne({
        where,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!credential) throw lifecycleError(404, 'Integration credential not found.');
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
    if (
      ['active', 'failed_activation'].includes(lifecycle.status)
      || (lifecycle.status === 'provisioning' && provisioningIsStale(lifecycle))
    ) {
      // Deletion intentionally advances beyond a failed/stale activation. The catalog
      // contract accepts a higher generation so an activation that committed remotely
      // before TI2 crashed cannot resurrect the integration.
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

const lifecycleUpdateWhere = ({ where, generation }) => ({
  where: {
    ...where,
    generation,
    status: { [Op.in]: ['deleting', 'failed'] },
  },
});

const rememberSupplierCachePrefixes = async ({
  userId,
  integrationId,
  hint,
  observedArtifacts,
}) => {
  if (integrationId !== 'tourplannx') return observedArtifacts;
  const retainedPrefixes = validSupplierCachePrefixes(observedArtifacts.supplierCachePrefixes);
  if (retainedPrefixes.length > 0) {
    const current = Array.isArray(observedArtifacts.supplierCachePrefixes)
      ? observedArtifacts.supplierCachePrefixes
      : [];
    const unchanged = current.length === retainedPrefixes.length
      && current.every((prefix, index) => prefix === retainedPrefixes[index]);
    if (unchanged) return observedArtifacts;
    return {
      ...observedArtifacts,
      supplierCachePrefixes: retainedPrefixes,
    };
  }
  const credential = await sqldb.UserAppKey.findOne({
    where: identityWhere({ userId, integrationId, hint }),
  });
  if (!credential) return observedArtifacts;
  let token;
  try {
    token = await credential.token;
  } catch (error) {
    // A corrupt credential has no readable URL, so its supplier prefix cannot be derived.
    // Removal must still finish; otherwise the user cannot delete and reconnect it.
    if (error.name !== 'CorruptedTokenError' && error.code !== 'CORRUPTED_TOKEN') throw error;
    return observedArtifacts;
  }
  const prefixes = supplierCachePrefixes({
    url: token && token.url,
    userId,
    hint,
  });
  if (prefixes.length === 0) return observedArtifacts;
  return {
    ...observedArtifacts,
    supplierCachePrefixes: prefixes,
  };
};

const deletionRenewIntervalMs = ttlSeconds => Math.max(250, Math.floor(ttlSeconds * 500));

// Keeps the catalog lock and deletion fence alive for the whole credential transaction.
const startDeletionProtectionRenewal = ({
  pluginName,
  keys,
  ownerToken,
  ttl,
}) => {
  let stopped = false;
  let lost = false;
  let inFlight = Promise.resolve();
  const renew = async () => {
    if (stopped || lost) return;
    const renewed = await Promise.all(keys.map(key => expireIfValue({
      pluginName,
      key,
      value: ownerToken,
      ttl,
    })));
    if (renewed.some(ok => !ok)) lost = true;
  };
  const interval = setInterval(() => {
    inFlight = renew().catch(() => {
      lost = true;
    });
  }, deletionRenewIntervalMs(ttl));
  if (interval.unref) interval.unref();
  return {
    lost: () => lost,
    stop: async () => {
      stopped = true;
      clearInterval(interval);
      await inFlight;
    },
  };
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
    await sqldb.IntegrationLifecycle.update(
      { artifacts: observedArtifacts },
      lifecycleUpdateWhere({ where, generation: lifecycle.generation }),
    );
    failureStage = 'TI2 supplier cache cleanup';
    const artifactsWithPrefixes = await rememberSupplierCachePrefixes({
      userId,
      integrationId,
      hint,
      observedArtifacts,
    });
    if (artifactsWithPrefixes !== observedArtifacts) {
      observedArtifacts = artifactsWithPrefixes;
      await sqldb.IntegrationLifecycle.update(
        { artifacts: observedArtifacts },
        lifecycleUpdateWhere({ where, generation: lifecycle.generation }),
      );
    }
    failureStage = 'TI2 product search cache cleanup';
    const deletionLockToken = crypto.randomBytes(16).toString('hex');
    const refreshLockKey = `${productSearchCacheKey({ userId, hint })}:lock`;
    const refreshLockHeld = await saveIfNotExists({
      pluginName: integrationId,
      key: refreshLockKey,
      value: deletionLockToken,
      ttl: deletionLockTtlSeconds(),
    });
    if (!refreshLockHeld) {
      throw lifecycleError(503, REFRESH_STILL_RUNNING);
    }
    const supplierCacheIdentity = {
      pluginName: integrationId,
      userId,
      hint,
      ownerToken: deletionLockToken,
      ttl: deletionLockTtlSeconds(),
    };
    let supplierCacheFenceHeld = false;
    let deletionProtection;
    let deletionProtectionStopped = false;
    try {
      supplierCacheFenceHeld = await beginSupplierCacheDeletion(supplierCacheIdentity);
      if (!supplierCacheFenceHeld) {
        throw lifecycleError(503, REFRESH_STILL_RUNNING);
      }
      deletionProtection = startDeletionProtectionRenewal({
        pluginName: integrationId,
        keys: [refreshLockKey, `${productSearchCacheKey({ userId, hint })}:deletion`],
        ownerToken: deletionLockToken,
        ttl: deletionLockTtlSeconds(),
      });
      // A scoped product search or itinerary search may still be saving supplier
      // caches. Retry once those writers finish, so the scan cannot miss them.
      if (await supplierCacheWritesActive(supplierCacheIdentity)) {
        throw lifecycleError(503, SEARCH_STILL_WRITING);
      }
      const supplierPatterns = supplierCachePatterns(observedArtifacts.supplierCachePrefixes);
      const store = integrationId === 'tourplannx' && supplierPatterns.length
        ? getSupplierOptionsAndRatesStore() : null;
      if (store) {
        failureStage = 'TI2 supplier options and rates availability';
        await store.checkAvailability();
      }
      const cacheKeys = await dropProductSearch({
        pluginName: integrationId,
        userId,
        hint,
        lockOwnerToken: deletionLockToken,
      });
      if (cacheKeys === -1) {
        throw lifecycleError(503, REFRESH_STILL_RUNNING);
      }
      observedArtifacts = {
        ...observedArtifacts,
        cacheKeys: Math.max(observedArtifacts.cacheKeys || 0, cacheKeys),
      };
      if (supplierPatterns.length > 0) {
        failureStage = 'TI2 supplier cache cleanup';
        const supplierCacheKeys = await dropMatching({
          pluginName: integrationId,
          patterns: supplierPatterns,
        });
        observedArtifacts = {
          ...observedArtifacts,
          supplierCacheKeys: Math.max(
            observedArtifacts.supplierCacheKeys || 0,
            supplierCacheKeys,
          ),
        };
        if (store) {
          failureStage = 'TI2 supplier options and rates cleanup';
          await store.deletePrefixes(observedArtifacts.supplierCachePrefixes, async () => {
            if (deletionProtection.lost()) throw lifecycleError(503, REFRESH_STILL_RUNNING);
            const renewed = await expireIfValue({
              pluginName: integrationId,
              key: refreshLockKey,
              value: deletionLockToken,
              ttl: deletionLockTtlSeconds(),
            });
            const fenceRenewed = await expireIfValue({
              pluginName: integrationId,
              key: `${productSearchCacheKey({ userId, hint })}:deletion`,
              value: deletionLockToken,
              ttl: deletionLockTtlSeconds(),
            });
            if (!renewed || !fenceRenewed) throw lifecycleError(503, REFRESH_STILL_RUNNING);
          });
        }
      }
      const lockExtended = await expireIfValue({
        pluginName: integrationId,
        key: refreshLockKey,
        value: deletionLockToken,
        ttl: deletionLockTtlSeconds(),
      });
      if (!lockExtended) {
        failureStage = 'TI2 product search cache cleanup';
        throw lifecycleError(503, REFRESH_STILL_RUNNING);
      }
      const fenceExtended = await expireIfValue({
        pluginName: integrationId,
        key: `${productSearchCacheKey({ userId, hint })}:deletion`,
        value: deletionLockToken,
        ttl: deletionLockTtlSeconds(),
      });
      if (!fenceExtended) {
        failureStage = 'TI2 product search cache cleanup';
        throw lifecycleError(503, REFRESH_STILL_RUNNING);
      }
      failureStage = 'credential and settings cleanup';
      const { credentials, settings } = await cleanupCredentialAndSettings({
        userId,
        integrationId,
        hint,
      });
      await deletionProtection.stop();
      deletionProtectionStopped = true;
      if (deletionProtection.lost()) {
        failureStage = 'credential and settings cleanup';
        throw lifecycleError(503, REFRESH_STILL_RUNNING);
      }
      observedArtifacts = {
        ...observedArtifacts,
        credentials: Math.max(observedArtifacts.credentials || 0, credentials),
        settings: Math.max(observedArtifacts.settings || 0, settings),
      };
    } finally {
      if (deletionProtection && !deletionProtectionStopped) {
        try {
          await deletionProtection.stop();
        } catch (releaseError) {
          console.warn(
            '[integration-lifecycle] deletion protection renewal failed',
            releaseError.message,
          );
        }
      }
      if (supplierCacheFenceHeld) {
        try {
          await endSupplierCacheDeletion(supplierCacheIdentity);
        } catch (releaseError) {
          console.warn(
            '[integration-lifecycle] supplier-cache fence release failed',
            releaseError.message,
          );
        }
      }
      try {
        await dropIfValue({
          pluginName: integrationId,
          key: refreshLockKey,
          value: deletionLockToken,
        });
      } catch (releaseError) {
        console.warn(
          '[integration-lifecycle] refresh lock release failed',
          releaseError.message,
        );
      }
    }
    await sqldb.IntegrationLifecycle.update(
      { artifacts: observedArtifacts },
      lifecycleUpdateWhere({ where, generation: lifecycle.generation }),
    );
    failureStage = 'product catalog cleanup';
    const catalog = await callCatalogLifecycle({
      action: 'delete',
      userId,
      integrationId,
      hint,
      generation: lifecycle.generation,
    });
    if (catalog && catalog.status === 'superseded') {
      throw lifecycleError(409, 'A newer product catalog lifecycle already exists.');
    }
    if (catalog && catalog.status === 'retry') {
      throw lifecycleError(503, 'Product catalog cleanup is not ready and can be retried.');
    }
    if (!catalog || catalog.status !== 'deleted') {
      throw lifecycleError(502, 'Product catalog cleanup returned an unexpected response.');
    }
    const artifacts = {
      ...observedArtifacts,
      catalog,
    };
    const status = deferCompletion ? 'external_cleanup' : 'complete';
    const [updatedRows] = await sqldb.IntegrationLifecycle.update({
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
    if (updatedRows === 0) {
      const persisted = await sqldb.IntegrationLifecycle.findOne({ where });
      if (
        persisted
        && persisted.generation === lifecycle.generation
        && ['complete', 'external_cleanup'].includes(persisted.status)
      ) {
        return persisted.get({ plain: true });
      }
      throw lifecycleError(409, 'Integration cleanup state changed before completion.');
    }
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
    if (error.status) throw error;
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
  requestId,
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
  if (lifecycle.requestId !== requestId) {
    throw lifecycleError(409, 'Integration cleanup request no longer owns this generation.');
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
  startDeletionProtectionRenewal,
  failActivation,
  prepareActivation,
  touchActivation,
};
