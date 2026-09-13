const assert = require('assert');
const crypto = require('crypto');
const hash = require('object-hash');
const R = require('ramda');
const { UserAppKey } = require('../models/index');
const { typeDefs: productTypeDefs, query: productQuery } = require('./graphql-schemas/product');
const { typeDefs: availTypeDefs, query: availQuery } = require('./graphql-schemas/availability');
const { typeDefs: bookingTypeDefs, query: bookingQuery } = require('./graphql-schemas/booking');
const { typeDefs: rateTypeDefs, query: rateQuery } = require('./graphql-schemas/rate');
const { typeDefs: pickupTypeDefs, query: pickupQuery } = require('./graphql-schemas/pickup-point');
const { typeDefs: itineraryProductTypeDefs, query: itineraryProductQuery } = require('./graphql-schemas/itinerary-product');
const { typeDefs: itineraryBookingTypeDefs, query: itineraryBookingQuery } = require('./graphql-schemas/itinerary-booking');

const typeDefsAndQueries = {
  productTypeDefs,
  productQuery,
  availTypeDefs,
  availQuery,
  bookingTypeDefs,
  bookingQuery,
  rateTypeDefs,
  rateQuery,
  pickupTypeDefs,
  pickupQuery,
  itineraryProductTypeDefs,
  itineraryProductQuery,
  itineraryBookingTypeDefs,
  itineraryBookingQuery,
};

const getPositiveIntegerEnv = (name, defaultValue) => {
  const value = Number(process.env[name]);
  const integerValue = Math.floor(value);
  return Number.isFinite(value) && integerValue > 0 ? integerValue : defaultValue;
};

const getProductSearchLockTtlSeconds = () => getPositiveIntegerEnv('PRODUCT_SEARCH_LOCK_TTL_SECONDS', 120);
const getProductSearchLockWaitMs = () => getPositiveIntegerEnv('PRODUCT_SEARCH_LOCK_WAIT_MS', 25 * 1000);
const productSearchLockPollMs = getPositiveIntegerEnv('PRODUCT_SEARCH_LOCK_POLL_MS', 250);
const productSearchRefreshOutcomeTtlSeconds = 60;
const emptyProductSearchCacheTtlSeconds = 60;
const productSearchCacheTtlSeconds = 30 * 24 * 60 * 60;
const oneDayProductSearchTtrSeconds = 60 * 60 * 24;
const defaultProductSearchTtrSeconds = oneDayProductSearchTtrSeconds * 7;

const resolveProductSearchTtrSeconds = (token = {}, app = {}) => {
  const configured = token.ttlForProducts
    || R.path(['cacheSettings', 'bookingsProductSearch', 'ttr'], app);
  return configured == null ? defaultProductSearchTtrSeconds : configured;
};
const productSearchOperationId = 'bookingsProductSearch';
const productSearchCacheDecisionEvent = 'bookingsProductSearch:cache:decision';
const legacyProductSearchCacheEvents = {
  cache_saved: 'bookingsProductSearch:cache:save',
  partial_refresh_skipped: 'bookingsProductSearch:cache:partialRefreshSkipped',
  empty_refresh_skipped: 'bookingsProductSearch:cache:emptyRefreshSkipped',
  empty_cache_saved: 'bookingsProductSearch:cache:emptyRefresh',
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const normalizeOmitServiceCodes = (...values) => [...new Set(
  values
    .reduce((items, value) => items.concat(Array.isArray(value) ? value : [value]), [])
    .reduce((items, value) => items.concat(String(value == null ? '' : value).split(',')), [])
    .map(value => value.trim().toUpperCase())
    .filter(Boolean),
)].sort();

const productSearchCacheKey = ({ userId, hint }) => hash({
  userId,
  hint,
  operationId: productSearchOperationId,
});

const productSearchSelectorFields = [
  'searchInput',
  'optionId',
  'productId',
  'productName',
  'lastUpdatedFrom',
];

const hasProductSearchSelector = payload => productSearchSelectorFields.some(field => {
  const value = R.path([field], payload);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return Boolean(trimmedValue) && !(field === 'searchInput' && trimmedValue === '*');
  }
  return value !== undefined && value !== null && value !== false;
});

const productCount = value => R.pathOr([], ['products'], value).length;

const optionCount = value => R.pathOr([], ['products'], value).reduce(
  (count, product) => count + R.pathOr([], ['options'], product).length,
  0,
);

const hasProductCache = cacheContent => Boolean(cacheContent && cacheContent.products);

