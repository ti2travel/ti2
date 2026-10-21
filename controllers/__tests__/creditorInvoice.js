jest.mock('../../models', () => ({ UserAppKey: { findOne: jest.fn() } }));

const { UserAppKey } = require('../../models');
const controller = require('../creditorInvoice');

const integration = { token: { url: 'https://nx.example.test' } };

const response = () => {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(),
  };
  return res;
};

const request = (body = { invoice: { invoiceRef: 'INV-1' }, writeId: 'chat-1' }) => ({
  params: { userId: 'company', hint: 'desk' },
  body,
});

beforeEach(() => {
  UserAppKey.findOne.mockReset();
});

test('posts through the configured Tourplan NX integration', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const plugin = {
    name: 'tourplannx',
    axios: jest.fn(),
    createCreditorInvoice: jest.fn(async () => ({ status: 'posted', transactionId: 123 })),
  };
  const req = request();
  const res = response();
  await controller([plugin]).createCreditorInvoice(req, res, jest.fn());
  expect(UserAppKey.findOne).toHaveBeenCalledWith({
    where: { userId: 'company', integrationId: 'tourplannx', hint: 'desk' },
  });
  expect(plugin.createCreditorInvoice).toHaveBeenCalledWith({
    axios: expect.any(Function),
    token: { url: 'https://nx.example.test' },
    userId: 'company',
    hint: 'desk',
    payload: req.body,
  });
  expect(res.json).toHaveBeenCalledWith({ status: 'posted', transactionId: 123 });
});

test('checks invoice status through the configured Tourplan NX integration', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const plugin = {
    name: 'tourplannx',
    axios: jest.fn(),
    checkCreditorInvoice: jest.fn(async () => ({ status: 'present' })),
  };
  const res = response();
  await controller([plugin]).checkCreditorInvoice(request(), res, jest.fn());
  expect(plugin.checkCreditorInvoice).toHaveBeenCalledWith(expect.objectContaining({
    axios: expect.any(Function),
    token: { url: 'https://nx.example.test' },
    payload: { invoice: { invoiceRef: 'INV-1' }, writeId: 'chat-1' },
  }));
  expect(res.json).toHaveBeenCalledWith({ status: 'present' });
});

test('bounds each Tourplan call without changing the shared client', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const plugin = {
    name: 'tourplannx',
    axios: jest.fn(async config => config),
    createCreditorInvoice: jest.fn(async ({ axios }) => axios({ url: '/Accounting' })),
  };
  const previous = process.env.TOURPLAN_REQUEST_TIMEOUT_MS;
  process.env.TOURPLAN_REQUEST_TIMEOUT_MS = '15000';
  try {
    await controller([plugin]).createCreditorInvoice(request(), response(), jest.fn());
    expect(plugin.axios).toHaveBeenCalledWith({ url: '/Accounting', timeout: 15000 });
  } finally {
    if (previous === undefined) delete process.env.TOURPLAN_REQUEST_TIMEOUT_MS;
    else process.env.TOURPLAN_REQUEST_TIMEOUT_MS = previous;
  }
});

test('uses a 120 second Tourplan timeout when none is configured', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const plugin = {
    name: 'tourplannx',
    axios: jest.fn(async config => config),
    checkCreditorInvoice: jest.fn(async ({ axios }) => axios({ url: '/Accounting' })),
  };
  const previous = process.env.TOURPLAN_REQUEST_TIMEOUT_MS;
  delete process.env.TOURPLAN_REQUEST_TIMEOUT_MS;
  try {
    await controller([plugin]).checkCreditorInvoice(request(), response(), jest.fn());
    expect(plugin.axios).toHaveBeenCalledWith({ url: '/Accounting', timeout: 120000 });
  } finally {
    if (previous === undefined) delete process.env.TOURPLAN_REQUEST_TIMEOUT_MS;
    else process.env.TOURPLAN_REQUEST_TIMEOUT_MS = previous;
  }
});

