const hasProductSearchSelector = require('../lib/hasProductSearchSelector');

const productSearchPath = /^\/products\/tourplannx\/([^/]+)\/([^/]+)\/search(?:\?.*)?$/;

const resolveFullSyncTrigger = payload => (
  ['organic', 'scheduled', 'manual'].includes(payload.fullSyncTrigger)
    ? payload.fullSyncTrigger
    : (payload.forceRefresh === true ? 'manual' : 'organic')
);

const startAfterProductSync = async ({ url, payload, result, plugins = [] }) => {
  const match = productSearchPath.exec(url || '');
  const fullSyncTrigger = resolveFullSyncTrigger(payload || {});
  if (!match || payload.forceRefresh !== true
    || !['manual', 'scheduled'].includes(fullSyncTrigger)
    || hasProductSearchSelector(payload)
    || !result.success || !result.result || result.result.cacheUpdated !== true
    || result.result.cachedProductCount === 0) return undefined;

  if (!Number.isInteger(result.result.catalogOptionCount)
    || result.result.catalogOptionCount <= 0
    || !/^[a-f0-9]{64}$/.test(result.result.catalogFingerprint || '')
    || !Number.isSafeInteger(result.result.cacheSavedAt)
    || !Number.isSafeInteger(result.result.cacheVersion)
    || result.result.cacheVersion <= 0) {
    throw new Error('TourPlan refresh did not return complete catalog metadata');
  }

  const events2url = plugins.find(plugin => plugin && plugin.name === 'events2url');
  if (!events2url || typeof events2url.recordProductCacheSave !== 'function') {
    throw new Error('TourPlan sync metadata requires the ti2-events2url recordProductCacheSave API');
  }

  return events2url.recordProductCacheSave({
    pluginName: 'tourplannx',
    userId: decodeURIComponent(match[1]),
    hint: decodeURIComponent(match[2]),
    forceRefresh: true,
    fullSyncTrigger,
    productCount: result.result.cachedProductCount,
    optionCount: result.result.catalogOptionCount,
    cacheFingerprint: result.result.catalogFingerprint,
    cacheSavedAt: result.result.cacheSavedAt,
    cacheVersion: result.result.cacheVersion,
  });
};

module.exports = { startAfterProductSync };