const safeHash = value => (value === undefined || value === null ? undefined : hash(String(value)));

const emitProductSearchCacheDecision = ({
  app,
  cacheKey,
  userId,
  hint,
  requestId,
  searchInput,
  optionId,
  forceRefresh,
  fullSyncTrigger,
  admissionOverrideReason,
  fullSyncStartedAt,
  fullSyncAdmissionToken,
  startedAt,
}, action, extra = {}) => {
  if (!app.events || !app.events.emit) return;
  const payload = {
    action,
    operationId: productSearchOperationId,
    requestId,
    pluginName: app.name,
    userIdHash: safeHash(userId),
    hintHash: safeHash(hint),
    cacheKeyHash: safeHash(cacheKey),
    forceRefresh: Boolean(forceRefresh),
    fullSyncTrigger,
    admissionOverrideReason,
    fullSyncStartedAt,
    fullSyncAdmissionTokenHash: safeHash(fullSyncAdmissionToken),
    hasSearchInput: Boolean((searchInput || '').trim()),
    hasOptionId: Boolean(optionId && optionId.length),
    elapsedMs: Date.now() - startedAt,
    ...extra,
  };
  app.events.emit(productSearchCacheDecisionEvent, payload);
  if (legacyProductSearchCacheEvents[action]) {
    app.events.emit(legacyProductSearchCacheEvents[action], {
      ...payload,
      userId,
      hint,
      ...(action === 'cache_saved' && fullSyncAdmissionToken
        ? { fullSyncAdmissionToken }
        : {}),
    });
  }
};

const createLockRenewal = ({ app, key, value, ttl, onDecision }) => {
  if (!app.cache.expireIfValue || ttl <= 0) return { stop: async () => {} };

  const renewEveryMs = Math.max(250, Math.floor(ttl * 500));
  let stopped = false;
  let inFlightRenewal = Promise.resolve();
  const renew = async () => {
    if (stopped) return;
    const renewed = await app.cache.expireIfValue({ key, value, ttl });
    if (!renewed) {
      stopped = true;
      onDecision('lock_renew_lost', { reason: 'ownerTokenMismatch' });
    }
  };
  const interval = setInterval(() => {
    inFlightRenewal = renew().catch(err => {
      stopped = true;
      onDecision('lock_renew_failed', { reason: err.message });
    });
  }, renewEveryMs);
  if (interval.unref) interval.unref();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(interval);
      await inFlightRenewal;
    },
  };
};

const createProductSearchUnavailableError = () => {
  const err = new Error('Product search cache refresh did not produce cached results');
  err.status = 503;
  return err;
};

const createScopedCatalogRefreshError = () => {
  const err = new Error(
    'Scheduled and manual catalog refreshes must not include product selectors',
  );
  err.status = 400;
  return err;
};

const createManualCatalogRefreshReasonError = () => {
  const err = new Error(
    'A manual catalog refresh requires a non-blank admissionOverrideReason',
  );
  err.status = 400;
  return err;
};

const createUnsupportedCatalogRefreshError = appKey => {
  const err = new Error(
    `${appKey} does not support complete product catalog refreshes`,
  );
  err.status = 400;
  return err;
};

const getAppAndToken = async ({ plugins, appKey, userId, hint }) => {
  const app = plugins.find(({ name }) => name === appKey);
  assert(app, 'could not find the app ' + appKey);
  const userAppKeys = await UserAppKey.findOne({
    where: {
      userId,
      integrationId: appKey,
      ...(hint && { hint }),
    },
  });
  assert(userAppKeys, 'could not find the app key');
  const token = await userAppKeys.token;
  return { app, token };
};

