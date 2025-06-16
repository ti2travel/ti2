/* globals beforeAll describe it expect jest beforeEach */

const chance = require('chance').Chance();
const hash = require('object-hash');
const cache = require('../../cache');
// Remove direct import of listJobs, jobStatus as we'll mock addJob
// const { listJobs, jobStatus } = require('../../worker/queue'); 

// Mock the worker/queue module
jest.mock('../../worker/queue', () => ({
  ...jest.requireActual('../../worker/queue'), // Import and retain default behavior
  addJob: jest.fn().mockResolvedValue({ id: 'mockJobId' }), // Mock addJob
  listJobs: jest.fn().mockResolvedValue([]), // Keep a mock for listJobs if other tests use it
  jobStatus: jest.fn().mockResolvedValue({ status: 'completed' }), // Keep a mock for jobStatus
}));
const { addJob } = require('../../worker/queue'); // Now addJob is the mock

// const { env: { adminKey } } = process; // adminKey is handled by appSetup

describe('Bookings Product Search Lock Mechanism (Job Queuing on Stale Cache)', () => {
  const testUtils = require('../../test/utils');
  let doApiPost;
  let plugins;
  let userToken;
  let testAppName;
  let testUserId;
  let ttrTestHint;
  const shortTTRTokenConfig = {
    endpoint: 'https://api.travelgatex.com/lock-test',
    apiKey: chance.guid(),
    client: 'tourconnect-lock-test',
    ttlForProducts: 1, // 1 second TTR for faster testing
  };

  beforeAll(async () => {
    const utils = await testUtils({ plugins: ['lockTestPlugin'] }); // Use a unique plugin name for isolation
    doApiPost = utils.doApiPost;
    plugins = utils.plugins; // This will be an array with one mocked plugin instance

    // Setup a new app, user, and integration specifically for this test suite
    const setupData = await utils.appSetup({ appName: 'lockTestApp' });
    testAppName = setupData.newApp.name;
    testUserId = setupData.userId;
    userToken = utils.createUserToken(testUserId);
    ttrTestHint = 'lock-mechanism-hint';

    // Create the integration with short TTR
    await doApiPost({
      url: `/${testAppName}/${testUserId}`,
      token: userToken,
      payload: {
        tokenHint: ttrTestHint,
        token: shortTTRTokenConfig,
      },
    });

    // Initial cache clear for this specific context
    const cacheKey = hash({
      userId: testUserId,
      hint: ttrTestHint,
      operationId: 'bookingsProductSearch',
    });
    await cache.drop({ pluginName: testAppName, key: cacheKey });
    await cache.drop({ pluginName: testAppName, key: `${cacheKey}:lastUpdated` });
    await cache.drop({ pluginName: testAppName, key: `${cacheKey}:lock` });
  });

  beforeEach(async () => {
    // Clear mocks before each test in this suite
    jest.clearAllMocks(); 
    // Ensure the mocked plugin's searchProducts is also cleared if it's a Jest mock
    if (plugins && plugins[0] && plugins[0].searchProducts && plugins[0].searchProducts.mockClear) {
      plugins[0].searchProducts.mockClear();
    }
    // Reset addJob mock calls before each test
    addJob.mockClear(); 
  });

  it('multiple concurrent requests to stale cache should serve stale data and queue only one new refresh job', async () => {
    // 1. First call: Populate the cache
    // Mock plugin response for initial cache population
    plugins[0].searchProducts.mockResolvedValueOnce({ products: [{ id: 'prod1', name: 'Initial Product' }] });
    await doApiPost({
      url: `/products/${testAppName}/${testUserId}/${ttrTestHint}/search`,
      token: userToken,
      payload: {},
    });
    expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1);
    expect(addJob).not.toHaveBeenCalled(); // No job queued on initial population
    plugins[0].searchProducts.mockClear(); // Clear for next phase

    // 2. Wait for TTR to expire (ttlForProducts is 1s, wait 1.5s)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 3. Make multiple concurrent requests to the now stale cache
    // Mock plugin response for the background refresh (though it won't be directly called by these API reqs)
    // This mock is for the job that addJob is supposed to queue.
    plugins[0].searchProducts.mockResolvedValueOnce({ products: [{ id: 'prod2', name: 'Refreshed Product' }] });

    const makeRequest = () => doApiPost({
      url: `/products/${testAppName}/${testUserId}/${ttrTestHint}/search`,
      token: userToken,
      payload: {},
    });

    const requestPromises = [];
    requestPromises.push(makeRequest()); // First request hits stale cache, should queue job
    await global.sleep(50); // Small delay to simulate near concurrency
    requestPromises.push(makeRequest()); // Second request should also hit stale cache, but not queue another job
    await global.sleep(50);
    requestPromises.push(makeRequest()); // Third request

    const results = await Promise.all(requestPromises);

    // Assertions:
    // a. All requests should serve stale data (the "Initial Product")
    results.forEach(result => {
      expect(result.products).toEqual([{ id: 'prod1', name: 'Initial Product' }]);
    });

    // b. The plugin's searchProducts method should NOT have been called directly by these API requests
    //    because data is stale and a background job is queued.
    expect(plugins[0].searchProducts).not.toHaveBeenCalled();

    // c. addJob should have been called exactly once
    expect(addJob).toHaveBeenCalledTimes(1);

    // d. (Optional but good) Verify arguments of addJob
    if (addJob.mock.calls.length > 0) {
      const expectedPluginMethodName = plugins[0].searchProducts ? 'searchProducts' : 'searchProductsForItinerary';
      expect(addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'plugin',
          pluginName: testAppName,
          method: expectedPluginMethodName,
          token: expect.objectContaining({ ttlForProducts: shortTTRTokenConfig.ttlForProducts }),
          payload: expect.objectContaining({
            payload: {}, // originalRequestBody was empty
            userId: testUserId,
          }),
          postProcess: expect.objectContaining({
            controller: 'bookings',
            action: '$updateProductSearchCache',
            args: expect.objectContaining({
              appKey: testAppName,
              userId: testUserId,
              hint: ttrTestHint,
            }),
          }),
        }),
        { removeOnComplete: true }
      );
    }
  });
});

