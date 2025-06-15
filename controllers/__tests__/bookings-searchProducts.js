/* globals beforeAll describe it expect jest beforeEach */

const chance = require('chance').Chance();
const hash = require('object-hash');
const cache = require('../../cache');

// const { env: { adminKey } } = process; // adminKey is handled by appSetup

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
        it('populate the cache', async () => {
          // First call to populate cache
          await doApiPost({
            url: `/products/${testAppName}/${testUserId}/${ttrTestHint}/search`,
            token: userToken,
            payload: {},
          });
          expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1);
        });
        it('wait for the TTR to expire', async () => {
          // Wait for TTR to expire (2 seconds + buffer)
          await new Promise(resolve => {
            setTimeout(resolve, 2100);
          });
        });
        it('call after TTR expired should hit the plugin again', async () => {
          await doApiPost({
            url: `/products/${testAppName}/${testUserId}/${ttrTestHint}/search`,
            token: userToken,
            payload: {},
          });
          expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1);
        });
      });
      describe('lock mechanism', () => {
        it('wait for the TTR to expire', async () => {
          await new Promise(resolve => {
            setTimeout(resolve, 2100);
          });
        });
        it('multiple concurrent requests with slight delays', async () => {
          // NOTE: this is inside of a single block since it needs to count the nunber of times
          const makeRequest = () => doApiPost({
            url: `/products/${testAppName}/${testUserId}/${ttrTestHint}/search`,
            token: userToken,
            payload: {},
          });
          expect (plugins[0].searchProducts).not.toHaveBeenCalled();
          // Start first request
          const request1 = makeRequest();
          // Start second request after 10ms
          await new Promise(resolve => {
            setTimeout(resolve, 10);
          });
          const request2 = makeRequest();
          // Start third request after another 10ms
          await new Promise(resolve => {
            setTimeout(resolve, 10);
          });
          const request3 = makeRequest();

          // Wait for all requests to complete
          const results = await Promise.all([request1, request2, request3]);

          // All requests should return valid products
          results.forEach(({ products }) => {
            expect(Array.isArray(products)).toBeTruthy();
            expect(products.length).toBe(2); // Based on existing test expectations
          });
          expect (plugins[0].searchProducts).toHaveBeenCalledTimes(1);
          // Plugin should only be called once due to lock mechanism, and with correct context', async () => {
          expect(plugins[0].searchProducts).toHaveBeenCalledWith(
            expect.objectContaining({
              token: expect.objectContaining({ // This should match structure of shortTTRToken
                client: 'tourconnect', // Ensure shortTTRToken has this
                endpoint: expect.stringContaining('https://api.travelgatex.com'), // Ensure shortTTRToken has this
                apiKey: expect.any(String), // Ensure shortTTRToken has this
                ttlForProducts: 2, // Ensure shortTTRToken has this
              }),
              userId: testUserId, // Compare with the specific testUserId
              payload: {},
              typeDefsAndQueries: expect.any(Object)
            })
          );
        });
      });
    });
  });

  describe('bookingsProductSearch caching - stale cache on TTR expiry', () => {
    jest.mock('../../cache'); // Mock cache specifically for this describe block
    // This test suite uses the main testAppName, testUserId, testHint, userToken, plugins, doApiPost
    // defined in the beforeAll of the parent describe block.

    it('should not return empty products when TTR expires and stale cache exists, even if refresh yields empty products', async () => {
      const cacheModule = require('../../cache'); // Get the mocked cache module

      const initialProductsInCache = [{ productId: 'cached1', name: 'Cached Product One', optionId: 'opt1' }];
      const productsFromPluginRefresh = []; // Simulate plugin returning empty on refresh

      // Configure a short TTR for this test via plugin's cacheSettings
      // This relies on testPluginToken.ttlForProducts being undefined or overridden by cacheSettings
      const ttrInSeconds = 1;
      // Ensure plugins[0] exists and then set cacheSettings
      if (plugins && plugins.length > 0) {
        plugins[0].cacheSettings = { bookingsProductSearch: { ttr: ttrInSeconds } };
      } else {
        throw new Error("Plugins array is not initialized or empty.");
      }


      const expectedCacheKeyForProducts = hash({
        // Use variables from the outer scope of bookings-searchProducts.js
        userId: testUserId,
        hint: testHint,
        operationId: 'bookingsProductSearch',
      });
      const lastUpdatedKey = `${expectedCacheKeyForProducts}:lastUpdated`;
      const lockKey = `${expectedCacheKeyForProducts}:lock`;

      cacheModule.get.mockImplementation(async ({ pluginName, key }) => {
        // Ensure calls are for the correct plugin
        if (pluginName !== testAppName) return null;

        if (key === expectedCacheKeyForProducts) {
          return { products: initialProductsInCache };
        }
        if (key === lastUpdatedKey) {
          // Simulate that lastUpdated is older than TTR
          return Date.now() - (ttrInSeconds * 1000 * 2);
        }
        if (key === lockKey) {
          return null; // No lock exists
        }
        return null;
      });

      // Mock the plugin's underlying product search method
      if (plugins && plugins.length > 0 && plugins[0].searchProducts) {
        plugins[0].searchProducts.mockResolvedValue({ products: productsFromPluginRefresh });
      } else {
        throw new Error("plugins[0].searchProducts is not available or not a mock function.");
      }

      const searchPayload = { searchInput: 'test' };
      const { products: resultProducts } = await doApiPost({
        url: `/products/${testAppName}/${testUserId}/${testHint}/search`,
        token: userToken,
        payload: searchPayload,
      });

      expect(resultProducts).toEqual(initialProductsInCache);
      expect(resultProducts.length).toBeGreaterThan(0);

      // Verify interactions
      expect(cacheModule.get).toHaveBeenCalledWith(expect.objectContaining({ pluginName: testAppName, key: expectedCacheKeyForProducts }));
      expect(cacheModule.get).toHaveBeenCalledWith(expect.objectContaining({ pluginName: testAppName, key: lastUpdatedKey }));
      expect(cacheModule.get).toHaveBeenCalledWith(expect.objectContaining({ pluginName: testAppName, key: lockKey }));

      expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1); // Refresh was attempted

      // Verify cache operations for locking and updating
      expect(cacheModule.save).toHaveBeenCalledWith(expect.objectContaining({ pluginName: testAppName, key: lockKey, value: true }));
      expect(cacheModule.save).toHaveBeenCalledWith(expect.objectContaining({
        pluginName: testAppName,
        key: expectedCacheKeyForProducts,
        value: { products: productsFromPluginRefresh },
      }));
      expect(cacheModule.save).toHaveBeenCalledWith(expect.objectContaining({ pluginName: testAppName, key: lastUpdatedKey }));
      expect(cacheModule.drop).toHaveBeenCalledWith(expect.objectContaining({ pluginName: testAppName, key: lockKey }));
    });
  });
});