const bookingsSearch = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.searchItineraries || app.searchHotelBooking || app.searchBooking, `searchItineraries or searchHotelBooking or searchBooking is not available for ${appKey}`);
    // Prefer the dedicated itinerary endpoint so date/filter payloads used by mining are preserved.
    const search = (app.searchItineraries || app.searchHotelBooking || app.searchBooking).bind(app);
    const results = await search({
      axios,
      token,
      payload: body,
      typeDefsAndQueries,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const bookingsCancel = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.cancelBooking, `cancelBooking is not available for ${appKey}`);
    const results = await app.cancelBooking({
      axios,
      token,
      payload: body,
      typeDefsAndQueries,
      userId,
      hint,
      requestId: req.requestId,
    });
    app.events.emit('bookingsCancelBooking', {
      userId,
      hint,
      operationId: 'cancelBooking',
      requestId: req.requestId,
      pluginName: app.name,
      payload: results,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const confirmBooking = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.confirmBooking, `confirmBooking is not available for ${appKey}`);
    const results = await app.confirmBooking({
      axios,
      token,
      payload: body,
      typeDefsAndQueries,
      userId,
      hint,
      requestId: req.requestId,
    });
    app.events.emit('bookingsConfirmBooking', {
      userId,
      hint,
      operationId: 'confirmBooking',
      requestId: req.requestId,
      pluginName: app.name,
      payload: results,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const $searchProductList = (products, searchInput = '', optionId = '') => {
  // NOTE: optionId could be a string or an array of strings
  // NOTE: searchInput should not appear at the same time as optionId
  const trimmedSearchInput = (searchInput || '').trim();
  if ((!trimmedSearchInput || trimmedSearchInput === '*') && !(optionId && optionId.length)) {
    return products;
  }
  const getFullSearchStr = (product, option) => `${
    R.path(['productName'], product) || ''
  } ${R.path(['optionName'], option) || ''
  } ${R.path(['optionId'], option) || ''
  } ${R.path(['supplierId'], product) || ''}`;
  const inputValueLower = trimmedSearchInput.toLowerCase();
  const parts = inputValueLower.split(' ').filter(Boolean); // Filter out any empty strings just in case
  const pwFilteredOptions = products.map(product => {
    const filteredOptions = R.pathOr([], ['options'], product).filter(option => {
      if (optionId && optionId.length) {
        const optionIdArr = R.is(Array, optionId) ? optionId : [optionId];
        return optionIdArr.includes(R.path(['optionId'], option));
      }
      const fullSearchStr = getFullSearchStr(product, option).toLowerCase();
      return parts.every(part => fullSearchStr.includes(part));
    });
    return {
      ...product,
      options: filteredOptions,
    };
  });
  const filteredProducts = pwFilteredOptions.filter(product => product.options.length > 0);
  return filteredProducts;
};

// Plugins may flag incomplete catalog responses with `catalogPartial` or `partial`;
// both must suppress cache writes so a partial result does not replace a complete cache.
const hasCacheableProductResults = pluginResults => Boolean(
  pluginResults
  && pluginResults.products
  && pluginResults.products.length > 0
  && !pluginResults.catalogPartial
  && !pluginResults.partial
);

const assertCanonicalProductSearchResult = (pluginResults, appKey) => {
  assert(
    pluginResults && Array.isArray(pluginResults.products),
    `${appKey} product search must return an object with a products array`,
  );
};

const hasNonEmptyProductCache = cacheContent => Boolean(
  cacheContent
  && cacheContent.products
  && cacheContent.products.length > 0
);

const $bookingsProductSearch = plugins => async ({
  axios,
  appKey,
  userId,
  hint,
  payload: originalRequestBody, // Renamed for clarity, this is req.body
  requestId,
  headers,
}) => {
  const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
  assert(userId, 'userId is required');
  assert(appKey, 'appKey is required');
  assert(app.searchProducts || app.searchProductsForItinerary, `searchProducts or searchProductsForItinerary is not available for ${appKey}`);
  const func = (app.searchProducts || app.searchProductsForItinerary).bind(app);

  const configuredOmitServiceCodes = normalizeOmitServiceCodes(
    R.path(['productSearchOmitServiceCodes'], token),
  );
  const normalizedRequestBody = {
    ...originalRequestBody,
    ...(configuredOmitServiceCodes.length ? {
      omitServiceCodes: configuredOmitServiceCodes,
    } : {}),
  };

  // Extract controller-specific flags from originalRequestBody
  const {
    searchInput = '', // Provide defaults
    optionId = '',
    forceRefresh = false,
    cacheOnly = false,
    fullSyncTrigger: requestedFullSyncTrigger,
    admissionOverrideReason: requestedOverrideReason,
    fullSyncStartedAt: requestedFullSyncStartedAt,
    fullSyncAdmissionToken: requestedAdmissionToken,
  } = normalizedRequestBody;

  const fullSyncTrigger = ['organic', 'scheduled', 'manual'].indexOf(
    requestedFullSyncTrigger,
  ) >= 0
    ? requestedFullSyncTrigger
    : (forceRefresh ? 'manual' : 'organic');
  const admissionOverrideReason = typeof requestedOverrideReason === 'string'
    ? requestedOverrideReason.trim() || undefined
    : undefined;
  const fullSyncStartedAt = requestedFullSyncStartedAt !== undefined
    && requestedFullSyncStartedAt !== null
    && requestedFullSyncStartedAt !== ''
    && Number.isFinite(Number(requestedFullSyncStartedAt))
    ? Number(requestedFullSyncStartedAt)
    : undefined;
  const fullSyncAdmissionToken = typeof requestedAdmissionToken === 'string'
    ? requestedAdmissionToken.trim() || undefined
    : undefined;

  // Keep forceRefresh in the plugin payload so plugins can trigger their own rebuilds.
  const payloadForPlugin = {
    ...R.omit([
      'forceRefresh',
      'cacheOnly',
      'fullSyncTrigger',
      'admissionOverrideReason',
      'fullSyncStartedAt',
      'fullSyncAdmissionToken',
    ], normalizedRequestBody),
    forceRefresh,
  };
  const isScopedSearch = hasProductSearchSelector(normalizedRequestBody);
  const isDeclaredFullCatalogRefresh = forceRefresh
    && ['scheduled', 'manual'].indexOf(fullSyncTrigger) >= 0;
  if (
    forceRefresh
    && !cacheOnly
    && fullSyncTrigger === 'manual'
    && !admissionOverrideReason
  ) {
    throw createManualCatalogRefreshReasonError();
  }
  if (isDeclaredFullCatalogRefresh && isScopedSearch) {
    throw createScopedCatalogRefreshError();
  }
  if (
    forceRefresh
    && !cacheOnly
    && R.path(['capabilities', 'weeklyProductCatalogSync'], app) !== true
  ) {
    throw createUnsupportedCatalogRefreshError(appKey);
  }

  const cacheKey = productSearchCacheKey({ userId, hint });
  const telemetryContext = {
    app,
    cacheKey,
    userId,
    hint,
    requestId,
    searchInput,
    optionId,
    forceRefresh,
    fullSyncTrigger,
    admissionOverrideReason,
    fullSyncStartedAt,
    fullSyncAdmissionToken,
    startedAt: Date.now(),
  };
  const emitDecision = (action, extra = {}) => emitProductSearchCacheDecision(
    telemetryContext,
    action,
    extra,
  );
  const pluginExecutionLockKey = `${cacheKey}:lock`; // Lock for direct plugin execution
  const refreshOutcomeCacheKey = `${pluginExecutionLockKey}:outcome`;

  // Fetch actualCacheContent once at the beginning.
  const initialActualCacheContent = await app.cache.get({ key: cacheKey });
  const lastUpdated = await app.cache.get({ key: `${cacheKey}:lastUpdated` });
  const ttr = resolveProductSearchTtrSeconds(token, app);
  const isStaleByTTR = lastUpdated && (Date.now() - lastUpdated > ttr * 1000);
  const doNotCallPluginForProducts = token.doNotCallPluginForProducts || R.path(['cacheSettings', 'bookingsProductSearch', 'doNotCall'], app);
  const hasPluginExecutionLock = await app.cache.get({ key: pluginExecutionLockKey });
  emitDecision(hasProductCache(initialActualCacheContent) ? 'cache_hit' : 'cache_miss', {
    cacheProductCount: productCount(initialActualCacheContent),
    cacheOptionCount: optionCount(initialActualCacheContent),
    cacheAgeMs: lastUpdated ? Date.now() - lastUpdated : undefined,
    ttrMs: ttr * 1000,
    reason: hasPluginExecutionLock ? 'lockActive' : undefined,
  });
  assert(app.cache.saveIfNotExists, 'cache adapter must expose saveIfNotExists');

  const getCachedProductSearchResults = async () => {
    const cacheContent = await app.cache.get({ key: cacheKey });
    if (hasProductCache(cacheContent)) return cacheContent;
    return null;
  };

  const waitForProductSearchRefresh = async previousLockOwnerToken => {
    const timeoutAt = Date.now() + getProductSearchLockWaitMs();
    while (Date.now() < timeoutAt) {
      const refreshOutcome = await app.cache.get({ key: refreshOutcomeCacheKey });
      if (refreshOutcome && refreshOutcome.lockOwnerToken !== previousLockOwnerToken) {
        return refreshOutcome;
      }

      const lockStillActive = await app.cache.get({ key: pluginExecutionLockKey });
      if (!lockStillActive) {
        const completedOutcome = await app.cache.get({ key: refreshOutcomeCacheKey });
        return completedOutcome
          && completedOutcome.lockOwnerToken !== previousLockOwnerToken
          ? completedOutcome
          : null;
      }

      await sleep(productSearchLockPollMs);
    }

    const refreshOutcome = await app.cache.get({ key: refreshOutcomeCacheKey });
    return refreshOutcome && refreshOutcome.lockOwnerToken !== previousLockOwnerToken
      ? refreshOutcome
      : null;
  };

  const acquirePluginExecutionLock = async lockOwnerToken => app.cache.saveIfNotExists({
    key: pluginExecutionLockKey,
    value: lockOwnerToken,
    ttl: getProductSearchLockTtlSeconds(),
  });

  // Helper function to call the plugin, save cache, and return results
  const fetchFromPluginAndCache = async (reason = 'cache_miss') => {
    if (isScopedSearch) {
      const pluginStartedAt = Date.now();
      const pluginResults = await func({
        axios,
        token,
        payload: payloadForPlugin,
        typeDefsAndQueries,
        requestId,
        userId,
        hint,
      });
      assertCanonicalProductSearchResult(pluginResults, appKey);
      emitDecision('scoped_result_not_cached', {
        reason,
        pluginElapsedMs: Date.now() - pluginStartedAt,
        returnedProductCount: productCount(pluginResults),
        returnedOptionCount: optionCount(pluginResults),
      });
      return pluginResults || { products: [] };
    }

    const lockOwnerToken = crypto.randomBytes(16).toString('hex');
    const previousRefreshOutcome = await app.cache.get({ key: refreshOutcomeCacheKey });
    const lockStartedAt = Date.now();
    const lockAcquired = await acquirePluginExecutionLock(lockOwnerToken);
    if (!lockAcquired) {
      emitDecision('lock_wait', { reason, lockWaitMs: 0 });
      const refreshOutcome = await waitForProductSearchRefresh(
        previousRefreshOutcome && previousRefreshOutcome.lockOwnerToken,
      );
      const cacheContent = await getCachedProductSearchResults();
      const lockWaitMs = Date.now() - lockStartedAt;
      if (forceRefresh && refreshOutcome) {
        emitDecision('cache_hit', {
          reason: 'waitedForLeader',
          lockWaitMs,
          cacheProductCount: productCount(cacheContent),
          cacheOptionCount: optionCount(cacheContent),
        });
        return {
          ...(cacheContent || { products: [] }),
          ...R.omit(['lockOwnerToken'], refreshOutcome),
        };
      }
      if (!forceRefresh && cacheContent) {
        emitDecision('cache_hit', {
          reason: 'waitedForLeader',
          lockWaitMs,
          cacheProductCount: productCount(cacheContent),
          cacheOptionCount: optionCount(cacheContent),
        });
        return cacheContent;
      }
      if (forceRefresh && cacheContent) {
        emitDecision('stale_served', {
          reason: 'refreshInProgress',
          lockWaitMs,
          cacheProductCount: productCount(cacheContent),
          cacheOptionCount: optionCount(cacheContent),
        });
        return {
          ...cacheContent,
          catalogRefreshOutcome: 'refresh_in_progress_cache_served',
          cacheUpdated: false,
          cachePreserved: true,
          cachedProductCount: productCount(cacheContent),
        };
      }
      emitDecision('lock_timeout', { reason, lockWaitMs });
      throw createProductSearchUnavailableError();
    }

    const lockTtlSeconds = getProductSearchLockTtlSeconds();
    emitDecision('lock_acquired', { reason, lockTtlSeconds });
    const lockRenewal = createLockRenewal({
      app,
      key: pluginExecutionLockKey,
      value: lockOwnerToken,
      ttl: lockTtlSeconds,
      onDecision: emitDecision,
    });

    let pluginResults;
    let catalogRefreshOutcome;
    let cacheUpdated = false;
    let cachePreserved = false;
    let cachedProductCount;
    let effectiveCatalogResults;
    try {
      const pluginStartedAt = Date.now();
      pluginResults = await func({
        axios,
        token,
        payload: payloadForPlugin,
        typeDefsAndQueries,
        requestId,
        userId,
        hint,
      });
      assertCanonicalProductSearchResult(pluginResults, appKey);
      const pluginElapsedMs = Date.now() - pluginStartedAt;

      // Cache usable results from a direct plugin fetch (forceRefresh or cache miss).
      if (hasCacheableProductResults(pluginResults)) {
        await app.cache.save({ key: `${cacheKey}:lastUpdated`, value: Date.now(), ttl: productSearchCacheTtlSeconds });
        await app.cache.save({ key: cacheKey, value: pluginResults, ttl: productSearchCacheTtlSeconds });
        emitDecision('cache_saved', {
          reason,
          pluginElapsedMs,
          cacheProductCount: productCount(pluginResults),
          cacheOptionCount: optionCount(pluginResults),
        });
        catalogRefreshOutcome = 'cache_updated';
        cacheUpdated = true;
        cachedProductCount = productCount(pluginResults);
      } else if (pluginResults && (pluginResults.catalogPartial || pluginResults.partial)) {
        const existingCacheContent = await app.cache.get({ key: cacheKey });
        cachePreserved = hasNonEmptyProductCache(existingCacheContent);
        effectiveCatalogResults = cachePreserved ? existingCacheContent : undefined;
        catalogRefreshOutcome = cachePreserved
          ? 'partial_result_preserved_cache'
          : 'partial_result_not_cached';
        cachedProductCount = cachePreserved
          ? existingCacheContent.products.length
          : null;
        emitDecision('partial_refresh_skipped', {
          reason: cachePreserved
            ? 'partialResultPreservedExistingCache'
            : 'partialResultNotCached',
          pluginElapsedMs,
          cachePreserved,
          existingProductCount: cachePreserved
            ? existingCacheContent.products.length
            : undefined,
          returnedProductCount: productCount(pluginResults),
        });
      } else if (pluginResults && pluginResults.products && pluginResults.products.length === 0) {
        const existingCacheContent = await app.cache.get({ key: cacheKey });
        if (hasNonEmptyProductCache(existingCacheContent)) {
          catalogRefreshOutcome = 'empty_result_preserved_cache';
          cachePreserved = true;
          cachedProductCount = existingCacheContent.products.length;
          effectiveCatalogResults = existingCacheContent;
          emitDecision('empty_refresh_skipped', {
            reason: 'emptyResultPreservedExistingCache',
            pluginElapsedMs,
            cachePreserved: true,
            existingProductCount: existingCacheContent.products.length,
          });
        } else {
          const latestCacheContent = await app.cache.get({ key: cacheKey });
          if (hasNonEmptyProductCache(latestCacheContent)) {
            catalogRefreshOutcome = 'empty_result_preserved_cache';
            cachePreserved = true;
            cachedProductCount = latestCacheContent.products.length;
            effectiveCatalogResults = latestCacheContent;
            emitDecision('empty_refresh_skipped', {
              reason: 'emptyResultPreservedConcurrentCache',
              pluginElapsedMs,
              cachePreserved: true,
              existingProductCount: latestCacheContent.products.length,
            });
          } else {
            // Short-lived empty cache gives concurrent waiters the same answer as the lock holder.
            await app.cache.save({
              key: cacheKey,
              value: pluginResults,
              ttl: emptyProductSearchCacheTtlSeconds,
            });
            catalogRefreshOutcome = 'empty_cache_saved';
            cacheUpdated = true;
            cachedProductCount = 0;
            emitDecision('empty_cache_saved', {
              reason,
              pluginElapsedMs,
              cacheProductCount: 0,
            });
          }
        }
      }
      await app.cache.save({
        key: refreshOutcomeCacheKey,
        value: {
          lockOwnerToken,
          catalogRefreshOutcome,
          cacheUpdated,
          cachePreserved,
          cachedProductCount,
        },
        ttl: productSearchRefreshOutcomeTtlSeconds,
      });
    } finally {
      await lockRenewal.stop();
      if (app.cache.dropIfValue) {
        await app.cache.dropIfValue({ key: pluginExecutionLockKey, value: lockOwnerToken });
      } else {
        await app.cache.drop({ key: pluginExecutionLockKey });
      }
    }
    const result = effectiveCatalogResults || pluginResults || { products: [] };
    if (!forceRefresh) return result;
    return {
      ...result,
      catalogRefreshOutcome,
      cacheUpdated,
      cachePreserved,
      cachedProductCount,
    };
  };

  // 0. `cacheOnly`: return current Ti2 cache or empty. Never call the plugin.
  if (cacheOnly) {
    if (hasProductCache(initialActualCacheContent)) {
      const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId);
      emitDecision('cache_hit', {
        reason: 'cacheOnly',
        cacheProductCount: initialActualCacheContent.products.length,
        cacheOptionCount: optionCount(initialActualCacheContent),
        returnedProductCount: searchResults.length,
        returnedOptionCount: optionCount({ products: searchResults }),
      });
      return {
        ...initialActualCacheContent,
        products: searchResults,
        ...(token.configuration || {}),
        cacheFound: true,
      };
    }
    emitDecision('cache_miss', { reason: 'cacheOnly' });
    return { products: [], ...(token.configuration || {}), cacheFound: false };
  }

  // 1. `doNotCallPluginForProducts` is true, and not `forceRefresh`: Serve from cache or empty.
  if (doNotCallPluginForProducts && !forceRefresh) {
    if (hasProductCache(initialActualCacheContent)) {
      const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId);
      emitDecision('cache_hit', {
        reason: 'doNotCallPluginForProducts',
        cacheProductCount: initialActualCacheContent.products.length,
        cacheOptionCount: optionCount(initialActualCacheContent),
        returnedProductCount: searchResults.length,
        returnedOptionCount: optionCount({ products: searchResults }),
      });
      return { ...initialActualCacheContent, products: searchResults, ...(token.configuration || {}) };
    }
    emitDecision('cache_miss', { reason: 'doNotCallPluginForProducts' });
    return { products: [], ...(token.configuration || {}) };
  }

  // 2. `forceRefresh` is true (and not case 1): Fetch from plugin.
  //    fetchFromPluginAndCache will handle caching the new results.
  if (forceRefresh) {
    emitDecision('force_refresh');
    const funcResults = await fetchFromPluginAndCache('force_refresh');
    const searchResults = $searchProductList(funcResults.products, searchInput, optionId);
    return {
      ...funcResults,
      products: searchResults,
      ...(token.configuration || {}),
      catalogRefreshOutcome: funcResults.catalogRefreshOutcome,
      cacheUpdated: funcResults.cacheUpdated,
      cachePreserved: funcResults.cachePreserved,
      cachedProductCount: funcResults.cachedProductCount,
    };
  }

  // 3. Cache exists (initialActualCacheContent) and not forceRefresh:
  if (hasProductCache(initialActualCacheContent)) {
    const cacheIsEmpty = !initialActualCacheContent.products.length;
    const trimmedSearch = (searchInput || '').trim();
    const searchFilterIsEmpty = (!trimmedSearch || trimmedSearch === '*') && !(optionId && optionId.length);

    // If cache is empty and no search filter, skip to case 4 to fetch fresh data
    const shouldSkipEmptyCache = cacheIsEmpty && searchFilterIsEmpty;
    if (!shouldSkipEmptyCache) {
      const returnCachedResults = (action = 'cache_hit', extra = {}) => {
        const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId);
        emitDecision(action, {
          cacheProductCount: initialActualCacheContent.products.length,
          cacheOptionCount: optionCount(initialActualCacheContent),
          returnedProductCount: searchResults.length,
          returnedOptionCount: optionCount({ products: searchResults }),
          cacheAgeMs: lastUpdated ? Date.now() - lastUpdated : undefined,
          ttrMs: ttr * 1000,
          ...extra,
        });
        return { ...initialActualCacheContent, products: searchResults, ...(token.configuration || {}) };
      };

      const isEffectivelyStale = isStaleByTTR && !doNotCallPluginForProducts;

      // Cache is fresh, a plugin fetch is already running, or the cache is
      // stale: organic search never starts a catalog refresh. The scheduled
      // forceRefresh search is the only catalog owner.
      if (!isEffectivelyStale || hasPluginExecutionLock) {
        return returnCachedResults('cache_hit', { reason: hasPluginExecutionLock ? 'lockActive' : 'freshCache' });
      }
      return returnCachedResults('stale_served', { reason: 'awaitingScheduledRefresh' });
    }
  }

  // 4. No cache content (and not caught by previous conditions like forceRefresh or doNotCallPluginForProducts):
  //    Fetch from plugin. fetchFromPluginAndCache will handle caching.
  const funcResults = await fetchFromPluginAndCache('cache_miss');
  const searchResults = $searchProductList(funcResults.products, searchInput, optionId);
  return {
    ...funcResults,
    products: searchResults,
    ...(token.configuration || {}),
  };
};

const bookingsProductSearch = plugins => async (req, res, next) => {
  const {
    axios,
    params,
    body: payload,
    requestId,
  } = req;
  try {
    return res.json(await $bookingsProductSearch(plugins)({
      axios,
      ...params,
      payload,
      requestId,
      headers: req.headers, // Pass original request headers
    }));
  } catch (err) {
    return next(err);
  }
};

const getProductPackages = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body: payload,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.getProductPackages, `getProductPackages is not available for ${appKey}`);
    const results = await app.getProductPackages({
      axios,
      token,
      payload,
      typeDefsAndQueries,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const bookingsAvailabilitySearch = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body: payload,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    const func = (app.searchAvailability || app.searchAvailabilityForItinerary).bind(app);
    const results = await func({
      axios,
      token,
      payload,
      typeDefsAndQueries,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const $bookingsAvailabilityCalendar = plugins => async ({
  axios,
  appKey,
  userId,
  hint,
  payload,
  requestId,
}) => {
  const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
  assert(app.availabilityCalendar, `availabilityCalendar is not available for ${appKey}`);
  return app.availabilityCalendar({
    axios,
    token,
    payload,
    typeDefsAndQueries,
    userId,
    hint,
    requestId,
  });
};

const bookingsAvailabilityCalendar = plugins => async (req, res, next) => {
  const {
    axios,
    params,
    body: payload,
    requestId,
  } = req;
  try {
    return res.json(await $bookingsAvailabilityCalendar(plugins)({
      axios,
      ...params,
      payload,
      requestId,
    }));
  } catch (err) {
    return next(err);
  }
};

const searchQuote = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body: payload,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    const results = await app.searchQuote({
      axios,
      token,
      payload,
      typeDefsAndQueries,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const createBooking = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body: payload,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    const func = (app.createBooking || app.addServiceToItinerary).bind(app);
    let results;
    if (payload.mock) {
      results = { mock: true, success: true, bookingId: '1234567890' };
    } else {
      results = await func({
        axios,
        token,
        payload,
        typeDefsAndQueries,
        userId,
        hint,
        requestId: req.requestId,
      });
    }
    console.debug(`emitting bookingsCreateBooking event for ${appKey}, user ${userId}, hint ${hint}, results: ${JSON.stringify(results)}`);
    app.events.emit('bookingsCreateBooking', {
      userId,
      hint,
      operationId: 'createBooking',
      requestId: req.requestId,
      pluginName: app.name,
      payload: results,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const getAffiliateAgents = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body: payload,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.getAffiliateAgents, `getAffiliateAgents is not available for ${appKey}`);
    const results = await app.getAffiliateAgents({
      axios,
      token,
      payload,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const getAffiliateDesks = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body: payload,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.getAffiliateDesks, `getAffiliateDesks is not available for ${appKey}`);
    const results = await app.getAffiliateDesks({
      axios,
      token,
      payload,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const getPickupPoints = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body: payload,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.getPickupPoints, `getPickupPoints is not available for ${appKey}`);
    const results = await app.getPickupPoints({
      axios,
      token,
      payload,
      typeDefsAndQueries,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const getCreateBookingFields = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    query,
    body: payload,
  } = req;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.getCreateBookingFields || app.getCreateItineraryFields, `getCreateBookingFields or getCreateItineraryFields is not available for ${appKey}`);
    const func = (app.getCreateItineraryFields || app.getCreateBookingFields).bind(app);
    const results = await func({
      axios,
      token,
      payload,
      query,
      typeDefsAndQueries,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const controllerFactory = plugins => {
  const controllerFunctions = {
    bookingsSearch: bookingsSearch(plugins),
    bookingsCancel: bookingsCancel(plugins),
    confirmBooking: confirmBooking(plugins),
    $bookingsProductSearch: $bookingsProductSearch(plugins),
    bookingsProductSearch: bookingsProductSearch(plugins),
    getProductPackages: getProductPackages(plugins),
    bookingsAvailabilitySearch: bookingsAvailabilitySearch(plugins),
    $bookingsAvailabilityCalendar: $bookingsAvailabilityCalendar(plugins),
    bookingsAvailabilityCalendar: bookingsAvailabilityCalendar(plugins),
    searchQuote: searchQuote(plugins),
    createBooking: createBooking(plugins),
    getAffiliateAgents: getAffiliateAgents(plugins),
    getAffiliateDesks: getAffiliateDesks(plugins),
    getPickupPoints: getPickupPoints(plugins),
    getCreateBookingFields: getCreateBookingFields(plugins),
  };
  // Ensure $bookingsProductSearch can be called internally by worker with plugins already bound
  // This is more of a conceptual note as the factory pattern already handles this.
  return controllerFunctions;
};

// Add this line to attach typeDefsAndQueries to the factory:
controllerFactory.typeDefsAndQueries = typeDefsAndQueries;
controllerFactory.resolveProductSearchTtrSeconds = resolveProductSearchTtrSeconds;
controllerFactory.defaultProductSearchTtrSeconds = defaultProductSearchTtrSeconds;
controllerFactory.oneDayProductSearchTtrSeconds = oneDayProductSearchTtrSeconds;

module.exports = controllerFactory;