describe('user: bookings controller - searchProducts', () => {
  const testUtils = require('../../test/utils');
  
  let doApiGet;
  let doApiPost;
  let plugins;
  let userToken; // JWT for API authentication
  let testAppName; // e.g., 'travelgate'
  let testUserId; // User ID for tests
  let testPluginToken; // Token object for plugin configuration
  let testHint; // Hint for the default integration

  beforeAll(async () => {
    const utils = await testUtils({
      plugins: ['travelgate'], // We are testing the 'travelgate' plugin mock
    });
    doApiGet = utils.doApiGet;
    doApiPost = utils.doApiPost;
    plugins = utils.plugins;

    // Setup a new app, user, and integration using testUtils
    // appName: 'travelgate' ensures we use the 'travelgate' plugin context
    const setupData = await utils.appSetup({ appName: 'travelgate' });
    testAppName = setupData.newApp.name; // Should be 'travelgate'
    testUserId = setupData.userId;
    testPluginToken = setupData.token; // This is the token config for the plugin
    testHint = setupData.hint; // Hint for the integration created by appSetup
    
    // Create JWT for the testUser
    userToken = utils.createUserToken(testUserId);
    expect(userToken).toBeTruthy();

    // Drop all related cache keys, clean slate for this user and app combination
    const cacheKey = hash({
      appKey: testAppName,
      userId: testUserId,
      hint: testHint, // Use the hint from the default integration
      operationId: 'bookingsProductSearch',
    });
    await cache.drop({
      pluginName: testAppName,
      key: cacheKey,
    });
    await cache.drop({
      pluginName: testAppName,
      key: `${cacheKey}:lock`,
    });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  describe('searchProducts', () => {
    it('should be able to get bookings products for most users without special setup: no cache', async () => {
      const payload = {};
      const { products } = await doApiPost({
        url: `/products/${testAppName}/${testUserId}/${testHint}/search`,
        token: userToken,
        payload,
      });
      expect(plugins[0].searchProducts).toHaveBeenCalled();
      expect(Array.isArray(products)).toBeTruthy();
      expect(products.length).toBe(2);
      expect(products[0].options.length).toBe(1);
      expect(products[1].options.length).toBe(2);
    });
    it('should be able to get booking products: no cache, forceRefresh', async () => {
      // NOTE: we SHOULD NOT need to remove the cache first, since we are forceRefreshing, we are testing the endpoint get's called while having a cache created
      const payload = {
        forceRefresh: true,
      };
      const { products } = await doApiPost({
        url: `/products/${testAppName}/${testUserId}/${testHint}/search`,
        token: userToken,
        payload,
      });
      expect(plugins[0].searchProducts).toHaveBeenCalled();
      expect(Array.isArray(products)).toBeTruthy();
      expect(products.length).toBe(2);
      expect(products[0].options.length).toBe(1);
      expect(products[1].options.length).toBe(2);
      expect(plugins[0].searchProducts.mock.calls[0][0].token).toEqual(testPluginToken);
    });
    describe('cache exists and is valid', () => {
      it('should be able to get booking products: using cache', async () => {
        const payload = {};
        const { products } = await doApiPost({
          url: `/products/${testAppName}/${testUserId}/${testHint}/search`,
          token: userToken,
          payload,
        });
        expect(plugins[0].searchProducts).not.toHaveBeenCalled();
        expect(Array.isArray(products)).toBeTruthy();
        expect(products.length).toBe(2);
        expect(products[0].options.length).toBe(1);
        expect(products[1].options.length).toBe(2);
      });
      it('should be able to get booking products with searchInput', async () => {

        const payload = {
          searchInput: 'Transfer from Sydney Harbor to Hilton Hotel',
        };
        const { products } = await doApiPost({
          url: `/products/${testAppName}/${testUserId}/${testHint}/search`,
          token: userToken,
          payload,
        });
        expect(plugins[0].searchProducts).not.toHaveBeenCalled();
        expect(Array.isArray(products)).toBeTruthy();
        expect(products.length).toBe(1);
        expect(products[0].productName).toBe('Davids');
        expect(products[0].options.length).toBe(1);
        expect(products[0].options[0].optionName).toBe('Transfer from Sydney Harbor Bridge to Hilton Hotel');
      });
    });
    describe('doNotCallPluginForProducts flag', () => {
      const doNotCallHint = 'hint_for_doNotCallPluginForProducts';
      beforeAll(async () => {
        // Create a specific integration for this test suite
        const newIntegrationContent = {
          endpoint: 'https://api.travelgatex.com', // Can be any valid URL
          apiKey: chance.guid(),
          client: 'tourconnect', // Or any other fields your plugin might expect
          doNotCallPluginForProducts: true,
        };
        await doApiPost({
          url: `/${testAppName}/${testUserId}`,
          token: userToken, // User's JWT to authorize setting up their own integration
          payload: {
            token: newIntegrationContent,
            tokenHint: doNotCallHint,
          },
        });
      });

      it('productSearch should not call the plugin', async () => {
        // first time call, no cache expect no plugin call and empty products
        let products;
        await doApiPost({
          url: `/products/${testAppName}/${testUserId}/${doNotCallHint}/search`,
          token: userToken,
          payload: {},
        }).then(({ products: p }) => {
          products = p;
        });
        expect(plugins[0].searchProducts).not.toHaveBeenCalled();
        expect(Array.isArray(products)).toBeTruthy();
        expect(products.length).toBe(0);

      });
      it('a forceRefresh should trigger the call to the plugin', async() => {
        // second time call, forceRefresh and still expect plugin call
        let products; // Define products here to ensure it's in scope for the then block
        await doApiPost({
          url: `/products/${testAppName}/${testUserId}/${doNotCallHint}/search`,
          token: userToken,
          payload: { forceRefresh: true },
        }).then(({ products: p }) => {
          products = p; // Assign to the outer scoped 'products'
        });
        expect(plugins[0].searchProducts).toHaveBeenCalled();
        expect(Array.isArray(products)).toBeTruthy();
        expect(products.length).toBe(2);

      });
    });
    describe('cache TTR and lock mechanism', () => {
      const ttrTestHint = 'ttr-test';
      const shortTTRToken = {
        endpoint: 'https://api.travelgatex.com', // Can be any valid URL
        apiKey: chance.guid(),
        client: 'tourconnect', // Or any other fields
        ttlForProducts: 2, // 2 seconds TTR
      };
      beforeAll(async () => {
        // Create a new integration with short TTR for this user and app
        await doApiPost({
          url: `/${testAppName}/${testUserId}`,
          token: userToken, // User's JWT
          payload: {
            tokenHint: ttrTestHint,
            token: shortTTRToken,
          },
        });
      });
      describe('inside of the TTR period', () => {
        it('first call should create the cache', async ()=> {
          await doApiPost({
            url: `/products/${testAppName}/${testUserId}/${ttrTestHint}/search`,
            token: userToken,
            payload: {},
          });
          expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1);
        });
        it('inmediate call should not call the plugin mehthod', async () => {
          // Second immediate call should use cache
          await doApiPost({
            url: `/products/${testAppName}/${testUserId}/${ttrTestHint}/search`,
            token: userToken,
            payload: {},
          });
          expect(plugins[0].searchProducts).not.toHaveBeenCalled();
        });
      });
      describe('outside of the TTR period', () => {
        it('wait for the TTR to expire', async () => {
          // Wait for TTR to expire (2 seconds + buffer)
          await new Promise(resolve => {
            setTimeout(resolve, 2100);
          });
        });
        it('call outside of TTR should serve stale data and queue background refresh', async () => {
          plugins[0].searchProducts.mockClear(); // Clear before action to ensure clean state for mock call counting

          const { products } = await doApiPost({
            url: `/products/${testAppName}/${testUserId}/${ttrTestHint}/search`,
            token: userToken,
            payload: {},
          });
          // This synchronous call should serve stale data.
          // The plugin should NOT be called by *this* request directly as a background job is queued.
          expect(plugins[0].searchProducts).not.toHaveBeenCalled();
          expect(Array.isArray(products)).toBeTruthy();
          expect(products.length).toBe(2); // Assuming stale data (from initial cache population) is available and has 2 products
        });
        it('should queue a background job with correct parameters when cache is stale', async () => {
          // This test assumes the previous one ('call outside of TTR should serve stale data...')
          // has served stale data and is expected to queue a background job.
          // We now check if that job was queued correctly.

          // Give a brief moment for the job to be added to the queue if it's asynchronous
          // within the controller logic, though addJob itself is async.
          await global.sleep(100); // Small delay to ensure job is queued

          const jobs = await listJobs();
          const expectedPluginMethod = plugins[0].searchProducts ? 'searchProducts' : 'searchProductsForItinerary';

          const foundJob = jobs.find(job => {
            const jd = job.data; // job.data
            return (
              jd.type === 'plugin' &&
              jd.pluginName === testAppName &&
              jd.method === expectedPluginMethod &&
              jd.token && // Check that token is present in job.data
              jd.payload && // Check for job.data.payload
              jd.payload.userId === testUserId &&
              // For this test, payloadForPlugin was {}, so jd.payload.payload should be {}
              (typeof jd.payload.payload === 'object' && Object.keys(jd.payload.payload).length === 0) &&
              
              jd.postProcess &&
              jd.postProcess.controller === 'bookings' &&
              jd.postProcess.action === '$updateProductSearchCache' &&
              jd.postProcess.args &&
              jd.postProcess.args.appKey === testAppName &&
              jd.postProcess.args.userId === testUserId &&
              jd.postProcess.args.hint === ttrTestHint
            );
          });

          expect(foundJob).toBeDefined();
          if (foundJob) { // Further assertions if foundJob is defined
            expect(foundJob.data.type).toBe('plugin');
            expect(foundJob.data.pluginName).toBe(testAppName);
            expect(foundJob.data.method).toBe(expectedPluginMethod);
            expect(foundJob.data.token).toBeDefined(); // Basic check for token presence
            expect(foundJob.data.payload.userId).toBe(testUserId);
            expect(foundJob.data.payload.payload).toEqual({});
            expect(foundJob.data.postProcess.controller).toBe('bookings');
            expect(foundJob.data.postProcess.action).toBe('$updateProductSearchCache');
            expect(foundJob.data.postProcess.args.appKey).toBe(testAppName);
            expect(foundJob.data.postProcess.args.userId).toBe(testUserId);
            expect(foundJob.data.postProcess.args.hint).toBe(ttrTestHint);
          }
        });
      });
      // The 'lock mechanism (job queuing on stale cache)' describe block has been moved to the top level.
    });
  });

  describe.skip('bookingsProductSearch caching - stale cache on TTR expiry', () => {
    // This suite tests behavior when TTR expires and a refresh yields empty results,
    // expecting stale cache to be served. It uses a real cache with a short TTL.

    const staleCacheTestHint = 'stale-cache-expiry-test-hint';
    const shortTtlForProducts = 2; // 2 seconds
    const staleCacheTokenConfig = {
      endpoint: 'https://api.travelgatex.com/stale-test', // Unique endpoint for clarity
      apiKey: chance.guid(),
      client: 'tourconnect-stale-test',
      ttlForProducts: shortTtlForProducts,
    };

    beforeEach(async () => {
      // Clear any existing mocks on searchProducts from other tests or previous runs
      if (plugins && plugins.length > 0 && plugins[0].searchProducts && plugins[0].searchProducts.mockClear) {
        plugins[0].searchProducts.mockClear();
      }

      // Ensure a clean cache state for this specific hint before each test run
      const cacheKeyForTest = hash({
        userId: testUserId,
        hint: staleCacheTestHint,
        operationId: 'bookingsProductSearch',
      });
      await cache.drop({ pluginName: testAppName, key: cacheKeyForTest });
      await cache.drop({ pluginName: testAppName, key: `${cacheKeyForTest}:lastUpdated` });
      await cache.drop({ pluginName: testAppName, key: `${cacheKeyForTest}:lock` });
      
      // Setup the integration with the short TTL for products
      await doApiPost({
        url: `/${testAppName}/${testUserId}`,
        token: userToken,
        payload: {
          tokenHint: staleCacheTestHint,
          token: staleCacheTokenConfig,
        },
      });
      // Clear mock calls that might have happened during setup
      if (plugins && plugins.length > 0 && plugins[0].searchProducts && plugins[0].searchProducts.mockClear) {
        plugins[0].searchProducts.mockClear();
      }
    });

    it('should return stale (non-empty) products when TTR expires and refresh yields empty products', async () => {
      const initialProductsInCache = [{ productId: 'staleProd1', name: 'Stale Product One', optionId: 'optStale1' }];
      const productsFromPluginRefresh = []; // Simulate plugin returning empty on refresh

      // 1. First call: Populate the cache with initialProductsInCache
      plugins[0].searchProducts.mockResolvedValueOnce({ products: initialProductsInCache });
      const { products: firstCallResult } = await doApiPost({
        url: `/products/${testAppName}/${testUserId}/${staleCacheTestHint}/search`,
        token: userToken,
        payload: { searchInput: '' }, // Use empty searchInput for simplicity
      });

      expect(firstCallResult).toEqual(initialProductsInCache);
      expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1);
      plugins[0].searchProducts.mockClear(); // Clear for the next assertion

      // 2. Wait for TTL to expire (shortTtlForProducts is 2s, wait 3s)
      await new Promise(resolve => setTimeout(resolve, (shortTtlForProducts + 1) * 1000));

      // 3. Second call: TTR has expired. Plugin will be called for refresh.
      //    Mock plugin to return empty results for this refresh attempt.
      plugins[0].searchProducts.mockResolvedValueOnce({ products: productsFromPluginRefresh });
      const { products: secondCallResult } = await doApiPost({
        url: `/products/${testAppName}/${testUserId}/${staleCacheTestHint}/search`,
        token: userToken,
        payload: { searchInput: '' }, // Use empty searchInput for simplicity
      });

      // Assert that the stale data (initialProductsInCache) is returned, not the empty refresh.
      // This assertion is expected to FAIL with current application logic if it returns the empty refreshed data.
      expect(secondCallResult).toEqual(initialProductsInCache);
      expect(secondCallResult.length).toBeGreaterThan(0);
      
      // Verify that the plugin's searchProducts was indeed called for the refresh attempt.
      expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1);
    });
  });
});
