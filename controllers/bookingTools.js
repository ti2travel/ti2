const assert = require('assert');
const R = require('ramda');
const { UserAppKey } = require('../models');
const { createCredentialClient, redactCredentialError } = require('../lib/credential-request');

// TC-1200: provider-neutral booking-edit tools. Each tool has a fixed generic request contract and
// maps to one plugin method. The plugin owns provider mapping; callers never send provider payloads.
const TOOLS = {
  list_booking_reference_data: {
    method: 'listBookingReferenceData',
    fields: ['categories', 'query', 'limit'],
  },
};

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
  const contract = TOOLS[tool];
  if (!contract) throw badRequest(`Unknown booking tool: ${tool}`);
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw badRequest(`${tool} needs a request object`);
  }
  Object.keys(request).forEach(key => {
    if (!contract.fields.includes(key)) throw badRequest(`${key} is not part of the ${tool} contract`);
  });
  assertGeneric(request);
  return contract;
};

const bookingTool = plugins => async (req, res, next) => {
  const { appKey, userId, hint, tool } = req.params;
  const request = R.propOr({}, 'request', req.body);
  const credentials = R.prop('credentials', req.body);
  try {
    const contract = validRequest(tool, request);
    const app = plugins.find(({ name }) => name === appKey);
    assert(app, `could not find the app ${appKey}`);
    if (typeof app[contract.method] !== 'function') {
      return res.status(501).json({ message: `${tool} is not supported by ${appKey}` });
    }
    const integration = await UserAppKey.findOne({ where: { userId, integrationId: appKey, hint } });
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
