const assert = require('assert');
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

const bookingsSearch = plugins => async (req, res, next) => {
  const {
    axios,
    params: { appKey, userId, hint },
    body,
  } = req;
  try {
    const app = plugins.find(({ name }) => name === appKey);
    const userAppKeys = await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    });
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.searchItineraries || app.searchHotelBooking || app.searchBooking, `searchItineraries or searchHotelBooking or searchBooking is not available for ${appKey}`);
    const search = (app.searchHotelBooking || app.searchBooking || app.searchItineraries).bind(app);
    const results = await search({
      axios,
      token,
      payload: body,
      typeDefsAndQueries,
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    const results = await app.cancelBooking({
      axios,
      token,
      payload: body,
      typeDefsAndQueries,
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

  const app = plugins.find(({ name }) => name === appKey);
  assert(userId, 'userId is required');
  assert(appKey, 'appKey is required');
  assert(app.searchProducts || app.searchProductsForItinerary, `searchProducts or searchProductsForItinerary is not available for ${appKey}`);
  const userAppKeys = (await UserAppKey.findOne({
    where: { userId, integrationId: appKey, ...(hint ? { hint } : {}) },
  }));
  assert(userAppKeys, 'could not find the app key');
  const token = await userAppKeys.token;
  const func = (app.searchProducts || app.searchProductsForItinerary).bind(app);

  const cacheKey = hash({ userId, hint, operationId: 'bookingsProductSearch' });
  const pluginExecutionLockKey = `${cacheKey}:lock`; // Lock for direct plugin execution
  const jobQueueLockKey = `${cacheKey}:jobLock`;   // Lock for preventing multiple job queues

  // Fetch actualCacheContent once at the beginning.
  const initialActualCacheContent = await app.cache.get({ key: cacheKey });
  const lastUpdated = await app.cache.get({ key: `${cacheKey}:lastUpdated` });
  const ttr = token.ttlForProducts || R.path(['cacheSettings', 'bookingsProductSearch', 'ttr'], app) || 60 * 60 * 24;
  const isStaleByTTR = lastUpdated && (Date.now() - lastUpdated > ttr * 1000);
  const doNotCallPluginForProducts = token.doNotCallPluginForProducts || R.path(['cacheSettings', 'bookingsProductSearch', 'doNotCall'], app);
  const hasPluginExecutionLock = await app.cache.get({ key: pluginExecutionLockKey });

  // Helper function to call the plugin, save cache, and return results
  const fetchFromPluginAndCache = async () => {
    await app.cache.save({ key: pluginExecutionLockKey, value: true, ttl: 120 });
    let pluginResults;
    try {
      pluginResults = await func({
        axios, token, payload: payloadForPlugin, typeDefsAndQueries, requestId, userId,
      });

      // This function is responsible for caching if it fetched good results.
      // This applies to forceRefresh, initial load, or direct calls that result in a fetch.
      // The $updateProductSearchCache function handles caching for background jobs queued due to stale data.
      if (pluginResults && pluginResults.products && pluginResults.products.length > 0) {
        const monthInSeconds = 30 * 24 * 60 * 60;
        await app.cache.save({ key: `${cacheKey}:lastUpdated`, value: Date.now(), ttl: monthInSeconds });
        await app.cache.save({ key: cacheKey, value: pluginResults, ttl: monthInSeconds });
        app.events.emit('bookingsProductSearch:cache:save', {
          cacheKey, userId, hint, operationId: 'bookingsProductSearch', requestId, pluginName: app.name,
        });
      }
      // If pluginResults are empty, cache is NOT updated here by fetchFromPluginAndCache.
      // This maintains existing behavior for forceRefresh/initial load paths.
      // $updateProductSearchCache has its own logic for handling empty results from background refresh.
    } finally {
      await app.cache.drop({ key: pluginExecutionLockKey });
    }
    return pluginResults || { products: [] }; // Ensure products array exists
  };

  // 1. `doNotCallPluginForProducts` is true, and not `forceRefresh`: Serve from cache or empty.
  if (doNotCallPluginForProducts && !forceRefresh) {
    if (initialActualCacheContent && initialActualCacheContent.products) {
      const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId);
      return { ...initialActualCacheContent, products: searchResults, ...(token.configuration || {}) };
    }
    return { products: [], ...(token.configuration || {}) };
  }

  // 2. `forceRefresh` is true (and not case 1): Fetch from plugin.
  //    fetchFromPluginAndCache will handle caching the new results.
  if (forceRefresh) {
    const funcResults = await fetchFromPluginAndCache();
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
      const returnCachedResults = () => {
        const searchResults = $searchProductList(initialActualCacheContent.products, searchInput, optionId);
        return { ...initialActualCacheContent, products: searchResults, ...(token.configuration || {}) };
      };

      const isEffectivelyStale = isStaleByTTR && !doNotCallPluginForProducts;

      // Cache is fresh or plugin execution in progress: serve from cache
      if (!isEffectivelyStale || hasPluginExecutionLock) {
        return returnCachedResults();
      }

      // Cache is stale - check if background job already queued
      const hasJobQueueLock = await app.cache.get({ key: jobQueueLockKey });
      if (hasJobQueueLock) {
        return returnCachedResults();
      }

      // Queue background refresh job and serve stale data
      await app.cache.save({ key: jobQueueLockKey, value: true, ttl: 60 });
      await addJob({
        type: 'plugin',
        pluginName: appKey,
        method: app.searchProducts ? 'searchProducts' : 'searchProductsForItinerary',
        token,
        payload: { payload: payloadForPlugin, userId },
        postProcess: {
          controller: 'bookings',
          action: '$updateProductSearchCache',
          args: { appKey, userId, hint },
        },
      }, { removeOnComplete: true });

      return returnCachedResults();
    }
  }

  // 4. No cache content (and not caught by previous conditions like forceRefresh or doNotCallPluginForProducts):
  //    Fetch from plugin. fetchFromPluginAndCache will handle caching.
  const funcResults = await fetchFromPluginAndCache();
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    assert(app.getProductPackages, `getProductPackages is not available for ${appKey}`);
    const token = await userAppKeys.token;
    const results = await app.getProductPackages({
      axios,
      token,
      payload,
      typeDefsAndQueries,
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    const func = (app.searchAvailability || app.searchAvailabilityForItinerary).bind(app);
    const results = await func({
      axios,
      token,
      payload,
      typeDefsAndQueries,
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
  const app = plugins.find(({ name }) => name === appKey);
  // const app = load(appKey);
  const userAppKeys = (await UserAppKey.findOne({
    where: {
      userId,
      integrationId: appKey,
      ...(hint ? { hint } : {}),
    },
  }));
  assert(userAppKeys, 'could not find the app key');
  assert(app.availabilityCalendar, `availabilityCalendar is not available for ${appKey}`);
  const token = await userAppKeys.token;
  return app.availabilityCalendar({
    axios,
    token,
    payload,
    typeDefsAndQueries,
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    const results = await app.searchQuote({
      axios,
      token,
      payload,
      typeDefsAndQueries,
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
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
        requestId: req.requestId,
      });
    }
    console.log(`emitting bookingsCreateBooking event for ${appKey}, user ${userId}, hint ${hint}, results: ${JSON.stringify(results)}`);
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.getAffiliateAgents, `getAffiliateAgents is not available for ${appKey}`);
    const results = await app.getAffiliateAgents({
      axios,
      token,
      payload,
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.getAffiliateDesks, `getAffiliateDesks is not available for ${appKey}`);
    const results = await app.getAffiliateDesks({
      axios,
      token,
      payload,
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.getPickupPoints, `getPickupPoints is not available for ${appKey}`);
    const results = await app.getPickupPoints({
      axios,
      token,
      payload,
      typeDefsAndQueries,
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
    const app = plugins.find(({ name }) => name === appKey);
    // const app = load(appKey);
    const userAppKeys = (await UserAppKey.findOne({
      where: {
        userId,
        integrationId: appKey,
        ...(hint ? { hint } : {}),
      },
    }));
    assert(userAppKeys, 'could not find the app key');
    const token = await userAppKeys.token;
    assert(app.getCreateBookingFields || app.getCreateItineraryFields, `getCreateBookingFields or getCreateItineraryFields is not available for ${appKey}`);
    const func = (app.getCreateItineraryFields || app.getCreateBookingFields).bind(app);
    const results = await func({
      axios,
      token,
      payload,
      query,
      typeDefsAndQueries,
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

  const cacheKey = hash({ userId, hint, operationId: 'bookingsProductSearch' });
  const monthInSeconds = 30 * 24 * 60 * 60;

  // Always update lastUpdated to prevent immediate re-trigger of background jobs
  // even if the plugin returned empty results.
  await app.cache.save({ key: `${cacheKey}:lastUpdated`, value: Date.now(), ttl: monthInSeconds });

  if (pluginResult && pluginResult.products && pluginResult.products.length > 0) {
    await app.cache.save({ key: cacheKey, value: pluginResult, ttl: monthInSeconds });
    app.events.emit('bookingsProductSearch:cache:save', {
      cacheKey, userId, hint, operationId: 'bookingsProductSearch', requestId, pluginName: app.name,
    });
    console.log(`[$updateProductSearchCache][requestId: ${requestId}] Saved products to cache for ${appKey}, user ${userId}, hint ${hint}.`);
  } else {
    // If plugin returned no products, update the cache to reflect this.
    // This prevents serving stale data indefinitely if the source truly has no products anymore.
    await app.cache.save({ key: cacheKey, value: { products: [] }, ttl: monthInSeconds });
    app.events.emit('bookingsProductSearch:cache:emptyRefresh', {
      cacheKey, userId, hint, operationId: 'bookingsProductSearch', requestId, pluginName: app.name,
      pluginResult, // Log what the plugin returned
    });
    console.log(`[$updateProductSearchCache][requestId: ${requestId}] Plugin returned empty/no products. Cached empty for ${appKey}, user ${userId}, hint ${hint}.`);
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
