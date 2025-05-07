/* globals beforeAll describe it expect jest */
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const chance = require('chance').Chance();

const testUtils = require('../../test/utils');

const { env: { adminKey } } = process;

describe('allotment', () => {
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
  beforeAll(async () => {
    ({
      doApiGet,
      doApiPost,
      plugins,
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
  });
  it('should be able to receive an axios error', async () => {
    // Temporarily silence console.error for this test since we're expecting an error
    const originalConsoleError = console.error;
    console.error = jest.fn();
    
    try {
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
    } finally {
      // Restore console.error even if the test fails
      console.error = originalConsoleError;
    }
  });
  it('should be able to receive an error from a regular response', async () => {
    // Temporarily silence console.error for this test since we're expecting an error
    const originalConsoleError = console.error;
    console.error = jest.fn();
    
    try {
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
    } finally {
      // Restore console.error even if the test fails
      console.error = originalConsoleError;
    }
  });
});
