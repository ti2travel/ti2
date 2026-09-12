const assert = require('assert');
const hash = require('object-hash');
const { v4: uuidv4 } = require('uuid');

const cache = require('../cache');
const getAppAndToken = require('../lib/get-app-and-token');
const { typeDefsAndQueries } = require('./bookings');

const operationTtlSeconds = 30 * 24 * 60 * 60;
const continuationTtlMs = 30 * 60 * 1000;

const toolMethods = {
  get_booking_capabilities: 'getBookingCapabilities',
  list_booking_reference_data: 'listBookingReferenceData',
  search_bookings: 'searchBookings',
  get_booking: 'getBooking',
  search_booking_products: 'searchBookingProducts',
  check_booking_product_availability: 'checkBookingProductAvailability',
  copy_booking: 'copyBooking',
  update_booking: 'updateBooking',
  reschedule_booking: 'rescheduleBooking',
  update_booking_passengers: 'updateBookingPassengers',
  add_booking_services: 'addBookingServices',
  update_booking_services: 'updateBookingServices',
  remove_booking_services: 'removeBookingServices',
};

const writeTools = new Set([
  'copy_booking',
  'update_booking',
  'reschedule_booking',
  'update_booking_passengers',
  'add_booking_services',
  'update_booking_services',
  'remove_booking_services',
]);

const requestFields = {
  get_booking_capabilities: [],
  list_booking_reference_data: ['categories'],
  search_bookings: [
    'query', 'bookingReference', 'passengerName', 'startDateFrom', 'startDateTo', 'status', 'limit',
  ],
  get_booking: ['bookingId', 'selectionToken'],
  get_booking_operation: ['operationId'],
  search_booking_products: [
    'query', 'startDate', 'endDate', 'locationId', 'passengerCount', 'limit',
  ],
  check_booking_product_availability: [
    'productOptionIds', 'startDate', 'endDate', 'quantity', 'rooms',
  ],
  copy_booking: [
    'sourceBookingId', 'expectedVersion', 'selectionToken', 'name', 'startDate',
  ],
  update_booking: ['bookingId', 'expectedVersion', 'selectionToken', 'patch'],
  reschedule_booking: [
    'bookingId', 'expectedVersion', 'selectionToken', 'startDate', 'preserveServiceOffsets',
  ],
  update_booking_passengers: ['bookingId', 'expectedVersion', 'selectionToken', 'actions'],
  add_booking_services: ['bookingId', 'expectedVersion', 'selectionToken', 'services'],
  update_booking_services: ['bookingId', 'expectedVersion', 'selectionToken', 'updates'],
  remove_booking_services: ['bookingId', 'expectedVersion', 'selectionToken', 'serviceIds'],
  continue_booking_operation: ['operationId'],
};

const providerSpecificKey = key => (
  /^(raw|providerPayload|naturalLanguage|extraction|confirmed|credentials|currentBooking|runtime)$/i.test(key)
);

const assertGenericValue = value => {
  if (Array.isArray(value)) return value.forEach(assertGenericValue);
  if (!value || typeof value !== 'object') return undefined;
  Object.entries(value).forEach(([key, item]) => {
    assert(!providerSpecificKey(key), `${key} is not part of the generic booking contract`);
    assertGenericValue(item);
  });
  return undefined;
};

const assertGenericRequest = (tool, request) => {
  const allowed = requestFields[tool];
  assert(allowed, `Unknown booking tool: ${tool}`);
  Object.keys(request).forEach(key => {
    assert(allowed.includes(key), `${key} is not part of the ${tool} contract`);
  });
  assertGenericValue(request);
};

const secretKey = key => /authorization|cookie|credential|password|secret|session|token/i.test(key);

const sanitize = value => {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((result, [key, item]) => {
    if (!secretKey(key)) result[key] = sanitize(item);
    return result;
  }, {});
};

const bookingActionHash = (tool, request) => hash({
  tool,
  request: sanitize(Object.entries(request || {}).reduce((result, [key, value]) => {
    if (key !== 'selectionToken') result[key] = value;
    return result;
  }, {})),
});

const operationKey = ({ userId, hint, operationId }) => (
  `bookingOperation:${hash({ userId, hint: hint || '', operationId })}`
);

const idempotencyKey = ({ userId, hint, key }) => (
  `bookingOperationIdempotency:${hash({ userId, hint: hint || '', key })}`
);

const loadOperation = async ({ appKey, userId, hint, operationId }) => cache.get({
  pluginName: appKey,
  key: operationKey({ userId, hint, operationId }),
});

const saveOperation = async ({ appKey, userId, hint, record }) => {
  await cache.save({
    pluginName: appKey,
    key: operationKey({ userId, hint, operationId: record.operationId }),
    value: sanitize(record),
    ttl: operationTtlSeconds,
  });
  if (record.idempotencyKey) {
    await cache.save({
      pluginName: appKey,
      key: idempotencyKey({ userId, hint, key: record.idempotencyKey }),
      value: record.operationId,
      ttl: operationTtlSeconds,
    });
  }
};

