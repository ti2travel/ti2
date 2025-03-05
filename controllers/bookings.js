const assert = require('assert');
const hash = require('object-hash');
const cache = require('../cache');
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
    ...restPayload
  },
  requestId,
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
  const cacheKey = hash({
    appKey,
    userId,
    hint,
    operationId: 'bookingsProductSearch',
  });
  // TODO: remove debugging console.logs after no related issues reported for a while
  // Check cache first if not forcing refresh
  const cacheValue = forceRefresh ? null : await cache.get({
    pluginName: appKey,
    key: cacheKey,
  });
  const lastUpdated = await cache.get({
    pluginName: appKey,
    key: `${cacheKey}:lastUpdated`,
  });
  // refresh every 24 hours
  const ttr = token.ttlForProducts || R.path(['cacheSettings', 'bookingsProductSearch', 'ttr'], app) || 60 * 60 * 24;
  let isStale = lastUpdated && (Date.now() - lastUpdated > ttr * 1000);
  const doNotCallPluginForProducts = token.doNotCallPluginForProducts
    || R.path(['cacheSettings', 'bookingsProductSearch', 'doNotCall'], app);
  // if a company says never to call the plugin (their booking system)
  // we will never treat their cache as stale
  if (doNotCallPluginForProducts) {
    isStale = false;
  }
  const hasLock = await cache.get({
    pluginName: appKey,
    key: `${cacheKey}:lock`,
  });
  console.log(`${appKey}/${userId}/${hint}: lastUpdated: ${lastUpdated}, ttr: ${ttr}, isStale: ${isStale}, hasLock: ${hasLock}, foundCache: ${!!cacheValue}`);
  // when there is a lock (meaning another request is already fetching the products)
  // return stale cache during this short window
  if (cacheValue && cacheValue.products && (hasLock || !isStale)) {
    const searchResults = $searchProductList(cacheValue.products, searchInput, optionId);
    console.log(`${appKey}/${userId}/${hint}: returning cached products: ${searchResults.length}`);
    return {
      ...cacheValue,
      products: searchResults,
      // this is for sending the product filters specifically being used by pyfilematch
      ...(token.configuration || {}),
    };
  }
  if (doNotCallPluginForProducts && !forceRefresh) {
    console.log(`${appKey}/${userId}/${hint}:not calling the plugin because doNotCallPluginForProducts is true and forceRefresh is false`);
    return { products: [] };
  }
  console.log(`${appKey}/${userId}/${hint}: (forceRefresh: ${forceRefresh}) so calling func to get fresh products`);
  // create a lock with 2 minute TTL
  await cache.save({
    pluginName: appKey,
    key: `${cacheKey}:lock`,
    value: true,
    ttl: 120,
  });
  const funcResults = await func({
    axios,
    token,
    payload: restPayload,
    typeDefsAndQueries,
    requestId,
    userId,
  });
  // save cache if products are found
  if (funcResults && funcResults.products && funcResults.products.length > 0) {
    console.log(`${appKey}/${userId}/${hint}: saving cache of ${funcResults.products.length} products`);
    // I initially wanted to let the cache live forever
    // but just in case user left TC or something, we don't want to keep the cache forever
    // so we set the TTL to 30 days, within 30 days,
    // we will refresh the cache every 24 hours(or specified by the user) without deleting the stale cache
    const monthInSeconds = 30 * 24 * 60 * 60;
    await cache.save({
      pluginName: appKey,
      key: `${cacheKey}:lastUpdated`,
      value: Date.now(),
      ttl: monthInSeconds,
    });
    await cache.save({
      pluginName: appKey,
      key: cacheKey,
      value: funcResults,
      ttl: monthInSeconds,
    });
  }
  // release the lock
  await cache.drop({
    pluginName: appKey,
    key: `${cacheKey}:lock`,
  });
  const searchResults = $searchProductList(R.pathOr([], ['products'], funcResults), searchInput, optionId);
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
