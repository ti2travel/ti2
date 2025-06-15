/* globals beforeAll describe it expect jest beforeEach */

const chance = require('chance').Chance();
const hash = require('object-hash');
// cache is now mocked at the top level
// const cache = require('../../cache');

const { env: { adminKey } } = process;
jest.mock('../../cache');

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

  describe('bookingsProductSearch caching', () => {
    it('should not return empty products when TTR expires and stale cache exists, even if refresh yields empty products', async () => {
      const cacheModule = require('../../cache'); // Get the mocked cache module

      const initialProductsInCache = [{ productId: 'cached1', name: 'Cached Product One', optionId: 'opt1' }];
      const productsFromPluginRefresh = []; // Simulate plugin returning empty on refresh

      // Configure a short TTR for this test via plugin's cacheSettings
      // This relies on token.ttlForProducts being undefined for this test user's token setup
      const ttrInSeconds = 1;
      plugins[0].cacheSettings = { bookingsProductSearch: { ttr: ttrInSeconds } };

      const expectedCacheKeyForProducts = hash({
        userId,
        hint: newIntegration.tokenHint, // 'testingToken'
        operationId: 'bookingsProductSearch',
      });
      const lastUpdatedKey = `${expectedCacheKeyForProducts}:lastUpdated`;
      const lockKey = `${expectedCacheKeyForProducts}:lock`;

      cacheModule.get.mockImplementation(async ({ pluginName, key }) => {
        // Ensure calls are for the correct plugin
        if (pluginName !== appKey) return null;

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
      // (app.searchProducts || app.searchProductsForItinerary)
      // Assuming searchProducts is the relevant method for 'travelgate' plugin
      plugins[0].searchProducts.mockResolvedValue({ products: productsFromPluginRefresh });

      const searchPayload = { searchInput: 'test' };
      const { products: resultProducts } = await doApiPost({
        url: `/bookings/${appKey}/${userId}/${newIntegration.tokenHint}/products/search`,
        token: userToken,
        payload: searchPayload,
      });

      // **** This is the key assertion based on the user's requirement ****
      // It expects the stale cache (initialProductsInCache) rather than productsFromPluginRefresh
      // This assertion will likely FAIL with the current code if it returns the empty refreshed data.
      expect(resultProducts).toEqual(initialProductsInCache);
      expect(resultProducts.length).toBeGreaterThan(0);


      // Verify interactions
      expect(cacheModule.get).toHaveBeenCalledWith(expect.objectContaining({ pluginName: appKey, key: expectedCacheKeyForProducts }));
      expect(cacheModule.get).toHaveBeenCalledWith(expect.objectContaining({ pluginName: appKey, key: lastUpdatedKey }));
      expect(cacheModule.get).toHaveBeenCalledWith(expect.objectContaining({ pluginName: appKey, key: lockKey }));

      expect(plugins[0].searchProducts).toHaveBeenCalledTimes(1); // Refresh was attempted

      // Verify cache operations for locking and updating
      expect(cacheModule.save).toHaveBeenCalledWith(expect.objectContaining({ pluginName: appKey, key: lockKey, value: true }));
      expect(cacheModule.save).toHaveBeenCalledWith(expect.objectContaining({
        pluginName: appKey,
        key: expectedCacheKeyForProducts,
        value: { products: productsFromPluginRefresh }, // Cache updated with new (empty) data
      }));
      expect(cacheModule.save).toHaveBeenCalledWith(expect.objectContaining({ pluginName: appKey, key: lastUpdatedKey })); // lastUpdated timestamp was updated
      expect(cacheModule.drop).toHaveBeenCalledWith(expect.objectContaining({ pluginName: appKey, key: lockKey })); // Lock was released
    });
  });
});