const getIdempotentOperation = async ({ appKey, userId, hint, key }) => {
  if (!key) return null;
  const operationId = await cache.get({
    pluginName: appKey,
    key: idempotencyKey({ userId, hint, key }),
  });
  if (!operationId) return null;
  return loadOperation({ appKey, userId, hint, operationId });
};

const idempotencyLockKey = ({ userId, hint, key }) => (
  `bookingOperationIdempotencyLock:${hash({ userId, hint: hint || '', key })}`
);

const waitForIdempotentOperation = async params => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const operation = await getIdempotentOperation(params);
    if (operation) return operation;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
};

const callPlugin = async ({ app, token, pluginMethod, req, payload }) => {
  assert(app[pluginMethod], `${pluginMethod} is not available for ${app.name}`);
  return app[pluginMethod]({
    axios: req.axios,
    token,
    payload,
    userId: req.params.userId,
    hint: req.params.hint,
    requestId: req.requestId,
    typeDefsAndQueries,
  });
};

const bookingIdFrom = (tool, payload, result) => {
  if (tool === 'copy_booking') {
    return result.bookingId || result.newBookingId;
  }
  return result.bookingId || payload.bookingId;
};

const readFreshBooking = async ({ app, token, req, bookingId, credentials }) => {
  if (!bookingId || !app.getBooking) return null;
  return callPlugin({
    app,
    token,
    pluginMethod: 'getBooking',
    req,
    payload: {
      bookingId,
      ...(credentials && { credentials }),
    },
  });
};

const errorText = error => {
  if (typeof error === 'string') return error;
  return String(error && error.message ? error.message : error || 'Booking operation failed');
};

const safeErrorText = error => errorText(error)
  .replace(/(Bearer\s+)[^\s]+/gi, '$1***')
  .replace(/(password|token|secret|cookie|session)(\s*[=:]\s*)[^\s,;}]+/gi, '$1$2***')
  .slice(0, 500);

const isAuthError = error => /auth|cookie|externalSessionRequired|login|session/i.test(errorText(error));

const hydrateReplay = async ({ replay, app, token, req, credentials }) => {
  let booking;
  if (replay.bookingId && ['completed', 'partial'].includes(replay.outcome)) {
    try {
      booking = await readFreshBooking({
        app,
        token,
        req,
        bookingId: replay.bookingId,
        credentials,
      });
    } catch (error) {
      if (!isAuthError(error)) throw error;
    }
  }
  return {
    ...replay,
    booking,
    nextVersion: booking && booking.version ? booking.version : replay.nextVersion,
  };
};

const operationResponse = record => ({
  operationId: record.operationId,
  tool: record.tool,
  outcome: record.outcome,
  bookingId: record.bookingId,
  bookingReference: record.bookingReference,
  nextVersion: record.nextVersion,
  outcomes: record.outcomes || [],
  changes: record.changes || [],
  inputRequest: record.inputRequest,
  booking: record.booking,
  error: record.error,
  requestId: record.requestId,
  createdAt: record.createdAt,
  completedAt: record.completedAt,
});

const authRequiredRecord = ({ operationId, runtime, tool, request, req, createdAt, targetBookingId }) => ({
  operationId,
  idempotencyKey: runtime.idempotencyKey,
  actionHash: bookingActionHash(tool, request),
  tool,
  outcome: 'auth_required',
  bookingId: String(targetBookingId),
  nextVersion: request.expectedVersion,
  outcomes: [],
  request: sanitize(request),
  requestId: req.requestId,
  inputRequest: {
    type: 'external_session',
    message: 'Open the booking system session, then continue this operation.',
    expiresAt: new Date(Date.now() + continuationTtlMs).toISOString(),
  },
  createdAt,
});

const failedRecord = ({ operationId, runtime, tool, request, req, createdAt, targetBookingId, error }) => ({
  operationId,
  idempotencyKey: runtime.idempotencyKey,
  actionHash: bookingActionHash(tool, request),
  tool,
  outcome: 'failed',
  bookingId: String(targetBookingId),
  nextVersion: request.expectedVersion,
  outcomes: [],
  changes: [],
  request: sanitize(request),
  requestId: req.requestId,
  createdAt,
  completedAt: new Date().toISOString(),
  error: safeErrorText(error),
});

