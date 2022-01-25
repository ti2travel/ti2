/* globals describe it expect */

const { doApiGet, doApiPost } = require('../../test/utils');

const { env: { adminKey } } = process;

const newApp = {
  name: 'travelgate',
  packageName: 'ti2-travelgate',
  adminEmail: 'engineering+travelgate@tourconnect.com',
};
const appKey = newApp.name;
const userId = '551394be5ac58e5c76000019';
const newIntegration = {
  tokenHint: 'testingToken',
  token: {
    endpoint: 'https://api.travelgatex.com',
    apiKey: '8ca687f8-7968-4331-7b1a-dfcb276e5e44',
    client: 'tourconnect',
  },
};

describe('user: booking search', () => {
  let userToken;
  it('create the travelgate app', async () => {
    // create the travelgate app
    // get the list of existing
    const { integrations } = await doApiGet({
      url: '/apps',
      token: adminKey,
    });
    if (!integrations.map(e => e.name).includes(newApp.name)) {
      // creating the app
      const { value: appKey } = await doApiPost({
        url: '/app',
        token: adminKey,
        payload: newApp,
      });
      expect(appKey).toBeTruthy();
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
    const retVal = await doApiPost({
      url: `/bookings/${appKey}/${userId}/search`,
      token: userToken,
      payload: {
        bookingId: '', supplierId: '', name: '',
      },
    });
    expect(Array.isArray(retVal.bookings)).toBeTruthy();
    expect(retVal.bookings.length > 0).toBeTruthy();
  });
});
