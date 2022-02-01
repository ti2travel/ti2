/* globals describe it expect */

const chance = require('chance').Chance();
const testUtils = require('../../test/utils');

const { env: { adminKey } } = process;

describe('user: booking search', () => {
  const newApp = {
    name: 'travelgate',
    packageName: 'ti2-travelgate',
    adminEmail: 'engineering+travelgate@tourconnect.com',
  };
  let appKey = newApp.name;
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
  const {
    doApiDelete,
    doApiGet,
    doApiPost,
    plugins,
  } = testUtils({
    plugins: [newApp.name],
  });

  let userToken;
  it('drop any existing travelgateapp integration', async () => {
    await doApiDelete({
      url: `/travelgate/${userId}`,
      token: adminKey,
      payload: { tokenHint: 'testingToken' },
    });
  });
  it('create the travelgate app', async () => {
    // get the list of existing integrations
    const { integrations } = await doApiGet({
      url: '/apps',
      token: adminKey,
    });
    if (!integrations.map(e => e.name).includes(newApp.name)) {
      // creating the app
      ({ value: appKey } = await doApiPost({
        url: '/app',
        token: adminKey,
        payload: newApp,
      }));
      expect(appKey).toBe(newApp.name);
    }
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
  it('should be able to search a travel gate for a booking', async () => {
    const payload = {
      bookingId: '', supplierId: '', name: '',
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
});
