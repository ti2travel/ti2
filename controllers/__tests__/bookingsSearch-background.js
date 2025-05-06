/* globals beforeAll describe it expect jest beforeEach */

const chance = require('chance').Chance();
const testUtils = require('../../test/utils');

describe('user: bookings controller - productSearch background job', () => {
  const newApp = {
    name: 'travelgate',
    packageName: 'ti2-travelgate',
    adminEmail: 'engineering+travelgate@tourconnect.com',
  };
  const appKey = newApp.name;
  const userId = '551394be5ac58e5c76000019';
  const token = {
    endpoint: 'https://api.travelgatex.com',
    apiKey: chance.guid(),
    client: 'tourconnect',
  };
  const tokenHint = 'testingToken';
  const newIntegration = {
    tokenHint,
    token,
  };
  let doApiDelete;
  let doApiGet;
  let doApiPost;
  let plugins;
  let userToken;

  beforeAll(async () => {
    // Setup test utilities with mocked plugins
    ({
      doApiDelete,
      doApiGet,
      doApiPost,
      plugins,
    } = await testUtils({
      plugins: [newApp.name],
    }));
    
    const { env: { adminKey } } = process;

    // Clean slate - Drop potential existing app/user integration
    try {
      await doApiDelete({
        url: `/${appKey}/${userId}`,
        token: adminKey,
        payload: { tokenHint },
      });
    } catch (err) { /* Ignore if not found */ }
    try {
      await doApiDelete({
        url: `/app/${appKey}`,
        token: adminKey,
      });
    } catch (err) { /* Ignore if not found */ }

    // Create the test app
    await doApiPost({
      url: '/app',
      token: adminKey,
      payload: newApp,
    });

    // Create the test user and get token
    ({ value: userToken } = await doApiPost({
      url: '/user',
      token: adminKey,
      payload: { userId },
    }));

    // Create the user integration
    await doApiPost({
      url: `/${appKey}/${userId}`,
      token: userToken,
      payload: newIntegration,
    });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  it('should create a background job when calling bookingsProductSearch with backgroundJob in payload', async () => {
    // Payload with backgroundJob flag set to true
    const payload = {
      backgroundJob: true
    };

    // Call the endpoint with backgroundJob in the payload
    const response = await doApiPost({
      url: `/products/${appKey}/${userId}/${tokenHint}/search`,
      token: userToken,
      payload,
      // Expect 200 OK with a jobId in the response
      expectStatusCode: 200,
    });

    // Check if jobId is returned in the response body
    expect(response.jobId).toBeTruthy();
    expect(typeof response.jobId).toBe('string');
  });

  it('should return products directly when not using backgroundJob flag', async () => {
    // Payload without backgroundJob flag
    const payload = {};

    // Call the endpoint without backgroundJob flag
    const response = await doApiPost({
      url: `/products/${appKey}/${userId}/${tokenHint}/search`,
      token: userToken,
      payload,
      // Expect 200 OK, as the endpoint returns results directly
      expectStatusCode: 200,
    });

    // Check if products array is returned in the response body
    expect(Array.isArray(response.products)).toBeTruthy();
    expect(response.products.length).toBeGreaterThan(0);
  });
});
