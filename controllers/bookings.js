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
  payload: {
    searchInput,
    optionId,
    forceRefresh,
    backgroundJob, // To identify calls from background worker
    ...restPayload
  },
  requestId,
  headers, // To pass original request headers for background job
}) => {
  const app = plugins.find(({ name }) => name === appKey);
  assert(userId, 'userId is required');
  assert(appKey, 'appKey is required');
  assert(app.searchProducts || app.searchProductsForItinerary, `searchProducts or searchProductsForItinerary is not available for ${appKey}`);
  const userAppKeys = (await UserAppKey.findOne({
    where: {
      userId,
      integrationId: appKey,
      ...(hint ? { hint } : {}),
    },
  }));
  assert(userAppKeys, 'could not find the app key');
  const token = await userAppKeys.token;
  const func = (app.searchProducts || app.searchProductsForItinerary).bind(app);
  // NOTE: this is intend to cache the entire product list
  const cacheKey = hash({ userId, hint, operationId: 'bookingsProductSearch' });
  const actualCacheContent = await app.cache.get({ key: cacheKey });
  const lastUpdated = await app.cache.get({ key: `${cacheKey}:lastUpdated` });

  const ttr = token.ttlForProducts || R.path(['cacheSettings', 'bookingsProductSearch', 'ttr'], app) || 60 * 60 * 24;
  let isStale = lastUpdated && (Date.now() - lastUpdated > ttr * 1000);
  const doNotCallPluginForProducts = token.doNotCallPluginForProducts || R.path(['cacheSettings', 'bookingsProductSearch', 'doNotCall'], app);

  if (doNotCallPluginForProducts && !forceRefresh) {
    isStale = false;
  }
  const hasLock = await app.cache.get({ key: `${cacheKey}:lock` });

  // If this is a background job, it should proceed to refresh, not serve from cache or spawn another job.
  if (!backgroundJob) {
    if (actualCacheContent && actualCacheContent.products) {
      if (!isStale || hasLock) { // Cache is fresh, or another process is refreshing
        const searchResults = $searchProductList(actualCacheContent.products, searchInput, optionId);
        return { ...actualCacheContent, products: searchResults, ...(token.configuration || {}) };
      } else { // Cache is stale and no lock: serve stale, then refresh in background
        const searchResults = $searchProductList(actualCacheContent.products, searchInput, optionId);
        
        // Prepare payload for the API call the worker will make
        const apiCallPayload = { ...restPayload, searchInput, optionId, forceRefresh: true, backgroundJob: true };
        const jwtToken = headers && headers.authorization ? headers.authorization.split(' ')[1] : null;

        // Prepare data for addJob, conforming to worker's expectations for 'api' type jobs
        const jobData = {
          type: 'api',
          method: 'POST',
          url: `/products/${appKey}/${userId}/${hint}/search`,
          // The worker's 'api' job type expects 'token' (JWT) and other params for the API body within this 'payload'
          payload: { 
            ...apiCallPayload, // This becomes the body of the request made by the worker
            token: jwtToken,   // JWT for the worker to set Authorization header
          },
          headers: R.omit(['content-length', 'host', 'connection', 'accept-encoding'], headers),
        };
        
        await addJob(jobData, { removeOnComplete: true });
        
        return { ...actualCacheContent, products: searchResults, ...(token.configuration || {}) };
      }
    }
    // If no actualCacheContent, proceed to fetch.
  }
  
  // Proceed to fetch from plugin if:
  // - It's a backgroundJob call.
  // - It's a forceRefresh call (and not handled by serving stale + background refresh).
  // - Cache was empty.
  // - `doNotCallPluginForProducts` is false or `forceRefresh` is true.
  if (doNotCallPluginForProducts && !forceRefresh && !backgroundJob) {
    return { products: [] };
  }

  await app.cache.save({ key: `${cacheKey}:lock`, value: true, ttl: 120 });
  
  const funcResults = await func({
    axios,
    token,
    payload: restPayload, // Pass original payload without searchInput/optionId/forceRefresh/backgroundJob
    typeDefsAndQueries,
    requestId,
    userId,
  });

  if (funcResults && funcResults.products && funcResults.products.length > 0) {
    const monthInSeconds = 30 * 24 * 60 * 60;
    await app.cache.save({ key: `${cacheKey}:lastUpdated`, value: Date.now(), ttl: monthInSeconds });
    await app.cache.save({ key: cacheKey, value: funcResults, ttl: monthInSeconds });
    app.events.emit('bookingsProductSearch:cache:save', {
      cacheKey, userId, hint, operationId: 'bookingsProductSearch', requestId, pluginName: app.name,
    });
  } else if (backgroundJob && actualCacheContent && actualCacheContent.products) {
    // Background job fetched empty results, but stale content exists. Keep stale content.
    // Only update the 'lastUpdated' timestamp to prevent immediate re-triggering.
    const monthInSeconds = 30 * 24 * 60 * 60;
    await app.cache.save({ key: `${cacheKey}:lastUpdated`, value: Date.now(), ttl: monthInSeconds });
    app.events.emit('bookingsProductSearch:cache:refreshEmptyKeepStale', {
      cacheKey, userId, hint, operationId: 'bookingsProductSearch', requestId, pluginName: app.name,
    });
  }
  // For other cases (e.g., foreground request gets empty results), the cache is not updated with empty results,
  // and `lastUpdated` is not touched, allowing staleness to persist or re-trigger.

  await app.cache.drop({ key: `${cacheKey}:lock` });

  // Determine products to return based on funcResults or fallback to actualCacheContent if appropriate (though covered by earlier logic)
  const productsToReturn = (funcResults && funcResults.products && funcResults.products.length > 0)
    ? funcResults.products
    : []; // Default to empty if refresh failed or yielded no products

  const searchResults = $searchProductList(productsToReturn, searchInput, optionId);
  return {
    ...(funcResults || {}), // Spread funcResults if it exists, otherwise an empty object
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

module.exports = plugins => ({
  bookingsSearch: bookingsSearch(plugins),
  bookingsCancel: bookingsCancel(plugins),
  $bookingsProductSearch,
  bookingsProductSearch: bookingsProductSearch(plugins),
  getProductPackages: getProductPackages(plugins),
  bookingsAvailabilitySearch: bookingsAvailabilitySearch(plugins),
  $bookingsAvailabilityCalendar,
  bookingsAvailabilityCalendar: bookingsAvailabilityCalendar(plugins),
  searchQuote: searchQuote(plugins),
  createBooking: createBooking(plugins),
  getAffiliateAgents: getAffiliateAgents(plugins),
  getAffiliateDesks: getAffiliateDesks(plugins),
  getPickupPoints: getPickupPoints(plugins),
  getCreateBookingFields: getCreateBookingFields(plugins),
});
