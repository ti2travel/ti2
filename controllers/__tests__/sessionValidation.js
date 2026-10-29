/* globals beforeAll beforeEach describe it expect jest */
const chance = require('chance').Chance();
const MockAdapter = require('axios-mock-adapter');
const request = require('supertest');

describe('session validation with inline credentials', () => {
  const testUtils = require('../../test/utils');
  const appKey = 'sessionvalidation';
  const userId = `test-user-${chance.guid()}`;
  const hint = 'first-desk';
  const token = { endpoint: 'https://booking.example.test', apiKey: chance.guid() };
  const credentials = { cookies: [{ name: 'session', value: 'private-session-value' }] };
  const payload = { tokenHint: hint, credentials, sessionRequired: true };
  const route = `/${appKey}/${userId}/validate`;
  let app;
  let plugins;
  let userToken;
  let createUserToken;
  let doApiPost;

  beforeAll(async () => {
    ({ app, plugins, createUserToken, doApiPost } = await testUtils({ plugins: [appKey] }));
    userToken = createUserToken(userId);
    await doApiPost({ url: '/user', token: process.env.adminKey, payload: { userId } });
    await doApiPost({
      url: `/${appKey}/${userId}`, token: userToken, payload: { tokenHint: hint, token },
    });
  });

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['credentials', { tokenHint: hint, credentials }],
    ['session required', { tokenHint: hint, sessionRequired: true }],
    ['both', payload],
  ])('forwards %s synchronously without retaining the body', async (_name, body) => {
    const events = [];
    const onEvent = (...args) => events.push(args);
    plugins[0].events.onAny(onEvent);
    try {
      const response = await request(app).post(route).set('Authorization', `Bearer ${userToken}`)
        .send({ ...body, backgroundJob: true, callbackUrl: 'https://example.test/callback' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: true });
      const call = plugins[0].validateToken.mock.calls[0][0];
      expect(call.payload).toEqual({ ...body, backgroundJob: true, callbackUrl: 'https://example.test/callback' });
      expect(call.token).toEqual(token);
      expect(call.userId).toBe(userId);
      expect(call.hint).toBe(hint);
      const requestEvents = events.filter(([name]) => ['request.start', 'request.end'].includes(name));
      expect(requestEvents.map(([name]) => name)).toEqual(['request.start', 'request.end']);
      requestEvents.forEach(([, event]) => expect(event.body).toEqual({ hasCredentials: Boolean(body.credentials) }));
      expect(JSON.stringify(events)).not.toContain('private-session-value');
      expect(JSON.stringify(events)).not.toContain('example.test/callback');
    } finally {
      plugins[0].events.offAny(onEvent);
    }
  });

  it('protects trailing slash requests', async () => {
    const response = await request(app).post(`${route}/`).set('Authorization', `Bearer ${userToken}`)
      .send({ ...payload, backgroundJob: true, callbackUrl: 'https://example.test/callback' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ valid: true });
    expect(plugins[0].validateToken).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'other-user'])('rejects %s authorization', async caller => {
    const req = request(app).post(route);
    if (caller === 'other-user') req.set('Authorization', `Bearer ${createUserToken('another-user')}`);
    const response = await req.send(payload);
    expect(response.status).toBe(401);
    expect(plugins[0].validateToken).not.toHaveBeenCalled();
  });

  it('selects the exact hinted integration', async () => {
    const otherToken = { ...token, endpoint: 'https://other.example.test' };
    await doApiPost({
      url: `/${appKey}/${userId}`, token: userToken,
      payload: { tokenHint: 'other-desk', token: otherToken },
    });
    const response = await request(app).post(route).set('Authorization', `Bearer ${userToken}`)
      .send({ ...payload, tokenHint: 'other-desk' });
    expect(response.status).toBe(200);
    const call = plugins[0].validateToken.mock.calls[0][0];
    expect(call.token).toEqual(otherToken);
    expect(call.hint).toBe('other-desk');
  });

  it('validates each current session without reusing middleware cache', async () => {
    const previousCacheSettings = plugins[0].cacheSettings;
    plugins[0].cacheSettings = { validateAppToken: { cacheInMiddleware: true } };
    plugins[0].validateToken.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const updatedCredentials = { cookies: [{ name: 'session', value: 'updated-session-value' }] };
    try {
      const first = await request(app).post(route).set('Authorization', `Bearer ${userToken}`).send(payload);
      const second = await request(app).post(route).set('Authorization', `Bearer ${userToken}`)
        .send({ ...payload, credentials: updatedCredentials });
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ valid: true });
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ valid: false });
      expect(plugins[0].validateToken.mock.calls.map(([call]) => call.payload.credentials))
        .toEqual([credentials, updatedCredentials]);
    } finally {
      plugins[0].cacheSettings = previousCacheSettings;
    }
  });

  it.each(['success', 'network', 'timeout', 'unauthorized'])(
    'keeps cookies out of events, debug logs and errors on %s', async outcome => {
      const plugin = plugins[0];
      const events = [];
      const onEvent = (...args) => events.push(args);
      const logs = ['error', 'log', 'debug'].map(method => jest.spyOn(console, method).mockImplementation(() => {}));
      const previousDebug = process.env.debug;
      process.env.debug = 'true';
      plugin.events.onAny(onEvent);
      let outbound;
      plugin.validateToken.mockImplementationOnce(async ({ axios: client, payload: body }) => {
        const mock = new MockAdapter(client);
        const url = 'https://booking.example.test/session';
        if (outcome === 'network') mock.onGet(url).networkError();
        else if (outcome === 'timeout') mock.onGet(url).timeout();
        else mock.onGet(url).reply(outcome === 'unauthorized' ? 401 : 200, { valid: true });
        try {
          const response = await client.get(url, {
            headers: { Cookie: `session=${body.credentials.cookies[0].value}` },
          });
          return response.data.valid;
        } finally {
          [outbound] = mock.history.get;
          mock.restore();
        }
      });
      try {
        const response = await request(app).post(route).set('Authorization', `Bearer ${userToken}`).send(payload);
        expect(response.status).toBe({ success: 200, network: 502, timeout: 504, unauthorized: 401 }[outcome]);
        expect(response.body).toEqual(outcome === 'success'
          ? { valid: true } : { message: 'Session validation request failed' });
        expect(outbound.headers.Cookie).toBe('session=private-session-value');
        expect(outbound.headers.requestId).toBeTruthy();
        expect(JSON.stringify(response.body)).not.toContain('private-session-value');
        expect(JSON.stringify(events)).not.toContain('private-session-value');
        logs.forEach(log => expect(JSON.stringify(log.mock.calls)).not.toContain('private-session-value'));
      } finally {
        plugin.events.offAny(onEvent);
        logs.forEach(log => log.mockRestore());
        if (previousDebug === undefined) delete process.env.debug;
        else process.env.debug = previousDebug;
      }
    },
  );

  it.each([
    ['https://allowed.example.test/session', false],
    ['https://other.example.test/session', undefined],
  ])('preserves SSL policy, timeout and request ID for %s', async (url, rejectUnauthorized) => {
    const previousDomains = process.env.SSL_INSECURE_ALLOWED_DOMAINS;
    const previousTimeout = plugins[0].axios.defaults.timeout;
    process.env.SSL_INSECURE_ALLOWED_DOMAINS = 'allowed.example.test';
    plugins[0].axios.defaults.timeout = 4321;
    let outbound;
    plugins[0].validateToken.mockImplementationOnce(async ({ axios: client }) => {
      const response = await client.get(url, {
        adapter: async config => {
          outbound = config;
          return { status: 200, data: { valid: true }, headers: {}, config };
        },
      });
      return response.data.valid;
    });
    try {
      const response = await request(app).post(route).set('Authorization', `Bearer ${userToken}`).send(payload);
      expect(response.status).toBe(200);
      expect(outbound.timeout).toBe(4321);
      expect(outbound.headers.requestId).toBeTruthy();
      expect(outbound.httpsAgent && outbound.httpsAgent.options.rejectUnauthorized).toBe(rejectUnauthorized);
      expect(plugins[0].axios.defaults.headers.requestId).toBeUndefined();
    } finally {
      plugins[0].axios.defaults.timeout = previousTimeout;
      if (previousDomains === undefined) delete process.env.SSL_INSECURE_ALLOWED_DOMAINS;
      else process.env.SSL_INSECURE_ALLOWED_DOMAINS = previousDomains;
    }
  });

  it('preserves a plugin session-required error', async () => {
    const error = new Error('External session required');
    error.status = 428;
    plugins[0].validateToken.mockRejectedValueOnce(error);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app).post(route).set('Authorization', `Bearer ${userToken}`).send(payload);
      expect(response.status).toBe(428);
      expect(response.body).toEqual({ message: 'External session required' });
    } finally {
      log.mockRestore();
    }
  });

  it.each([{}, { tokenHint: hint }, { tokenHint: hint, sessionRequired: false }])(
    'preserves legacy token-only validation for %j', async body => {
      const events = [];
      const onEvent = (...args) => events.push(args);
      plugins[0].events.onAny(onEvent);
      try {
        const response = await request(app).post(route).set('Authorization', `Bearer ${userToken}`).send(body);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ valid: true });
        const call = plugins[0].validateToken.mock.calls[0][0];
        expect(call.payload).toEqual(body);
        expect(call.hint).toBe(body.tokenHint);
        expect(call.axios.interceptors.request.handlers.length).toBeGreaterThan(0);
        expect(events.find(([name]) => name === 'request.end')[1].body).toEqual(body);
      } finally {
        plugins[0].events.offAny(onEvent);
      }
    },
  );
});
