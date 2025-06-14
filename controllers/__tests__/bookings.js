/* globals beforeAll describe it expect jest beforeEach */

const chance = require('chance').Chance();
const hash = require('object-hash');
const cache = require('../../cache');

const { env: { adminKey } } = process;

describe('user: bookings controller', () => {
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
  beforeAll(async () => {
    ({
      doApiDelete,
      doApiGet,
      doApiPost,
      plugins,
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
    // create the travelgate app and user
    const { value: apiKey } = await doApiPost({
      url: '/app',
      token: adminKey,
      payload: newApp,
    });
    expect(apiKey).toBeTruthy();

    // Create the user token
    ({ value: userToken } = await doApiPost({
      url: '/user',
      token: adminKey,
      payload: { userId },
    }));
    expect(userToken).toBeTruthy();
    // Create the user first, then get the token
    await doApiPost({
      url: '/user',
        token: adminKey,
        payload: { userId, email: `${userId}@example.com` },
      });
      // Now get the token
      ({ value: userToken } = await doApiPost({
        url: '/user',
        token: adminKey,
        payload: { userId },
      }));
      expect(userToken).toBeTruthy();
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
  describe('bookings', ()=> {
    it('should be able to search a for a booking', async () => {
      const payload = {
        bookingId: '', supplierBookingId: '', name: '',
      };
      const { bookings } = await doApiPost({
        url: `/bookings/${appKey}/${userId}/testingToken/search`,
        token: userToken,
        payload,
      });
      expect(plugins[0].searchHotelBooking).toHaveBeenCalled();
      expect(Array.isArray(bookings)).toBeTruthy();
      expect(plugins[0].searchHotelBooking.mock.calls[0][0].payload).toEqual(payload);
      expect(plugins[0].searchHotelBooking.mock.calls[0][0].token).toEqual(token);

      // expect(Array.isArray(retVal.bookings)).toBeTruthy();
      // expect(retVal.bookings.length > 0).toBeTruthy();
    });

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
          // create a new user token with the new content
          newnewIntegration = await doApiPost({
            url: `/travelgate/${userId}`,
            token: adminKey,
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

  it('should be able to search for availabiility', async () => {
    const payload = {
      travelDateStart: '12/30/2025',
      travelDateEnd: '01/15/2026',
      dateFormat: 'MM/DD/YYYY',
      occupancies: [{ paxes: [{ age: 30 }, { age: 40 }] }],
      currency: 'EUR',
      market: 'ES',
      language: 'es',
      nationality: 'ES',
    };
    const { availability } = await doApiPost({
      url: `/bookings/${appKey}/${userId}/testingToken/availability`,
      token: userToken,
      payload,
    });
    expect(plugins[0].searchAvailability).toHaveBeenCalled();
    expect(Array.isArray(availability)).toBeTruthy();
    expect(plugins[0].searchAvailability.mock.calls[0][0].payload).toEqual(payload);
    expect(plugins[0].searchAvailability.mock.calls[0][0].token).toEqual(token);
  });
  it('should be able to obtain a quote', async () => {
    const payload = {
      id: chance.guid(), // availability result id
      travelDateStart: '12/30/2025',
      travelDateEnd: '01/15/2026',
      dateFormat: 'MM/DD/YYYY',
      occupancies: [{ paxes: [{ age: 30 }, { age: 40 }] }],
      currency: 'EUR',
      market: 'ES',
      language: 'es',
      nationality: 'ES',
    };
    const { quote } = await doApiPost({
      url: `/bookings/${appKey}/${userId}/testingToken/quote`,
      token: userToken,
      payload,
    });
    expect(plugins[0].searchQuote).toHaveBeenCalled();
    expect(Array.isArray(quote)).toBeTruthy();
    expect(plugins[0].searchQuote.mock.calls[0][0].payload).toEqual(payload);
    expect(plugins[0].searchQuote.mock.calls[0][0].token).toEqual(token);
  });
  it('should be able create a booking', async () => {
    const payload = {
      id: chance.guid(),
    };
    await doApiPost({
      url: `/bookings/${appKey}/${userId}/testingToken/booking`,
      token: userToken,
      payload,
    });
    expect(plugins[0].createBooking).toHaveBeenCalled();
    expect(plugins[0].createBooking.mock.calls[0][0].payload).toEqual(payload);
    expect(plugins[0].createBooking.mock.calls[0][0].token).toEqual(token);
  });
});