const executeWrite = async ({
  app,
  token,
  req,
  tool,
  request,
  runtime,
  operationId = uuidv4(),
  createdAt = new Date().toISOString(),
}) => {
  const pluginMethod = toolMethods[tool];
  if (!app[pluginMethod] || !app.getBooking) {
    const unsupported = {
      operationId,
      idempotencyKey: runtime.idempotencyKey,
      tool,
      actionHash: bookingActionHash(tool, request),
      outcome: 'unsupported',
      outcomes: [],
      requestId: req.requestId,
      createdAt,
      completedAt: new Date().toISOString(),
      error: `${tool} is not supported by this integration`,
      request: sanitize(request),
    };
    await saveOperation({ ...req.params, record: unsupported });
    return unsupported;
  }
  const expectedVersion = String(request.expectedVersion || '').trim();
  assert(expectedVersion, 'expectedVersion is required for booking writes');
  const targetBookingId = request.bookingId || request.sourceBookingId;
  assert(targetBookingId, 'bookingId or sourceBookingId is required for booking writes');
  let before;
  try {
    before = await readFreshBooking({
      app,
      token,
      req,
      bookingId: targetBookingId,
      credentials: runtime.credentials,
    });
  } catch (error) {
    if (!isAuthError(error)) {
      const failed = failedRecord({
        operationId,
        runtime,
        tool,
        request,
        req,
        createdAt,
        targetBookingId,
        error,
      });
      await saveOperation({ ...req.params, record: failed });
      return failed;
    }
    const pending = authRequiredRecord({
      operationId,
      runtime,
      tool,
      request,
      req,
      createdAt,
      targetBookingId,
    });
    await saveOperation({ ...req.params, record: pending });
    return pending;
  }
  const actualVersion = String(before && before.version ? before.version : '');
  if (actualVersion !== expectedVersion) {
    const conflict = {
      operationId,
      idempotencyKey: runtime.idempotencyKey,
      tool,
      actionHash: bookingActionHash(tool, request),
      outcome: 'conflict',
      bookingId: String(targetBookingId),
      nextVersion: actualVersion || undefined,
      outcomes: [],
      requestId: req.requestId,
      createdAt,
      completedAt: new Date().toISOString(),
      error: 'The booking changed after it was read. Read it again before retrying.',
      request: sanitize(request),
    };
    await saveOperation({ ...req.params, record: conflict });
    return conflict;
  }

  try {
    const result = await callPlugin({
      app,
      token,
      pluginMethod,
      req,
      payload: {
        ...request,
        currentBooking: before,
        ...(runtime.credentials && { credentials: runtime.credentials }),
      },
    });
    const bookingId = bookingIdFrom(tool, request, result || {});
    let booking;
    let bookingReadError;
    try {
      booking = await readFreshBooking({
        app,
        token,
        req,
        bookingId,
        credentials: runtime.credentials,
      });
    } catch (error) {
      bookingReadError = safeErrorText(error);
    }
    const record = {
      operationId,
      idempotencyKey: runtime.idempotencyKey,
      actionHash: bookingActionHash(tool, request),
      tool,
      outcome: booking || !bookingId ? (result.outcome || 'completed') : 'partial',
      bookingId: bookingId ? String(bookingId) : undefined,
      bookingReference: result.bookingReference || (booking && booking.bookingReference),
      nextVersion: booking && booking.version,
      outcomes: [
        ...(result.outcomes || []),
        ...(!booking && bookingId ? [{
          outcome: 'failed',
          targetId: String(bookingId),
          error: bookingReadError || 'The write completed, but the fresh booking read failed.',
        }] : []),
      ],
      changes: sanitize(result.changes || []),
      request: sanitize(request),
      requestId: req.requestId,
      createdAt,
      completedAt: new Date().toISOString(),
    };
    await saveOperation({ ...req.params, record });
    return { ...record, booking };
  } catch (error) {
    if (!isAuthError(error)) {
      const failed = failedRecord({
        operationId,
        runtime,
        tool,
        request,
        req,
        createdAt,
        targetBookingId,
        error,
      });
      await saveOperation({ ...req.params, record: failed });
      return failed;
    }
    const pending = authRequiredRecord({
      operationId,
      runtime,
      tool,
      request,
      req,
      createdAt,
      targetBookingId,
    });
    await saveOperation({ ...req.params, record: pending });
    return pending;
  }
};

