const assert = require('assert');
const crypto = require('crypto');
const hash = require('object-hash');
const R = require('ramda');
const hasProductSearchSelector = require('../lib/hasProductSearchSelector');
const productSearchCacheKey = require('../lib/productSearchCacheKey');
const {
  beginSupplierCacheWrite,
  endSupplierCacheWrite,
  runWithSupplierCacheWriter,
  runWithRefreshLock,
} = require('../cache');
const assertCanonicalProductSearchResult = require('../lib/assertProductCatalog');
const { createCredentialClient, redactCredentialError } = require('../lib/credential-request');
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
  isScopedSearch,
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
    hasSearchInput: hasProductSearchSelector({ searchInput }),
    hasOptionId: Boolean(optionId && optionId.length),
    elapsedMs: Date.now() - startedAt,
    ...extra,
  };
  app.events.emit(productSearchCacheDecisionEvent, payload);
  const workerOwnsFullNxCacheSave = action === 'cache_saved'
    && app.name === 'tourplannx'
    && forceRefresh === true
    && ['manual', 'scheduled'].includes(fullSyncTrigger)
    && !isScopedSearch;
  if (legacyProductSearchCacheEvents[action] && !workerOwnsFullNxCacheSave) {
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

const createIntegrationRemovalError = () => {
  const err = new Error('This integration is being removed. Retry shortly.');
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
  // A hintless route still selects one credential. Cache keys and deletion fences
  // must use that row's hint, not the missing request parameter.
  return {
    app,
    token,
    configuration: userAppKeys.configuration,
    hint: userAppKeys.hint,
  };
};

// Registers a writer deletion can see. Concurrent searches each get their own key.
// The catalog lock stays with full refreshes.
const withSupplierCacheWriter = async ({ app, appKey, userId, hint }, run) => {
  const ownerToken = crypto.randomBytes(16).toString('hex');
  const ttl = getProductSearchLockTtlSeconds();
  const writer = {
    pluginName: appKey, userId, hint, ownerToken, ttl,
  };
  const fenceKey = `${productSearchCacheKey({ userId, hint })}:deletion`;
  let writerHeld = await beginSupplierCacheWrite(writer);
  if (!writerHeld) {
    const timeoutAt = Date.now() + getProductSearchLockWaitMs();
    while (!writerHeld && Date.now() < timeoutAt) {
      const fence = await app.cache.get({ key: fenceKey });
      if (!fence) writerHeld = await beginSupplierCacheWrite(writer);
      if (!writerHeld) await sleep(productSearchLockPollMs);
    }
  }
  if (!writerHeld) throw createIntegrationRemovalError();
  const renewal = createLockRenewal({
    app,
    key: `${productSearchCacheKey({ userId, hint })}:supplier-writer:${ownerToken}`,
    value: ownerToken,
    ttl,
    onDecision: () => {},
  });
  try {
    const credential = await UserAppKey.findOne({
      where: { userId, integrationId: appKey, hint },
    });
    if (!credential) {
      const error = new Error('Integration was removed before the request started');
      error.status = 410;
      throw error;
    }
    return await runWithSupplierCacheWriter({
      pluginName: appKey,
      writerKey: `${productSearchCacheKey({ userId, hint })}:supplier-writer:${ownerToken}`,
      ownerToken,
      ttl,
    }, run);
  } finally {
    await renewal.stop();
    await endSupplierCacheWrite(writer);
  }
};

const bookingsSearch = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body,
  } = req;
  try {
    const {
      app, token, hint: credentialHint,
    } = await getAppAndToken({ plugins, appKey, userId, hint });
    assert(app.searchItineraries || app.searchHotelBooking || app.searchBooking, `searchItineraries or searchHotelBooking or searchBooking is not available for ${appKey}`);
    // Prefer the dedicated itinerary endpoint so date/filter payloads used by mining are preserved.
    const search = (app.searchItineraries || app.searchHotelBooking || app.searchBooking).bind(app);
    const results = await withSupplierCacheWriter({
      app, appKey, userId, hint: credentialHint,
    }, () => search({
      axios,
      token,
      payload: body,
      typeDefsAndQueries,
      userId,
      hint: credentialHint,
      requestId: req.requestId,
    }));
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

const $searchProductList = (products, searchInput = '', optionId = '', appKey = '', productId = '') => {
  // NOTE: optionId could be a string or an array of strings
  // NOTE: searchInput should not appear at the same time as optionId
  const trimmedSearchInput = (searchInput || '').trim();
  const requestedProductIds = new Set(
    (R.is(Array, productId) ? productId : [productId])
      .map(value => String(value == null ? '' : value).trim())
      .filter(Boolean),
  );
  if ((!trimmedSearchInput || trimmedSearchInput === '*')
    && !(optionId && optionId.length) && !requestedProductIds.size) {
    return products;
  }
  const getFullSearchStr = (product, option) => `${
    R.path(['productName'], product) || ''
  } ${R.path(['optionName'], option) || ''
  } ${R.path(['optionId'], option) || ''
  } ${R.path(['supplierId'], product) || ''}`;
  const inputValueLower = trimmedSearchInput.toLowerCase();
  const parts = inputValueLower === '*' ? [] : inputValueLower.split(' ').filter(Boolean);
  const optionKey = value => appKey === 'tourplannx'
    ? String(value || '').replace(/\s/g, '')
    : value;
  const requestedOptionIds = new Set(
    (R.is(Array, optionId) ? optionId : [optionId]).map(optionKey),
  );
  const pwFilteredOptions = products.filter(product => !requestedProductIds.size
    || requestedProductIds.has(String(R.path(['productId'], product)))).map(product => {
    const filteredOptions = R.pathOr([], ['options'], product).filter(option => {
      if (optionId && optionId.length) {
        return requestedOptionIds.has(optionKey(R.path(['optionId'], option)));
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

// Complete results may replace the catalog; partial results require a non-destructive merge.
const hasCacheableProductResults = pluginResults => Boolean(
  pluginResults
  && pluginResults.products
  && pluginResults.products.length > 0
  && !pluginResults.catalogPartial
  && !pluginResults.partial
);

const hasNonEmptyProductCache = cacheContent => Boolean(
  cacheContent
  && cacheContent.products
  && cacheContent.products.length > 0
);

const mergePartialProductCatalog = (existing, incoming) => {
  const products = new Map(R.pathOr([], ['products'], existing)
    .map(product => [String(product.productId), product]));
  for (const product of incoming.products) {
    const id = String(product.productId);
    const previous = products.get(id);
    const options = new Map([
      ...R.pathOr([], ['options'], previous), ...product.options,
    ].map(option => [String(option.optionId), option]));
    products.set(id, { ...previous, ...product, options: [...options.values()] });
  }
  return { ...incoming, catalogPartial: true, products: [...products.values()] };
};

const $bookingsProductSearch = plugins => async ({
  axios,
  appKey,
  userId,
  hint: requestedHint,
  payload: originalRequestBody, // Renamed for clarity, this is req.body
  requestId,
  headers,
}) => {
  const {
    app, token, configuration, hint,
  } = await getAppAndToken({ plugins, appKey, userId, hint: requestedHint });
  const productSearchConfiguration = R.omit([
    'catalogPartial', 'partial', 'missingActivityIds', 'catalogRefreshOutcome',
    'scheduledProductSyncEnabled',
  ], token.configuration || {});
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
    ...(token.productSearchPickupPointsRequired === true ? {
      pickupPointsRequired: true,
    } : {}),
  };

  // Extract controller-specific flags from originalRequestBody
  const {
    searchInput = '', // Provide defaults
    optionId = '',
    productId = '',
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
  const cacheKey = productSearchCacheKey({ userId, hint });
  if (!cacheOnly && fullSyncTrigger === 'scheduled'
    && R.prop('scheduledProductSyncEnabled', configuration) !== true) {
    const cacheContent = await app.cache.get({ key: cacheKey });
    const cachePreserved = hasProductCache(cacheContent);
    return {
      ...cacheContent,
      products: cachePreserved ? cacheContent.products : [],
      catalogRefreshOutcome: 'scheduled_sync_disabled',
      cacheUpdated: false,
      cachePreserved,
      cachedProductCount: cachePreserved ? productCount(cacheContent) : null,
    };
  }
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
      'requestId',
      'scheduledProductSyncEnabled',
    ], normalizedRequestBody),
    forceRefresh,
  };
  const isScopedSearch = hasProductSearchSelector(normalizedRequestBody, appKey);
  const isDeclaredFullCatalogRefresh = forceRefresh
    && ['scheduled', 'manual'].indexOf(fullSyncTrigger) >= 0;
  const rejectRefresh = async err => {
    // Rejected requests must not overwrite a catalog refresh that already owns the lock.
    await app.cache.saveProductSyncStatus({
      key: `${cacheKey}:sync-status`, lockKey: `${cacheKey}:lock`,
      attempt: { status: 'failed', startedAt: Date.now(), finishedAt: Date.now(),
        trigger: fullSyncTrigger, reason: err.message },
    });
    throw err;
  };
  if (
    forceRefresh
    && !cacheOnly
    && fullSyncTrigger === 'manual'
    && !admissionOverrideReason
  ) {
    return rejectRefresh(createManualCatalogRefreshReasonError());
  }
  if (isDeclaredFullCatalogRefresh && isScopedSearch) {
    throw createScopedCatalogRefreshError();
  }
  if (
    forceRefresh
    && !cacheOnly
    && R.path(['capabilities', 'weeklyProductCatalogSync'], app) !== true
  ) {
    return rejectRefresh(createUnsupportedCatalogRefreshError(appKey));
  }

  const telemetryContext = {
    app,
    cacheKey,
    userId,
    hint,
    requestId,
    searchInput,
    optionId,
    isScopedSearch,
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
  assert(app.cache.saveVersioned, 'cache adapter must expose saveVersioned');

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

  const releasePluginExecutionLock = async lockOwnerToken => {
    if (app.cache.dropIfValue) {
      await app.cache.dropIfValue({ key: pluginExecutionLockKey, value: lockOwnerToken });
    } else {
      await app.cache.drop({ key: pluginExecutionLockKey });
    }
  };

  // Helper function to call the plugin, save cache, and return results.
  // A scoped search can write supplier caches, so it registers a deletion writer.
  // It does not take the catalog lock, and concurrent scoped searches keep running.
  const fetchFromPluginAndCache = async (reason = 'cache_miss') => {
    if (isScopedSearch) {
      return withSupplierCacheWriter({ app, appKey, userId, hint }, async () => {
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
      });
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
    let cacheSavedAt;
    let cacheVersion;
    let cachePreserved = false;
    let cachedProductCount;
    let effectiveCatalogResults;
    const attemptStartedAt = Date.now();
    const recordAttempt = (status, reason, success) => app.cache.saveProductSyncStatus({
      key: `${cacheKey}:sync-status`, lockKey: pluginExecutionLockKey, lockOwnerToken,
      attempt: { status, startedAt: attemptStartedAt,
        ...(status !== 'running' ? { finishedAt: Date.now() } : {}),
        trigger: fullSyncTrigger, reason },
      success,
      ...(cacheUpdated ? { saved: {
        savedAt: cacheSavedAt || Date.now(), productCount: cachedProductCount,
        optionCount: optionCount(effectiveCatalogResults || pluginResults),
        partial: Boolean(pluginResults.catalogPartial || pluginResults.partial),
        missingActivityIds: pluginResults.missingActivityIds,
      } } : {}),
    });
    let refreshStarted = false;
    try {
      // Credentials may have been removed while this request waited for the cache lock.
      const credential = await UserAppKey.findOne({
        where: { userId, integrationId: appKey, hint },
      });
      if (!credential) {
        const error = new Error('Integration was removed before the product refresh started');
        error.status = 410;
        throw error;
      }
      refreshStarted = true;
      await recordAttempt('running');
      const pluginStartedAt = Date.now();
      // Supplier and aggregate writes inside the plugin must fail with the refresh
      // lock. Scoped searches stay on their own writer keys and run concurrently.
      pluginResults = await runWithRefreshLock({
        pluginName: appKey,
        lockKey: pluginExecutionLockKey,
        ownerToken: lockOwnerToken,
        ttl: lockTtlSeconds,
      }, () => func({
        axios,
        token,
        payload: payloadForPlugin,
        typeDefsAndQueries,
        requestId,
        userId,
        hint,
      }));
      assertCanonicalProductSearchResult(pluginResults, appKey);
      const pluginElapsedMs = Date.now() - pluginStartedAt;

      const existingCacheContent = await app.cache.get({ key: cacheKey });
      const suspiciousShrink = [productCount, optionCount].some(count => (
        count(existingCacheContent) >= 25
        && count(pluginResults) < count(existingCacheContent) * 0.5
      ));
      // Match the existing Chroma shrink policy, at the Ti2 commit boundary.
      if (hasCacheableProductResults(pluginResults) && suspiciousShrink) {
        catalogRefreshOutcome = 'suspicious_shrink_preserved_cache';
        cachePreserved = true;
        cachedProductCount = productCount(existingCacheContent);
        effectiveCatalogResults = existingCacheContent;
        emitDecision('suspicious_refresh_skipped', {
          reason: 'suspiciousShrinkPreservedExistingCache',
          pluginElapsedMs,
          existingProductCount: productCount(existingCacheContent),
          returnedProductCount: productCount(pluginResults),
          existingOptionCount: optionCount(existingCacheContent),
          returnedOptionCount: optionCount(pluginResults),
          cachePreserved: true,
        });
      } else if (hasCacheableProductResults(pluginResults)) {
        ({ cacheVersion, cacheSavedAt } = await app.cache.saveVersioned({
          key: cacheKey, value: pluginResults, ttl: productSearchCacheTtlSeconds,
          lockKey: pluginExecutionLockKey, lockOwnerToken,
        }));
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
        if (pluginResults.products.length) {
          effectiveCatalogResults = mergePartialProductCatalog(existingCacheContent, pluginResults);
          assertCanonicalProductSearchResult(effectiveCatalogResults, appKey);
          ({ cacheVersion, cacheSavedAt } = await app.cache.saveVersioned({
            key: cacheKey, value: effectiveCatalogResults, ttl: productSearchCacheTtlSeconds,
            lockKey: pluginExecutionLockKey, lockOwnerToken,
          }));
          catalogRefreshOutcome = 'partial_cache_updated';
          cacheUpdated = true;
          cachedProductCount = productCount(effectiveCatalogResults);
          emitDecision('partial_cache_saved', { reason, pluginElapsedMs,
            cacheProductCount: cachedProductCount, cacheOptionCount: optionCount(effectiveCatalogResults),
            returnedProductCount: productCount(pluginResults) });
        } else {
          cachePreserved = hasNonEmptyProductCache(existingCacheContent);
          effectiveCatalogResults = cachePreserved ? existingCacheContent : undefined;
          catalogRefreshOutcome = cachePreserved
            ? 'partial_result_preserved_cache' : 'partial_result_not_cached';
          cachedProductCount = cachePreserved ? productCount(existingCacheContent) : null;
          emitDecision('partial_refresh_skipped', {
            reason: cachePreserved ? 'partialResultPreservedExistingCache' : 'partialResultNotCached',
            pluginElapsedMs, cachePreserved, returnedProductCount: 0,
          });
        }
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
              lockKey: pluginExecutionLockKey, lockOwnerToken,
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
          cacheSavedAt,
          cacheVersion,
          catalogPartial: Boolean(pluginResults.catalogPartial || pluginResults.partial),
          missingActivityIds: pluginResults.missingActivityIds,
        },
        ttl: productSearchRefreshOutcomeTtlSeconds,
        lockKey: pluginExecutionLockKey, lockOwnerToken,
      });
      const partialSave = catalogRefreshOutcome === 'partial_cache_updated';
      await recordAttempt(partialSave ? 'partial' : (cacheUpdated ? 'succeeded' : 'preserved'), catalogRefreshOutcome,
        cacheUpdated && !partialSave ? { succeededAt: cacheSavedAt || Date.now(), productCount: cachedProductCount,
          optionCount: optionCount(pluginResults) } : undefined);
    } catch (err) {
      const status = R.path(['response', 'status'], err) || err.status;
      const sessionReason = {
        externalSessionRequired: 'Booking-system login is required. Sign in again and retry the refresh.',
        externalSessionInvalid: 'Booking-system login is invalid or has expired. Sign in again and retry the refresh.',
      }[err.code];
      const reason = sessionReason || (err && err.name === 'AssertionError' ? 'The integration returned an invalid product catalog.'
        : (Number.isInteger(status) ? `The integration returned HTTP ${status}.`
          : 'The integration could not return a complete product catalog.'));
      if (refreshStarted) await recordAttempt('failed', reason);
      throw err;
    } finally {
      await lockRenewal.stop();
      await releasePluginExecutionLock(lockOwnerToken);
    }
    const result = effectiveCatalogResults || pluginResults || { products: [] };
    if (!forceRefresh) return result;
    return {
      ...result,
      catalogRefreshOutcome,
      cacheUpdated,
      cachePreserved,
      cachedProductCount,
      cacheSavedAt,
      cacheVersion,
      ...(pluginResults.catalogPartial || pluginResults.partial
        ? { catalogPartial: true, missingActivityIds: pluginResults.missingActivityIds } : {}),
    };
  };

  // 0. `cacheOnly`: return current Ti2 cache or empty. Never call the plugin.
  if (cacheOnly) {
    if (hasProductCache(initialActualCacheContent)) {
      const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId, appKey, productId);
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
        ...productSearchConfiguration,
        cacheFound: true,
      };
    }
    emitDecision('cache_miss', { reason: 'cacheOnly' });
    return { products: [], ...productSearchConfiguration, cacheFound: false };
  }

  // 1. `doNotCallPluginForProducts` is true, and not `forceRefresh`: Serve from cache or empty.
  if (doNotCallPluginForProducts && !forceRefresh) {
    if (hasProductCache(initialActualCacheContent)) {
      const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId, appKey, productId);
      emitDecision('cache_hit', {
        reason: 'doNotCallPluginForProducts',
        cacheProductCount: initialActualCacheContent.products.length,
        cacheOptionCount: optionCount(initialActualCacheContent),
        returnedProductCount: searchResults.length,
        returnedOptionCount: optionCount({ products: searchResults }),
      });
      return { ...initialActualCacheContent, products: searchResults, ...productSearchConfiguration };
    }
    emitDecision('cache_miss', { reason: 'doNotCallPluginForProducts' });
    return { products: [], ...productSearchConfiguration };
  }

  // 2. `forceRefresh` is true (and not case 1): Fetch from plugin.
  //    fetchFromPluginAndCache will handle caching the new results.
  if (forceRefresh) {
    emitDecision('force_refresh');
    const funcResults = await fetchFromPluginAndCache('force_refresh');
    const searchResults = $searchProductList(funcResults.products, searchInput, optionId, appKey, productId);
    return {
      ...funcResults,
      products: searchResults,
      ...productSearchConfiguration,
      catalogRefreshOutcome: funcResults.catalogRefreshOutcome,
      cacheUpdated: funcResults.cacheUpdated,
      cachePreserved: funcResults.cachePreserved,
      cachedProductCount: funcResults.cachedProductCount,
      catalogOptionCount: optionCount(funcResults),
      cacheSavedAt: funcResults.cacheSavedAt,
      cacheVersion: funcResults.cacheVersion,
    };
  }

  // 3. Cache exists (initialActualCacheContent) and not forceRefresh:
  if (hasProductCache(initialActualCacheContent)) {
    const cacheIsEmpty = !initialActualCacheContent.products.length;
    const trimmedSearch = (searchInput || '').trim();
    const hasProductIdFilter = (R.is(Array, productId) ? productId : [productId])
      .some(value => Boolean(String(value == null ? '' : value).trim()));
    const searchFilterIsEmpty = (!trimmedSearch || trimmedSearch === '*')
      && !(optionId && optionId.length)
      && !hasProductIdFilter;

    // If cache is empty and no search filter, skip to case 4 to fetch fresh data
    const shouldSkipEmptyCache = cacheIsEmpty && searchFilterIsEmpty;
    if (!shouldSkipEmptyCache) {
      const returnCachedResults = (action = 'cache_hit', extra = {}) => {
        const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId, appKey, productId);
        emitDecision(action, {
          cacheProductCount: initialActualCacheContent.products.length,
          cacheOptionCount: optionCount(initialActualCacheContent),
          returnedProductCount: searchResults.length,
          returnedOptionCount: optionCount({ products: searchResults }),
          cacheAgeMs: lastUpdated ? Date.now() - lastUpdated : undefined,
          ttrMs: ttr * 1000,
          ...extra,
        });
        return { ...initialActualCacheContent, products: searchResults, ...productSearchConfiguration };
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
  const searchResults = $searchProductList(funcResults.products, searchInput, optionId, appKey, productId);
  return {
    ...funcResults,
    products: searchResults,
    ...productSearchConfiguration,
  };
};

const productSyncStatus = plugins => async (req, res, next) => {
  try {
    const { appKey, userId, hint: requestedHint } = req.params;
    const { app, hint } = await getAppAndToken({
      plugins, appKey, userId, hint: requestedHint,
    });
    const key = productSearchCacheKey({ userId, hint });
    const statusKey = `${key}:sync-status`;
    const status = await app.cache.get({ key: statusKey }) || {};
    if (!status.lastSaved || (!status.lastSuccess && !status.lastSaved.partial)) {
      const [catalog, savedAt] = await Promise.all([
        app.cache.get({ key }), app.cache.get({ key: `${key}:lastUpdated` }),
      ]);
      if (hasProductCache(catalog)) {
        const partial = Boolean(catalog.catalogPartial || catalog.partial);
        if (!status.lastSaved) status.lastSaved = {
          savedAt: Number.isFinite(savedAt) ? savedAt : null,
          productCount: productCount(catalog), optionCount: optionCount(catalog), partial,
          missingActivityIds: catalog.missingActivityIds,
        };
        if (!status.lastSuccess && !partial) status.lastSuccess = {
          succeededAt: Number.isFinite(savedAt) ? savedAt : null,
          productCount: productCount(catalog), optionCount: optionCount(catalog),
        };
      }
    }
    if (status.lastAttempt && status.lastAttempt.status === 'running'
      && !await app.cache.get({ key: `${key}:lock` })) {
      status.lastAttempt = { ...status.lastAttempt, status: 'failed',
        reason: 'The refresh was interrupted before completion.' };
    }
    return res.json(status);
  } catch (err) {
    return next(err);
  }
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
      axios: req.method === 'POST' ? createCredentialClient(app, req.requestId) : axios,
      token,
      payload,
      userId,
      hint,
      requestId: req.requestId,
    });
    return res.json(results);
  } catch (err) {
    return next(req.method === 'POST'
      ? redactCredentialError(err, 'Agent request failed') : err);
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
    productSyncStatus: productSyncStatus(plugins),
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
