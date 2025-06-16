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