const continueOperation = async ({ app, token, req, request, runtime }) => {
  assert(request.operationId, 'operationId is required');
  const pending = await loadOperation({ ...req.params, operationId: request.operationId });
  assert(pending, 'Booking operation was not found or has expired');
  if (pending.outcome !== 'auth_required') return pending;
  const lockValue = uuidv4();
  const lockKey = `bookingOperationContinuationLock:${hash({
    userId: req.params.userId,
    hint: req.params.hint || '',
    operationId: pending.operationId,
  })}`;
  const lockAcquired = await cache.saveIfNotExists({
    pluginName: req.params.appKey,
    key: lockKey,
    value: lockValue,
    ttl: 60,
  });
  if (!lockAcquired) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const settled = await loadOperation({ ...req.params, operationId: request.operationId });
      if (settled && settled.outcome !== 'auth_required') return settled;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(false, 'This booking operation is already being continued');
  }
  try {
    const latest = await loadOperation({ ...req.params, operationId: request.operationId });
    if (latest.outcome !== 'auth_required') return latest;
    const expiresAt = Date.parse(latest.inputRequest && latest.inputRequest.expiresAt);
    if (!expiresAt || expiresAt <= Date.now()) {
      const expired = {
        ...latest,
        outcome: 'failed',
        error: 'Booking operation authorization expired',
        completedAt: new Date().toISOString(),
      };
      await saveOperation({ ...req.params, record: expired });
      return expired;
    }
    return executeWrite({
      app,
      token,
      req,
      tool: latest.tool,
      request: latest.request,
      runtime: {
        ...runtime,
        idempotencyKey: latest.idempotencyKey,
      },
      operationId: latest.operationId,
      createdAt: latest.createdAt,
    });
  } finally {
    await cache.dropIfValue({
      pluginName: req.params.appKey,
      key: lockKey,
      value: lockValue,
    });
  }
};

const bookingTool = plugins => async (req, res, next) => {
  const { appKey, userId, hint, tool } = req.params;
  try {
    const { app, token } = await getAppAndToken({ plugins, appKey, userId, hint });
    const request = req.body.request || {};
    const runtime = req.body.runtime || {};
    assertGenericRequest(tool, request);

    if (tool === 'get_booking_operation') {
      assert(request.operationId, 'operationId is required');
      const record = await loadOperation({ appKey, userId, hint, operationId: request.operationId });
      assert(record, 'Booking operation was not found or has expired');
      return res.json(operationResponse(record));
    }
    if (tool === 'continue_booking_operation') {
      const record = await continueOperation({ app, token, req, request, runtime });
      return res.json(operationResponse(record));
    }

    const pluginMethod = toolMethods[tool];
    assert(pluginMethod, `Unknown booking tool: ${tool}`);
    if (!app[pluginMethod] || (writeTools.has(tool) && !app.getBooking)) {
      return res.json({
        tool,
        outcome: 'unsupported',
        outcomes: [],
        error: `${tool} is not supported by this integration`,
      });
    }
    if (!writeTools.has(tool)) {
      try {
        const result = await callPlugin({
          app,
          token,
          pluginMethod,
          req,
          payload: {
            ...request,
            ...(runtime.credentials && { credentials: runtime.credentials }),
          },
        });
        return res.json(result);
      } catch (error) {
        if (isAuthError(error)) {
          return res.json({
            tool,
            outcome: 'auth_required',
            inputRequest: {
              type: 'external_session',
              message: 'Open the booking system session, then try again.',
            },
          });
        }
        return res.json({
          tool,
          outcome: 'failed',
          error: safeErrorText(error),
        });
      }
    }

    assert(runtime.idempotencyKey, 'runtime.idempotencyKey is required for booking writes');
    const replay = await getIdempotentOperation({
      appKey,
      userId,
      hint,
      key: runtime.idempotencyKey,
    });
    if (replay) {
      assert.strictEqual(
        replay.actionHash,
        bookingActionHash(tool, request),
        'runtime.idempotencyKey was already used for a different booking action',
      );
      const hydrated = await hydrateReplay({
        replay,
        app,
        token,
        req,
        credentials: runtime.credentials,
      });
      return res.json(operationResponse(hydrated));
    }
    const operationId = uuidv4();
    const lockKey = idempotencyLockKey({ userId, hint, key: runtime.idempotencyKey });
    const lockAcquired = await cache.saveIfNotExists({
      pluginName: appKey,
      key: lockKey,
      value: operationId,
      ttl: 60,
    });
    if (!lockAcquired) {
      const pendingReplay = await waitForIdempotentOperation({
        appKey,
        userId,
        hint,
        key: runtime.idempotencyKey,
      });
      assert(pendingReplay, 'An identical booking operation is still being processed');
      const hydrated = await hydrateReplay({
        replay: pendingReplay,
        app,
        token,
        req,
        credentials: runtime.credentials,
      });
      return res.json(operationResponse(hydrated));
    }
    try {
      const record = await executeWrite({
        app,
        token,
        req,
        tool,
        request,
        runtime,
        operationId,
      });
      return res.json(operationResponse(record));
    } finally {
      await cache.dropIfValue({
        pluginName: appKey,
        key: lockKey,
        value: operationId,
      });
    }
  } catch (error) {
    if (error && error.code === 'ERR_ASSERTION') {
      return res.status(400).json({ error: errorText(error) });
    }
    return next(error);
  }
};

module.exports = plugins => ({
  bookingTool: bookingTool(plugins),
});

module.exports.sanitize = sanitize;
