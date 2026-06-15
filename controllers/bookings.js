const assert = require('assert');
const crypto = require('crypto');
const hash = require('object-hash');
const R = require('ramda');
const { UserAppKey } = require('../models/index');
const { addJob } = require('../worker/queue');
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

const productSearchLockTtlSeconds = getPositiveIntegerEnv('PRODUCT_SEARCH_LOCK_TTL_SECONDS', 120);
const productSearchLockWaitMs = getPositiveIntegerEnv('PRODUCT_SEARCH_LOCK_WAIT_MS', 25 * 1000);
const productSearchLockPollMs = getPositiveIntegerEnv('PRODUCT_SEARCH_LOCK_POLL_MS', 250);
const emptyProductSearchCacheTtlSeconds = 60;
const productSearchOperationId = 'bookingsProductSearch';
const productSearchCacheDecisionEvent = 'bookingsProductSearch:cache:decision';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const productCount = value => R.pathOr([], ['products'], value).length;

const safeHash = value => (value === undefined || value === null ? undefined : hash(String(value)));

const emitProductSearchCacheDecision = ({ app, cacheKey, userId, hint, requestId, searchInput, optionId, forceRefresh, startedAt }, action, extra = {}) => {
  if (!app.events || !app.events.emit) return;
  app.events.emit(productSearchCacheDecisionEvent, {
    action,
    operationId: productSearchOperationId,
    requestId,
    pluginName: app.name,
    userIdHash: safeHash(userId),
    hintHash: safeHash(hint),
    cacheKeyHash: safeHash(cacheKey),
    forceRefresh: Boolean(forceRefresh),
    hasSearchInput: Boolean((searchInput || '').trim()),
    hasOptionId: Boolean(optionId && optionId.length),
    elapsedMs: Date.now() - startedAt,
    ...extra,
  });
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
    const results = await app.cancelBooking({
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

const $searchProductList = (products, searchInput = '', optionId = '') => {
  // NOTE: optionId could be a string or an array of strings
  // NOTE: searchInput should not appear at the same time as optionId
  if (!(searchInput && searchInput.trim()) && !(optionId && optionId.length)) {
    return products;
  }
  const getFullSearchStr = (product, option) => `${
    R.path(['productName'], product) || ''
  } ${R.path(['optionName'], option) || ''
  } ${R.path(['optionId'], option) || ''
  } ${R.path(['supplierId'], product) || ''}`;
  const inputValueLower = (searchInput || '').trim().toLowerCase();
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
  headers, // To pass original request headers for background job
}) => {
  // Extract controller-specific flags from originalRequestBody
  const {
    searchInput = '', // Provide defaults
    optionId = '',
    forceRefresh = false,
  } = originalRequestBody;

  // Payload for the plugin function (func) - pass forceRefresh so plugins can trigger background cache rebuilds
  const payloadForPlugin = { ...R.omit(['forceRefresh'], originalRequestBody), forceRefresh };
  const payloadForBackgroundJob = R.omit(['credentials'], payloadForPlugin);

  const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
  assert(userId, 'userId is required');
  assert(appKey, 'appKey is required');
  assert(app.searchProducts || app.searchProductsForItinerary, `searchProducts or searchProductsForItinerary is not available for ${appKey}`);
  const func = (app.searchProducts || app.searchProductsForItinerary).bind(app);

  const cacheKey = hash({ userId, hint, operationId: productSearchOperationId });
  const telemetryContext = {
    app,
    cacheKey,
    userId,
    hint,
    requestId,
    searchInput,
    optionId,
    forceRefresh,
    startedAt: Date.now(),
  };
  const emitDecision = (action, extra = {}) => emitProductSearchCacheDecision(telemetryContext, action, extra);
  const pluginExecutionLockKey = `${cacheKey}:lock`; // Lock for direct plugin execution
  const jobQueueLockKey = `${cacheKey}:jobLock`;   // Lock for preventing multiple job queues

  // Fetch actualCacheContent once at the beginning.
  const initialActualCacheContent = await app.cache.get({ key: cacheKey });
  const lastUpdated = await app.cache.get({ key: `${cacheKey}:lastUpdated` });
  const ttr = token.ttlForProducts || R.path(['cacheSettings', 'bookingsProductSearch', 'ttr'], app) || 60 * 60 * 24;
  const isStaleByTTR = lastUpdated && (Date.now() - lastUpdated > ttr * 1000);
  const doNotCallPluginForProducts = token.doNotCallPluginForProducts || R.path(['cacheSettings', 'bookingsProductSearch', 'doNotCall'], app);
  const hasPluginExecutionLock = await app.cache.get({ key: pluginExecutionLockKey });
  emitDecision(initialActualCacheContent && initialActualCacheContent.products ? 'cache_hit' : 'cache_miss', {
    cacheProductCount: productCount(initialActualCacheContent),
    cacheAgeMs: lastUpdated ? Date.now() - lastUpdated : undefined,
    ttrMs: ttr * 1000,
    reason: hasPluginExecutionLock ? 'lockActive' : undefined,
  });
  assert(app.cache.saveIfNotExists, 'cache adapter must expose saveIfNotExists');

  const getCachedProductSearchResults = async () => {
    const cacheContent = await app.cache.get({ key: cacheKey });
    if (cacheContent && cacheContent.products) return cacheContent;
    return null;
  };

  const waitForProductSearchCache = async () => {
    const timeoutAt = Date.now() + productSearchLockWaitMs;
    while (Date.now() < timeoutAt) {
      const cacheContent = await getCachedProductSearchResults();
      if (cacheContent) return cacheContent;

      const lockStillActive = await app.cache.get({ key: pluginExecutionLockKey });
      if (!lockStillActive) return null;

      await sleep(productSearchLockPollMs);
    }

    return getCachedProductSearchResults();
  };

  const acquirePluginExecutionLock = async lockOwnerToken => app.cache.saveIfNotExists({
    key: pluginExecutionLockKey,
    value: lockOwnerToken,
    ttl: productSearchLockTtlSeconds,
  });

  // Helper function to call the plugin, save cache, and return results
  const fetchFromPluginAndCache = async (reason = 'cache_miss') => {
    const lockOwnerToken = crypto.randomBytes(16).toString('hex');
    const lockStartedAt = Date.now();
    const lockAcquired = await acquirePluginExecutionLock(lockOwnerToken);
    if (!lockAcquired) {
      emitDecision('lock_wait', { reason, lockWaitMs: 0 });
      const cacheContent = await waitForProductSearchCache();
      const lockWaitMs = Date.now() - lockStartedAt;
      if (cacheContent) {
        emitDecision('cache_hit', {
          reason: 'waitedForLeader',
          lockWaitMs,
          cacheProductCount: productCount(cacheContent),
        });
        return cacheContent;
      }
      emitDecision('lock_timeout', { reason, lockWaitMs });
      throw createProductSearchUnavailableError();
    }

    emitDecision('lock_acquired', { reason, lockTtlSeconds: productSearchLockTtlSeconds });
    const lockRenewal = createLockRenewal({
      app,
      key: pluginExecutionLockKey,
      value: lockOwnerToken,
      ttl: productSearchLockTtlSeconds,
      onDecision: emitDecision,
    });

    let pluginResults;
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
      const pluginElapsedMs = Date.now() - pluginStartedAt;

      // This function is responsible for caching if it fetched usable results.
      // This applies to forceRefresh, initial load, or direct calls that result in a fetch.
      // The $updateProductSearchCache function handles caching for background jobs queued due to stale data.
      if (hasCacheableProductResults(pluginResults)) {
        const monthInSeconds = 30 * 24 * 60 * 60;
        await app.cache.save({ key: `${cacheKey}:lastUpdated`, value: Date.now(), ttl: monthInSeconds });
        await app.cache.save({ key: cacheKey, value: pluginResults, ttl: monthInSeconds });
        emitDecision('cache_saved', {
          reason,
          pluginElapsedMs,
          cacheProductCount: productCount(pluginResults),
        });
      } else if (pluginResults && (pluginResults.catalogPartial || pluginResults.partial)) {
        emitDecision('partial_refresh_skipped', {
          reason: 'directPartialResultNotCached',
          pluginElapsedMs,
          cachePreserved: false,
          returnedProductCount: productCount(pluginResults),
        });
      } else if (pluginResults && pluginResults.products && pluginResults.products.length === 0) {
        // Short-lived empty cache gives concurrent waiters the same answer as the lock holder.
        await app.cache.save({ key: cacheKey, value: pluginResults, ttl: emptyProductSearchCacheTtlSeconds });
        emitDecision('empty_cache_saved', {
          reason,
          pluginElapsedMs,
          cacheProductCount: 0,
        });
      }
    } finally {
      await lockRenewal.stop();
      if (app.cache.dropIfValue) {
        await app.cache.dropIfValue({ key: pluginExecutionLockKey, value: lockOwnerToken });
      } else {
        await app.cache.drop({ key: pluginExecutionLockKey });
      }
    }
    return pluginResults || { products: [] }; // Ensure products array exists
  };

  // 1. `doNotCallPluginForProducts` is true, and not `forceRefresh`: Serve from cache or empty.
  if (doNotCallPluginForProducts && !forceRefresh) {
    if (initialActualCacheContent && initialActualCacheContent.products) {
      const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId);
      emitDecision('cache_hit', {
        reason: 'doNotCallPluginForProducts',
        cacheProductCount: initialActualCacheContent.products.length,
        returnedProductCount: searchResults.length,
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
    return { ...funcResults, products: searchResults, ...(token.configuration || {}) };
  }

  // 3. Cache exists (initialActualCacheContent) and not forceRefresh:
  if (initialActualCacheContent && initialActualCacheContent.products) {
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
          returnedProductCount: searchResults.length,
          cacheAgeMs: lastUpdated ? Date.now() - lastUpdated : undefined,
          ttrMs: ttr * 1000,
          ...extra,
        });
        return { ...initialActualCacheContent, products: searchResults, ...(token.configuration || {}) };
      };

      const isEffectivelyStale = isStaleByTTR && !doNotCallPluginForProducts;

      // Cache is fresh or plugin execution in progress: serve from cache
      if (!isEffectivelyStale || hasPluginExecutionLock) {
        return returnCachedResults('cache_hit', { reason: hasPluginExecutionLock ? 'lockActive' : 'freshCache' });
      }

      // Cache is stale - queue at most one background refresh job and serve stale data.
      const jobQueueLockAcquired = await app.cache.saveIfNotExists({
        key: jobQueueLockKey,
        value: true,
        ttl: 60,
      });
      if (!jobQueueLockAcquired) {
        return returnCachedResults('stale_served', { reason: 'backgroundRefreshDeduped' });
      }

      const job = await addJob({
        type: 'plugin',
        pluginName: appKey,
        method: app.searchProducts ? 'searchProducts' : 'searchProductsForItinerary',
        token,
        payload: { payload: payloadForBackgroundJob, userId, hint },
        postProcess: {
          controller: 'bookings',
          action: '$updateProductSearchCache',
          args: { appKey, userId, hint },
        },
      }, { removeOnComplete: true });

      return returnCachedResults('stale_served', {
        reason: 'backgroundRefreshQueued',
        jobId: job && job.id,
      });
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

const $updateProductSearchCache = plugins => async ({
  appKey,
  userId,
  hint,
  pluginResult, // Result from the plugin method call
  requestId,
  // 'plugins' is available via the factory closure
}) => {
  const app = plugins.find(({ name }) => name === appKey);
  if (!app) {
    console.error(`[$updateProductSearchCache][requestId: ${requestId}] Plugin ${appKey} not found.`);
    return; // Or throw error
  }

  const cacheKey = hash({ userId, hint, operationId: productSearchOperationId });
  const monthInSeconds = 30 * 24 * 60 * 60;
  const markRefreshAttempted = () => app.cache.save({
    key: `${cacheKey}:lastUpdated`,
    value: Date.now(),
    ttl: monthInSeconds,
  });
  const emitCacheEvent = (action, extra = {}) => emitProductSearchCacheDecision({
    app,
    cacheKey,
    userId,
    hint,
    requestId,
    searchInput: '',
    optionId: '',
    forceRefresh: false,
    startedAt: Date.now(),
  }, action, extra);

  if (hasCacheableProductResults(pluginResult)) {
    await markRefreshAttempted();
    await app.cache.save({ key: cacheKey, value: pluginResult, ttl: monthInSeconds });
    emitCacheEvent('cache_saved', { cacheProductCount: productCount(pluginResult) });
  } else {
    const isPartialRefresh = pluginResult && (pluginResult.catalogPartial || pluginResult.partial);
    const existingCacheContent = await app.cache.get({ key: cacheKey });
    if (hasNonEmptyProductCache(existingCacheContent)) {
      await markRefreshAttempted();
      const eventExtra = {
        reason: isPartialRefresh ? 'partialResultPreservedExistingCache' : 'emptyResultPreservedExistingCache',
        cachePreserved: true,
        existingProductCount: existingCacheContent.products.length,
      };
      if (isPartialRefresh) eventExtra.returnedProductCount = productCount(pluginResult);
      emitCacheEvent(
        isPartialRefresh ? 'partial_refresh_skipped' : 'empty_refresh_skipped',
        eventExtra,
      );
      return;
    }

    if (isPartialRefresh) {
      await markRefreshAttempted();
      emitCacheEvent('partial_refresh_skipped', {
        reason: 'partialResultNotCached',
        cachePreserved: false,
        returnedProductCount: productCount(pluginResult),
      });
      return;
    }

    // Best-effort race guard: avoid overwriting a non-empty cache written after the first read.
    const latestCacheContent = await app.cache.get({ key: cacheKey });
    if (hasNonEmptyProductCache(latestCacheContent)) {
      await markRefreshAttempted();
      emitCacheEvent('empty_refresh_skipped', {
        reason: 'emptyResultPreservedConcurrentCache',
        cachePreserved: true,
        existingProductCount: latestCacheContent.products.length,
      });
      return;
    }

    // Empty complete refreshes are authoritative only when there is no existing non-empty cache.
    await markRefreshAttempted();
    await app.cache.save({ key: cacheKey, value: { products: [] }, ttl: monthInSeconds });
    emitCacheEvent('empty_cache_saved', { cacheProductCount: 0 });
  }
};

// Update the module.exports to correctly assign the plugin-wrapped function
const controllerFactory = plugins => {
  const controllerFunctions = {
    bookingsSearch: bookingsSearch(plugins),
    bookingsCancel: bookingsCancel(plugins),
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
    $updateProductSearchCache: $updateProductSearchCache(plugins), // Add the new function here
  };
  // Ensure $bookingsProductSearch can be called internally by worker with plugins already bound
  // This is more of a conceptual note as the factory pattern already handles this.
  return controllerFunctions;
};

// Add this line to attach typeDefsAndQueries to the factory:
controllerFactory.typeDefsAndQueries = typeDefsAndQueries;

module.exports = controllerFactory;
