/* globals beforeAll describe it expect jest beforeEach */

const chance = require('chance').Chance();
const testUtils = require('../../test/utils');
const cache = require('../../cache');

const { env: { adminKey } } = process;

describe('user: bookings controller', () => {
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
  const newIntegration = {
    tokenHint: 'testingToken',
    token,
  };
  let doApiDelete;
  let doApiGet;
  let doApiPost;
  let plugins;
  beforeAll(async () => {
    ({
      doApiDelete,
      doApiGet,
      doApiPost,
      plugins,
    } = await testUtils({
      plugins: [newApp.name],
    }));

    // drop all cache keys, clean slate
    const cacheKeys = await cache.keys();
    cacheKeys.forEach(key => cache.drop({
      pluginName: key.split(':')[0],
      key: key.split(':')[1],
    }));
  });
  beforeEach(async () => {
    jest.clearAllMocks();
  });

  let userToken;
  it('drop any existing travelgateapp integration', async () => {
    try {
      await doApiDelete({
        url: `/travelgate/${userId}`,
        token: adminKey,
        payload: { tokenHint: 'testingToken' },
      });
    } catch (err) {
      console.debug(err);
    }
    try {
      await doApiDelete({
        url: '/app/travelgate',
        token: adminKey,
      });
    } catch (err) {
      console.debug(err);
    }
  });
  it('create the travelgate app', async () => {
    const { value: apiKey } = await doApiPost({
      url: '/app',
      token: adminKey,
      payload: newApp,
    });
    expect(apiKey).toBeTruthy();
    // create the user token
    ({ value: userToken } = await doApiPost({
      url: '/user',
      token: adminKey,
      payload: { userId },
    }));
    expect(userToken).toBeTruthy();
  });
  it('create the travelGage+User setup', async () => {
    const { userAppKeys } = await doApiGet({
      url: `/user/${userId}/apps`,
      token: userToken,
    });
    if (!userAppKeys.find(e => e.hint === newIntegration.tokenHint
        && e.integrationId === newApp.name)) {
      // relation does not exits
      const { value } = await doApiPost({
        url: `/${appKey}/${userId}`,
        token: userToken,
        payload: newIntegration,
      });
      expect(value).toBeTruthy();
    }
  });
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

  describe('searchProducts', () => {
    it('should be able to get booking products: no cache, forceRefresh', async () => {
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
      expect(plugins[0].searchProducts.mock.calls[0][0].payload).toEqual(payload);
      expect(plugins[0].searchProducts.mock.calls[0][0].token).toEqual(token);
    });
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
    it('should be able to process doNotCallPluginForProducts in token', async () => {
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
