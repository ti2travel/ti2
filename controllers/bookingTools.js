const R = require('ramda');
const { UserAppKey } = require('../models');
const { createCredentialClient, redactCredentialError } = require('../lib/credential-request');

// Field types of the generic contract. The plugin validates the content of each item.
const isText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const isId = value => isText(value) || (Number.isInteger(value) && value > 0);
const isList = (check, { allowEmpty = false } = {}) => value => Array.isArray(value)
  && (allowEmpty || value.length > 0) && value.length <= 50 && value.every(check);
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isLimit = value => Number.isInteger(value) && value > 0 && value <= 200;

// Provider-neutral booking-edit tools. Each tool has a fixed generic request contract and maps
// to one plugin method. The plugin owns provider mapping; callers never send provider payloads.
const TOOLS = {
  list_booking_reference_data: {
    method: 'listBookingReferenceData',
    // An empty category list reads every table.
    fields: { categories: isList(isText, { allowEmpty: true }), query: isText, limit: isLimit },
  },
  // Writes name the booking and the version the caller read; the plugin refuses a stale version.
  update_booking_passengers: {
    method: 'updateBookingPassengers',
    fields: { bookingId: isId, expectedVersion: isText, actions: isList(isObject) },
    required: ['bookingId', 'expectedVersion', 'actions'],
  },
  update_booking_services: {
    method: 'updateBookingServices',
    fields: { bookingId: isId, expectedVersion: isText, updates: isList(isObject) },
    required: ['bookingId', 'expectedVersion', 'updates'],
  },
  remove_booking_services: {
    method: 'removeBookingServices',
    fields: { bookingId: isId, expectedVersion: isText, serviceIds: isList(isId) },
    required: ['bookingId', 'expectedVersion', 'serviceIds'],
  },
};
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Keys that would let a caller smuggle process state, provider payloads or a host decision
// through the generic boundary.
const NON_GENERIC_KEY = /^(raw|providerPayload|naturalLanguage|extraction|confirmed|credentials|runtime)$/i;

const badRequest = message => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const assertGeneric = value => {
  if (Array.isArray(value)) return value.forEach(assertGeneric);
  if (!value || typeof value !== 'object') return undefined;
  return Object.keys(value).forEach(key => {
    if (NON_GENERIC_KEY.test(key)) throw badRequest(`${key} is not part of the generic booking contract`);
    assertGeneric(value[key]);
  });
};

const validRequest = (tool, request) => {
  if (!own(TOOLS, tool)) throw badRequest(`Unknown booking tool: ${tool}`);
  const contract = TOOLS[tool];
  if (!isObject(request)) throw badRequest(`${tool} needs a request object`);
  Object.keys(request).forEach(key => {
    if (!own(contract.fields, key)) throw badRequest(`${key} is not part of the ${tool} contract`);
  });
  assertGeneric(request);
  (contract.required || []).forEach(key => {
    if (!own(request, key)) throw badRequest(`${tool} needs ${key}`);
  });
  Object.keys(request).forEach(key => {
    if (!contract.fields[key](request[key])) throw badRequest(`${key} is not valid for ${tool}`);
  });
  return contract;
};

const bookingTool = plugins => async (req, res, next) => {
  const {
    appKey, userId, hint, tool,
  } = req.params;
  const request = R.propOr({}, 'request', req.body);
  const credentials = R.prop('credentials', req.body);
  try {
    const contract = validRequest(tool, request);
    const app = plugins.find(({ name }) => name === appKey);
    if (!app) return res.status(404).json({ message: `Booking system ${appKey} is not available` });
    if (typeof app[contract.method] !== 'function') {
      return res.status(501).json({ message: `${tool} is not supported by ${appKey}` });
    }
    const integration = await UserAppKey.findOne({
      where: { userId, integrationId: appKey, hint },
    });
    if (!integration) return res.status(404).json({ message: 'Integration not found' });
    const result = await app[contract.method]({
      axios: credentials ? createCredentialClient(app, req.requestId) : app.axios,
      token: await integration.token,
      userId,
      hint,
      requestId: req.requestId,
      payload: { ...request, ...(credentials && { credentials }) },
    });
    return res.json(result);
  } catch (error) {
    return next(redactCredentialError(error, 'Booking system request failed'));
  }
};

module.exports = plugins => ({ bookingTool: bookingTool(plugins) });
module.exports.TOOLS = TOOLS;
