/* globals beforeAll describe it expect */

const chance = require('chance').Chance();
const testUtils = require('../../test/utils');

const { env: { adminKey } } = process;

describe('user: booking search', () => {
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
    if (!userAppKeys.map(e => e.integrationId).includes(newApp.name)) {
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
      url: `/bookings/${appKey}/${userId}/search`,
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

  it('should be able to search a for a booking product', async () => {
    const payload = {};
    const { products } = await doApiPost({
      url: `/products/${appKey}/${userId}/search`,
      token: userToken,
      payload,
    });
    expect(plugins[0].searchProducts).toHaveBeenCalled();
    expect(Array.isArray(products)).toBeTruthy();
    expect(plugins[0].searchProducts.mock.calls[0][0].payload).toEqual(payload);
    expect(plugins[0].searchProducts.mock.calls[0][0].token).toEqual(token);

    // expect(Array.isArray(retVal.bookings)).toBeTruthy();
    // expect(retVal.bookings.length > 0).toBeTruthy();
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
      url: `/bookings/${appKey}/${userId}/availability`,
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
      url: `/bookings/${appKey}/${userId}/quote`,
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
      url: `/bookings/${appKey}/${userId}/booking`,
      token: userToken,
      payload,
    });
    expect(plugins[0].createBooking).toHaveBeenCalled();
    expect(plugins[0].createBooking.mock.calls[0][0].payload).toEqual(payload);
    expect(plugins[0].createBooking.mock.calls[0][0].token).toEqual(token);
  });
});
