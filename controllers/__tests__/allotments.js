/* globals beforeAll beforeEach describe it expect jest */
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const chance = require('chance').Chance();
const request = require('supertest');

const { env: { adminKey } } = process;

describe('allotment', () => {
  const testUtils = require('../../test/utils');
  const newApp = {
    name: 'tourplantest',
    packageName: 'ti2-tourplanTest',
    adminEmail: 'engineering+tourplantest@tourconnect.com',
  };
  const appKey = newApp.name;
  // Generate a random userId for better test isolation
  const userId = `test-user-${chance.guid()}`;
  const token = {
    endpoint: 'https://someendpoint.com',
    username: chance.guid(),
    password: chance.string(),
  };
  const newIntegration = {
    tokenHint: 'testingToken',
    token,
  };
  let doApiGet;
  let doApiPost;
  let plugins;
  let userToken;
  let app;
  let createUserToken;
  beforeEach(() => {
    jest.clearAllMocks();
  });
  beforeAll(async () => {
    ({
      doApiGet,
      doApiPost,
      plugins,
      app,
      createUserToken,
    } = await testUtils({
      plugins: [appKey],
    }));

    // Using random user IDs, so no need to drop existing integrations
    // create the user - handle case where random user doesn't exist yet
    ({ value: userToken } = await doApiPost({
      url: '/user',
      token: adminKey,
      payload: { userId },
    }));
    expect(userToken).toBeTruthy();

    // create the App+User relation
    const { value } = await doApiPost({
      url: `/${appKey}/${userId}`,
      token: userToken,
      payload: newIntegration,
    });
    expect(value).toBeTruthy();
  });
  const payload = {
    dateFormat: 'DD-MM-YYYY',
    startDate: '01-12-2022',
    endDate: '15-12-2022',
    keyPath: `${chance.guid()}|${chance.guid()}`,
  };
  const urlParams = new URLSearchParams(payload).toString();
  it('should be able to get some allotments', async () => {
    const { allotments } = await doApiGet({
      url: `/allotment/${appKey}/${userId}?${urlParams}`,
      token: userToken,
      payload,
    });
    expect(plugins[0].queryAllotment).toHaveBeenCalled();
    expect(Array.isArray(allotments)).toBeTruthy();
    const call = plugins[0].queryAllotment.mock.calls[0][0];
    expect(call.payload).toEqual(payload);
    expect(call.token).toEqual(token);
    expect(call.userId).toEqual(userId);
    expect(call.hint).toBeUndefined();
  });
  it('should be able to get some allotments with a hint', async () => {
    const { allotments } = await doApiGet({
      url: `/allotment/${appKey}/${newIntegration.tokenHint}/${userId}?${urlParams}`,
      token: userToken,
      payload,
    });
    expect(plugins[0].queryAllotment).toHaveBeenCalled();
    expect(Array.isArray(allotments)).toBeTruthy();
    const call = plugins[0].queryAllotment.mock.calls[0][0];
    expect(call.payload).toEqual(payload);
    expect(call.token).toEqual(token);
    expect(call.userId).toEqual(userId);
    expect(call.hint).toEqual(newIntegration.tokenHint);
  });
  describe.each([false, true])('POST with a token hint: %s', withHint => {
    const route = () => `/allotment/${appKey}/${withHint ? `${newIntegration.tokenHint}/` : ''}${userId}`;
    const credentials = {
      host: 'booking.example.test',
      cookies: [{ name: 'session', value: 'current-session' }],
    };

    it('uses body credentials and criteria without merging query parameters', async () => {
      const events = [];
      const onRequestEnd = event => events.push(event);
      plugins[0].events.on('request.end', onRequestEnd);
      try {
        const response = await request(app)
          .post(`${route()}?startDate=ignored-query-date`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ ...payload, credentials });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ allotments: [] });
        const call = plugins[0].queryAllotment.mock.calls[0][0];
        expect(call.payload).toEqual({ ...payload, credentials });
        expect(call.token).toEqual(token);
        expect(call.userId).toBe(userId);
        expect(call.hint).toBe(withHint ? newIntegration.tokenHint : undefined);
        expect(events).toHaveLength(1);
        expect(events[0].body).toEqual({ hasCredentials: true });
        expect(JSON.stringify(events[0])).not.toContain('current-session');
      } finally {
        plugins[0].events.off('request.end', onRequestEnd);
      }
    });

    it('rejects an unauthenticated caller', async () => {
      const response = await request(app).post(route()).send({ ...payload, credentials });
      expect(response.status).toBe(401);
      expect(plugins[0].queryAllotment).not.toHaveBeenCalled();
    });

    it('rejects a token for another user', async () => {
      const response = await request(app).post(route())
        .set('Authorization', `Bearer ${createUserToken('another-user')}`)
        .send({ ...payload, credentials });
      expect(response.status).toBe(401);
      expect(plugins[0].queryAllotment).not.toHaveBeenCalled();
    });

    it('stays synchronous when job or callback controls are supplied', async () => {
      const response = await request(app).post(route())
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ...payload, credentials, backgroundJob: true, callbackUrl: 'https://example.test/callback' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ allotments: [] });
      expect(plugins[0].queryAllotment).toHaveBeenCalledTimes(1);
    });

    it('keeps trailing-slash routes synchronous and redacts their bodies', async () => {
      const events = [];
      const onRequestEnd = event => events.push(event);
      plugins[0].events.on('request.end', onRequestEnd);
      try {
        const response = await request(app).post(`${route()}/`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ ...payload, credentials, backgroundJob: true });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ allotments: [] });
        expect(events).toHaveLength(1);
        expect(events[0].body).toEqual({ hasCredentials: true });
        expect(JSON.stringify(events[0])).not.toContain('current-session');
      } finally {
        plugins[0].events.off('request.end', onRequestEnd);
      }
    });
  });
  it('selects the hinted integration even when another token exists for the same user', async () => {
    const otherToken = { ...token, endpoint: 'https://another.example.test' };
    const otherHint = 'another-token';
    await doApiPost({
      url: `/${appKey}/${userId}`,
      token: userToken,
      payload: { tokenHint: otherHint, token: otherToken },
    });
    const response = await request(app)
      .post(`/allotment/${appKey}/${otherHint}/${userId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ...payload, credentials: { cookies: [{ name: 'session', value: 'other-current-session' }] } });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allotments: [] });
    const call = plugins[0].queryAllotment.mock.calls[0][0];
    expect(call.token).toEqual(otherToken);
    expect(call.hint).toBe(otherHint);
    expect(call.payload.credentials.cookies[0].value).toBe('other-current-session');
  });
  it.each(['success', 'network', 'timeout', 'unauthorized'])(
    'does not expose outbound credentials on a %s response', async outcome => {
      const plugin = plugins[0];
      const events = [];
      const onEvent = (...args) => events.push(args);
      const loggedErrors = jest.spyOn(console, 'error').mockImplementation(() => {});
      const credentials = { cookies: [{ name: 'session', value: 'private-cookie-value' }] };
      let outbound;
      plugin.events.onAny(onEvent);
      plugin.queryAllotment.mockImplementationOnce(async ({ axios: client, payload: body }) => {
        const mock = new MockAdapter(client);
        const route = 'https://booking.example.test/allotment';
        if (outcome === 'network') mock.onPost(route).networkError();
        else if (outcome === 'timeout') mock.onPost(route).timeout();
        else mock.onPost(route).reply(outcome === 'unauthorized' ? 401 : 200, { allotments: [] });
        try {
          const response = await client.post(route, { keyPath: body.keyPath }, {
            headers: { Cookie: `session=${body.credentials.cookies[0].value}` },
          });
          return response.data;
        } finally {
          [outbound] = mock.history.post;
          mock.restore();
        }
      });
      try {
        const response = await request(app)
          .post(`/allotment/${appKey}/${newIntegration.tokenHint}/${userId}`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ ...payload, credentials });
        expect(response.status).toBe({ success: 200, network: 502, timeout: 504, unauthorized: 401 }[outcome]);
        expect(response.body).toEqual(outcome === 'success'
          ? { allotments: [] } : { message: 'Allotment request failed' });
        expect(outbound.headers.Cookie).toBe('session=private-cookie-value');
        expect(outbound.headers.requestId).toBeTruthy();
        expect(JSON.stringify(events)).not.toContain('private-cookie-value');
        expect(JSON.stringify(loggedErrors.mock.calls)).not.toContain('private-cookie-value');
      } finally {
        plugin.events.offAny(onEvent);
        loggedErrors.mockRestore();
      }
    },
  );
  it('preserves a plugin session-required response', async () => {
    const sessionError = new Error('External session required');
    sessionError.status = 428;
    plugins[0].queryAllotment.mockRejectedValueOnce(sessionError);
    const loggedErrors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app)
        .post(`/allotment/${appKey}/${newIntegration.tokenHint}/${userId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send(payload);
      expect(response.status).toBe(428);
      expect(response.body).toEqual({ message: 'External session required' });
    } finally {
      loggedErrors.mockRestore();
    }
  });
  it.each([
    ['https://allowed.example.test/allotment', false],
    ['https://other.example.test/allotment', undefined],
  ])('preserves the configured SSL policy for %s', async (url, rejectUnauthorized) => {
    const previousDomains = process.env.SSL_INSECURE_ALLOWED_DOMAINS;
    process.env.SSL_INSECURE_ALLOWED_DOMAINS = 'allowed.example.test';
    let outbound;
    plugins[0].queryAllotment.mockImplementationOnce(async ({ axios: client }) => {
      const response = await client.post(url, {}, {
        adapter: async config => {
          outbound = config;
          return { status: 200, data: { allotments: [] }, headers: {}, config };
        },
      });
      return response.data;
    });
    try {
      const response = await request(app)
        .post(`/allotment/${appKey}/${newIntegration.tokenHint}/${userId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send(payload);
      expect(response.status).toBe(200);
      expect(outbound.headers.requestId).toBeTruthy();
      expect(outbound.httpsAgent && outbound.httpsAgent.options.rejectUnauthorized)
        .toBe(rejectUnauthorized);
    } finally {
      if (previousDomains === undefined) delete process.env.SSL_INSECURE_ALLOWED_DOMAINS;
      else process.env.SSL_INSECURE_ALLOWED_DOMAINS = previousDomains;
    }
  });
  it('should be able to receive an axios error', async () => {
    // Temporarily silence console.error for this test since we're expecting an error
    const originalConsoleError = console.error;
    console.error = jest.fn();
    
    const mock = new MockAdapter(axios);
    mock.onGet('http://www.example.com').reply(500, { what: 'nothing here' });
    let urlParamsError = new URLSearchParams({
      ...payload,
      keyPath: 'errorAxios',
    }).toString();
    const returnValue = await doApiGet({
      url: `/allotment/${appKey}/${newIntegration.tokenHint}/${userId}?${urlParamsError}`,
      token: userToken,
      expectStatusCode: 500,
    });
    expect(returnValue.allotments).toBeFalsy();
    expect(returnValue.message).toBe('nothing here');
    // Restore console.error even if the test fails
    console.error = originalConsoleError;
  });
  it('should be able to receive an error from a regular response', async () => {
    // Temporarily silence console.error for this test since we're expecting an error
    const originalConsoleError = console.error;
    console.error = jest.fn();

    const mock = new MockAdapter(axios);
    mock.onGet('http://www.example.com').reply(200, { error: 'something went wrong' });
    let urlParamsError = new URLSearchParams({
      ...payload,
      keyPath: 'errorGeneral',
    }).toString();
    const returnValue = await doApiGet({
      url: `/allotment/${appKey}/${newIntegration.tokenHint}/${userId}?${urlParamsError}`,
      token: userToken,
      expectStatusCode: 500,
    });
    expect(returnValue.allotments).toBeFalsy();
    expect(returnValue.message).toBe('something went wrong');
    // Restore console.error even if the test fails
    console.error = originalConsoleError;
  });
});
