/* globals beforeAll beforeEach describe it expect jest */
const chance = require('chance').Chance();
const MockAdapter = require('axios-mock-adapter');
const request = require('supertest');

describe('affiliate agents with inline credentials', () => {
  const testUtils = require('../../test/utils');
  const appKey = 'agentlookup';
  const userId = `test-user-${chance.guid()}`;
  const hint = 'first-desk';
  const token = { endpoint: 'https://booking.example.test', apiKey: chance.guid() };
  const credentials = { cookies: [{ name: 'session', value: 'private-session-value' }] };
  const payload = { credentials, search: 'private-search-value' };
  let app;
  let plugins;
  let userToken;
  let createUserToken;
  let doApiPost;

  beforeAll(async () => {
    ({ app, plugins, createUserToken, doApiPost } = await testUtils({ plugins: [appKey] }));
    userToken = createUserToken(userId);
    await doApiPost({
      url: '/user', token: process.env.adminKey, payload: { userId },
    });
    await doApiPost({
      url: `/${appKey}/${userId}`, token: userToken, payload: { tokenHint: hint, token },
    });
  });

  beforeEach(() => jest.clearAllMocks());

  describe.each([false, true])('with a token hint: %s', withHint => {
    const route = () => `/affiliate/${appKey}/${userId}/${withHint ? `${hint}/` : ''}agents`;

    it('forwards body metadata and credentials to the configured instance', async () => {
      const events = [];
      const onEvent = (...args) => events.push(args);
      plugins[0].events.onAny(onEvent);
      try {
        const response = await request(app).post(`${route()}?search=ignored-query`)
          .set('Authorization', `Bearer ${userToken}`).send(payload);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ agents: [] });
        const call = plugins[0].getAffiliateAgents.mock.calls[0][0];
        expect(call.payload).toEqual(payload);
        expect(call.token).toEqual(token);
        expect(call.userId).toBe(userId);
        expect(call.hint).toBe(withHint ? hint : undefined);
        const requestEvents = events.filter(([name]) => ['request.start', 'request.end'].includes(name));
        expect(requestEvents.map(([name]) => name)).toEqual(['request.start', 'request.end']);
        requestEvents.forEach(([, event]) => expect(event.body).toEqual({ hasCredentials: true }));
        expect(JSON.stringify(events)).not.toContain('private-session-value');
        expect(JSON.stringify(events)).not.toContain('private-search-value');
      } finally {
        plugins[0].events.offAny(onEvent);
      }
    });

    it.each(['missing', 'other-user'])('rejects %s authorization', async caller => {
      const req = request(app).post(route());
      if (caller === 'other-user') req.set('Authorization', `Bearer ${createUserToken('another-user')}`);
      const response = await req.send(payload);
      expect(response.status).toBe(401);
      expect(plugins[0].getAffiliateAgents).not.toHaveBeenCalled();
    });

    it.each(['', '/'])('keeps requests synchronous with a trailing slash of %s', async trailingSlash => {
      const events = [];
      const onEvent = (...args) => events.push(args);
      plugins[0].events.onAny(onEvent);
      try {
        const response = await request(app).post(`${route()}${trailingSlash}`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ ...payload, backgroundJob: true, callbackUrl: 'https://example.test/callback' });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ agents: [] });
        expect(plugins[0].getAffiliateAgents).toHaveBeenCalledTimes(1);
        const endEvents = events.filter(([name]) => name === 'request.end');
        expect(endEvents).toHaveLength(1);
        expect(endEvents[0][1].body).toEqual({ hasCredentials: true });
        expect(JSON.stringify(events)).not.toContain('private-session-value');
      } finally {
        plugins[0].events.offAny(onEvent);
      }
    });

    it('preserves the existing GET payload and request client', async () => {
      const response = await request(app).get(route())
        .set('Authorization', `Bearer ${userToken}`).send({ search: 'legacy-search' });
      expect(response.status).toBe(200);
      const call = plugins[0].getAffiliateAgents.mock.calls[0][0];
      expect(call.payload).toEqual({ search: 'legacy-search' });
      expect(call.token).toEqual(token);
      expect(call.axios.interceptors.request.handlers.length).toBeGreaterThan(0);
    });
  });

  it('selects the exact hinted instance', async () => {
    const otherToken = { ...token, endpoint: 'https://other.example.test' };
    await doApiPost({
      url: `/${appKey}/${userId}`, token: userToken,
      payload: { tokenHint: 'other-desk', token: otherToken },
    });
    const response = await request(app).post(`/affiliate/${appKey}/${userId}/other-desk/agents`)
      .set('Authorization', `Bearer ${userToken}`).send(payload);
    expect(response.status).toBe(200);
    const call = plugins[0].getAffiliateAgents.mock.calls[0][0];
    expect(call.token).toEqual(otherToken);
    expect(call.hint).toBe('other-desk');
  });

  it('executes each POST with its current credentials instead of returning a cached list', async () => {
    const route = `/affiliate/${appKey}/${userId}/${hint}/agents`;
    plugins[0].getAffiliateAgents
      .mockResolvedValueOnce({ agents: [{ id: 'first-agent' }] })
      .mockResolvedValueOnce({ agents: [{ id: 'second-agent' }] });
    const first = await request(app).post(route)
      .set('Authorization', `Bearer ${userToken}`).send(payload);
    const secondCredentials = { cookies: [{ name: 'session', value: 'updated-session-value' }] };
    const second = await request(app).post(route)
      .set('Authorization', `Bearer ${userToken}`).send({ ...payload, credentials: secondCredentials });
    expect(first.status).toBe(200);
    expect(first.body.agents).toEqual([{ id: 'first-agent' }]);
    expect(second.status).toBe(200);
    expect(second.body.agents).toEqual([{ id: 'second-agent' }]);
    expect(plugins[0].getAffiliateAgents.mock.calls.map(([call]) => call.payload.credentials))
      .toEqual([credentials, secondCredentials]);
  });

  it.each(['success', 'network', 'timeout', 'unauthorized'])(
    'keeps outbound cookies out of events and diagnostics on %s', async outcome => {
      const plugin = plugins[0];
      const events = [];
      const onEvent = (...args) => events.push(args);
      const logs = ['error', 'log', 'debug'].map(method => jest.spyOn(console, method).mockImplementation(() => {}));
      const previousDebug = process.env.debug;
      process.env.debug = 'true';
      plugin.events.onAny(onEvent);
      let outbound;
      plugin.getAffiliateAgents.mockImplementationOnce(async ({ axios: client, payload: body }) => {
        const mock = new MockAdapter(client);
        const url = 'https://booking.example.test/agents';
        if (outcome === 'network') mock.onPost(url).networkError();
        else if (outcome === 'timeout') mock.onPost(url).timeout();
        else mock.onPost(url).reply(outcome === 'unauthorized' ? 401 : 200, { agents: [] });
        try {
          const response = await client.post(url, {}, {
            headers: { Cookie: `session=${body.credentials.cookies[0].value}` },
          });
          return response.data;
        } finally {
          [outbound] = mock.history.post;
          mock.restore();
        }
      });
      try {
        const response = await request(app).post(`/affiliate/${appKey}/${userId}/${hint}/agents`)
          .set('Authorization', `Bearer ${userToken}`).send(payload);
        expect(response.status).toBe({ success: 200, network: 502, timeout: 504, unauthorized: 401 }[outcome]);
        expect(response.body).toEqual(outcome === 'success'
          ? { agents: [] } : { message: 'Agent request failed' });
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
    ['https://allowed.example.test/agents', false],
    ['https://other.example.test/agents', undefined],
  ])('preserves SSL policy, timeout and request ID for %s', async (url, rejectUnauthorized) => {
    const previousDomains = process.env.SSL_INSECURE_ALLOWED_DOMAINS;
    const previousTimeout = plugins[0].axios.defaults.timeout;
    process.env.SSL_INSECURE_ALLOWED_DOMAINS = 'allowed.example.test';
    plugins[0].axios.defaults.timeout = 4321;
    let outbound;
    plugins[0].getAffiliateAgents.mockImplementationOnce(async ({ axios: client }) => {
      const response = await client.get(url, {
        adapter: async config => {
          outbound = config;
          return { status: 200, data: { agents: [] }, headers: {}, config };
        },
      });
      return response.data;
    });
    try {
      const response = await request(app).post(`/affiliate/${appKey}/${userId}/${hint}/agents`)
        .set('Authorization', `Bearer ${userToken}`).send(payload);
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
    plugins[0].getAffiliateAgents.mockRejectedValueOnce(error);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app).post(`/affiliate/${appKey}/${userId}/${hint}/agents`)
        .set('Authorization', `Bearer ${userToken}`).send(payload);
      expect(response.status).toBe(428);
      expect(response.body).toEqual({ message: 'External session required' });
    } finally {
      log.mockRestore();
    }
  });
});