test('drops job and callback fields before calling the plugin', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const plugin = {
    name: 'tourplannx',
    axios: jest.fn(),
    createCreditorInvoice: jest.fn(async () => ({ status: 'posted' })),
  };
  const res = response();
  await controller([plugin]).createCreditorInvoice(request({
    invoice: { lines: [{}] },
    credentials: { cookies: [{ value: 'secret' }] },
    backgroundJob: true,
    callbackUrl: 'https://example.test/hook',
    writeId: 'chat-1',
  }), res, jest.fn());
  expect(plugin.createCreditorInvoice).toHaveBeenCalledWith(expect.objectContaining({
    payload: {
      invoice: { lines: [{}] },
      credentials: { cookies: [{ value: 'secret' }] },
      writeId: 'chat-1',
    },
  }));
});

test('returns 404 when the Tourplan NX integration is missing', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(null);
  const plugin = { name: 'tourplannx', createCreditorInvoice: jest.fn() };
  const res = response();
  await controller([plugin]).createCreditorInvoice(request(), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ message: 'Tourplan NX integration not found' });
  expect(plugin.createCreditorInvoice).not.toHaveBeenCalled();
});

test('returns 501 when invoice posting is unavailable', async () => {
  const res = response();
  await controller([]).createCreditorInvoice(request(), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(501);
  expect(res.json).toHaveBeenCalledWith({ message: 'Tourplan NX invoice posting is unavailable' });
  expect(UserAppKey.findOne).not.toHaveBeenCalled();
});

test('returns 501 when invoice status is unavailable', async () => {
  const res = response();
  await controller([{ name: 'tourplannx' }]).checkCreditorInvoice(request(), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(501);
  expect(res.json).toHaveBeenCalledWith({ message: 'Tourplan NX invoice status is unavailable' });
});

test('passes a plugin failure through without the invoice body', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const failure = new Error('bad token');
  failure.code = 'CORRUPTED_TOKEN';
  const plugin = {
    name: 'tourplannx',
    createCreditorInvoice: jest.fn(async () => { throw failure; }),
  };
  const next = jest.fn();
  await controller([plugin]).createCreditorInvoice(request(), response(), next);
  expect(next).toHaveBeenCalledWith(failure);
});

test('keeps the upstream status and drops the posted credentials', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const failure = new Error('Request failed with status code 409');
  failure.isAxiosError = true;
  failure.response = {
    status: 409,
    data: { errorMessage: 'Duplicate invoice', echoedCookie: 'secret' },
  };
  failure.config = { data: JSON.stringify({ credentials: { cookies: [{ value: 'secret' }] } }) };
  const plugin = {
    name: 'tourplannx',
    createCreditorInvoice: jest.fn(async () => { throw failure; }),
  };
  const next = jest.fn();
  await controller([plugin]).createCreditorInvoice(request(), response(), next);
  const [error] = next.mock.calls[0];
  expect(error).not.toBe(failure);
  expect(error.status).toBe(409);
  expect(error.message).toBe('Duplicate invoice');
  expect(error.config).toBeUndefined();
  expect(error.response).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain('secret');
});

test('reports a Tourplan connection failure without the posted credentials', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const failure = new Error('connect ECONNREFUSED');
  failure.isAxiosError = true;
  failure.code = 'ECONNREFUSED';
  failure.config = { data: 'secret' };
  const plugin = {
    name: 'tourplannx',
    checkCreditorInvoice: jest.fn(async () => { throw failure; }),
  };
  const next = jest.fn();
  await controller([plugin]).checkCreditorInvoice(request(), response(), next);
  const [error] = next.mock.calls[0];
  expect(error.status).toBe(502);
  expect(error.message).toBe('Tourplan NX invoice request failed');
  expect(JSON.stringify(error)).not.toContain('secret');
});

test('reports a Tourplan timeout without the posted credentials', async () => {
  UserAppKey.findOne.mockResolvedValueOnce(integration);
  const failure = new Error('timeout of 1000ms exceeded');
  failure.isAxiosError = true;
  failure.code = 'ECONNABORTED';
  failure.config = { data: 'secret' };
  const plugin = {
    name: 'tourplannx',
    createCreditorInvoice: jest.fn(async () => { throw failure; }),
  };
  const next = jest.fn();
  await controller([plugin]).createCreditorInvoice(request(), response(), next);
  const [error] = next.mock.calls[0];
  expect(error.status).toBe(504);
  expect(JSON.stringify(error)).not.toContain('secret');
});
