/* globals beforeAll describe it expect jest beforeEach */

const chance = require('chance').Chance();
const hash = require('object-hash');
const cache = require('../../cache');

const { env: { adminKey } } = process;

describe('user: bookings controller - searchProducts', () => {
  const testUtils = require('../../test/utils');
  const newApp = {
    name: 'travelgate',
    packageName: 'ti2-travelgate',
    adminEmail: 'engineering+travelgate@tourconnect.com',
  };
  const appKey = newApp.name;
  // Generate a random userId for better test isolation
  const userId = `test-user-${chance.guid()}`;
  const token = {
    endpoint: 'https://api.travelgatex.com',
    apiKey: chance.guid(),
    client: 'tourconnect',
  };
  const newIntegration = {
    tokenHint: 'testingToken',
    token,
  };
  let doApiDelete;
  let doApiGet;
  let doApiPost;
  let plugins;
  let userToken;
  let appSetup;
  let createUserToken;
  
  beforeAll(async () => {
    ({
      doApiDelete,
      doApiGet,
      doApiPost,
      plugins,
      appSetup,
      createUserToken,
    } = await testUtils({
      plugins: [newApp.name],
    }));

    // drop all related cache keys, clean slate for this user
    const cacheKey = hash({
      appKey,
      userId,
      hint: 'testingToken',
      operationId: 'bookingsProductSearch',
    });
    await cache.drop({
      pluginName: appKey,
      key: cacheKey,
    });
    await cache.drop({
      pluginName: appKey,
      key: `${cacheKey}:lock`,
    });
    
    // Create user token
    userToken = createUserToken(userId);
    expect(userToken).toBeTruthy();
    
    // Create the user
    await doApiPost({
      url: '/user',
      token: adminKey,
      payload: { userId, email: `${userId}@example.com` },
    });
    
    // create the travelGage+User setup
    let userAppKeys = [];
    ({ userAppKeys } = await doApiGet({
      url: `/user/${userId}/apps`,
      token: userToken,
    }));
    
    // Check if we need to create the integration
    if (!userAppKeys.find(e => e.hint === newIntegration.tokenHint
      && e.integrationId === newApp.name)) {
      // relation does not exist
      const { value } = await doApiPost({
        url: `/${appKey}/${userId}`,
        token: userToken,
        payload: newIntegration,
      });
      expect(value).toBeTruthy();
    }
  });
  beforeEach(async () => {
    jest.clearAllMocks();
  });

  describe('searchProducts', () => {
    it('should be able to get bookings products for most users without special setup: no cache', async () => {
      const payload = {};
      const { products } = await doApiPost({
        url: `/products/${appKey}/${userId}/testingToken/search`,
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
        url: `/products/${appKey}/${userId}/testingToken/search`,
        token: userToken,
        payload,
      });
      expect(plugins[0].searchProducts).toHaveBeenCalled();
      expect(Array.isArray(products)).toBeTruthy();
      expect(products.length).toBe(2);
      expect(products[0].options.length).toBe(1);
      expect(products[1].options.length).toBe(2);
      expect(plugins[0].searchProducts.mock.calls[0][0].token).toEqual(token);
    });
    describe('cache exists and is valid', () => {
      it('should be able to get booking products: using cache', async () => {
        const payload = {};
        const { products } = await doApiPost({
          url: `/products/${appKey}/${userId}/testingToken/search`,
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
          url: `/products/${appKey}/${userId}/testingToken/search`,
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
      it('create the integration', async ()=> {
        const { userAppKeys } = await doApiGet({
          url: `/user/${userId}/apps`,
          token: userToken,
        });
        let newnewIntegration = userAppKeys.find(e => e.hint === 'hint_for_doNotCallPluginForProducts'
          && e.integrationId === newApp.name);
        if (!newnewIntegration) {
          const newIntegrationContent = {
            endpoint: 'https://api.travelgatex.com',
            apiKey: chance.guid(),
            client: 'tourconnect',
            doNotCallPluginForProducts: true,
          };
          // create a new integration with the new content
          newnewIntegration = await doApiPost({
            url: `/${appKey}/${userId}`,
            token: userToken,
            payload: {
              token: newIntegrationContent,
              tokenHint: 'hint_for_doNotCallPluginForProducts',
            },
          });
        }
        expect(newnewIntegration).toBeTruthy();
      });
      it('productSearch should not call the plugin', async () => {
        // first time call, no cache expect no plugin call and empty products
        let products;
        await doApiPost({
          url: `/products/${appKey}/${userId}/hint_for_doNotCallPluginForProducts/search`,
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
        await doApiPost({
          url: `/products/${appKey}/${userId}/hint_for_doNotCallPluginForProducts/search`,
          token: userToken,
          payload: { forceRefresh: true },
        }).then(({ products: p }) => {
          products = p;
        });
        expect(plugins[0].searchProducts).toHaveBeenCalled();
        expect(Array.isArray(products)).toBeTruthy();
        expect(products.length).toBe(2);

      });
    });
    describe('cache TTR and lock mechanism', () => {
      const shortTTRToken = {
        endpoint: 'https://api.travelgatex.com',
        apiKey: chance.guid(),
        client: 'tourconnect',
        ttlForProducts: 2, // 2 seconds TTR
      };
      beforeAll(async () => {
        // Use the existing token to create a new integration with short TTR
        await doApiPost({
          url: `/${appKey}/${userId}`,
          token: userToken,
          payload: {
            tokenHint: 'ttr-test',
            token: shortTTRToken,
          },
        });
      });
      describe('inside of the TTR period', () => {
        it('first call should create the cache', async ()=> {
          await doApiPost({
            url: `/products/${appKey}/${userId}/ttr-test/search`,
            token: userToken,
            payload: {},
          });
          expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1);
        });
        it('inmediate call should not call the plugin mehthod', async () => {
          // Second immediate call should use cache
          await doApiPost({
            url: `/products/${appKey}/${userId}/ttr-test/search`,
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
            url: `/products/${appKey}/${userId}/ttr-test/search`,
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
            url: `/products/${appKey}/${userId}/ttr-test/search`,
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
            url: `/products/${appKey}/${userId}/ttr-test/search`,
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
              token: expect.objectContaining({
                client: 'tourconnect',
                endpoint: expect.stringContaining('https://api.travelgatex.com'),
              }),
              userId: expect.stringContaining(userId),
              payload: {},
              typeDefsAndQueries: expect.any(Object)
            })
          );
        });
      });
    });
  });
});
