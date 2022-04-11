const assert = require('assert');

const { UserAppKey } = require('../models/index');

const bookingsSearch = plugins => async (req, res, next) => {
  const {
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
    const token = userAppKeys.appKey;
    const search = app.searchHotelBooking || app.searchBooking;
    const results = await search({
      token,
      payload: body,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const bookingsCancel = plugins => async (req, res, next) => {
  const {
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
    const token = userAppKeys.appKey;
    const results = await app.cancelBooking({
      token,
      payload: body,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const bookingsProductSearch = plugins => async (req, res, next) => {
  const {
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
    const token = userAppKeys.appKey;
    const results = await app.searchProducts({
      token,
      payload,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const bookingsAvailabilitySearch = plugins => async (req, res, next) => {
  const {
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
    const token = userAppKeys.appKey;
    const results = await app.searchAvailability({
      token,
      payload,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const bookingsAvailabilityCalendar = plugins => async (req, res, next) => {
  const {
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
    const token = userAppKeys.appKey;
    const results = await app.availabilityCalendar({
      token,
      payload,
    });
    return res.json(results);
  } catch (err) {
    console.log({ err });
    return next(err);
  }
};

const searchQuote = plugins => async (req, res, next) => {
  const {
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
    const token = userAppKeys.appKey;
    assert(payload.id, 'the availability id is required');
    const results = await app.searchQuote({
      token,
      payload,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

const createBooking = plugins => async (req, res, next) => {
  const {
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
    const token = userAppKeys.appKey;
    assert(payload.id, 'the quote id is required');
    const results = await app.createBooking({
      token,
      payload,
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
};

module.exports = plugins => ({
  bookingsSearch: bookingsSearch(plugins),
  bookingsCancel: bookingsCancel(plugins),
  bookingsProductSearch: bookingsProductSearch(plugins),
  bookingsAvailabilitySearch: bookingsAvailabilitySearch(plugins),
  bookingsAvailabilityCalendar: bookingsAvailabilityCalendar(plugins),
  searchQuote: searchQuote(plugins),
  createBooking: createBooking(plugins),
});
