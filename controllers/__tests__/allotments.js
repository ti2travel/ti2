/* globals beforeAll describe it expect */

const chance = require('chance').Chance();
const testUtils = require('../../test/utils');

const { env: { adminKey } } = process;

describe('allotment', () => {
  const newApp = {
    name: 'tourplantest',
    packageName: 'ti2-tourplanTest',
    adminEmail: 'engineering+tourplantest@tourconnect.com',
  };
  const appKey = newApp.name;
  const userId = '551394be5ac58e5c76000019';
  const token = {
    endpoint: 'https://someendpoint.com',
    username: chance.guid(),
    password: chance.string(),
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
      plugins: [appKey],
    }));
  });

  let userToken;
  it('drop any existing user integration', async () => {
    try {
      await doApiDelete({
        url: `/${appKey}/${userId}`,
        token: adminKey,
        payload: { tokenHint: newIntegration.tokenHint },
      });
    } catch (err) {
      // console.debug(err);
    }
  });
  it('create the user', async () => {
    ({ value: userToken } = await doApiPost({
      url: '/user',
      token: adminKey,
      payload: { userId },
    }));
    expect(userToken).toBeTruthy();
  });
  it('create the App+User setup', async () => {
    const { userAppKeys } = await doApiGet({
      url: `/user/${userId}/apps`,
      token: userToken,
    });
    if (!userAppKeys.map(e => e.integrationId).includes(appKey)) {
      // relation does not exits
      const { value } = await doApiPost({
        url: `/${appKey}/${userId}`,
        token: userToken,
        payload: newIntegration,
      });
      expect(value).toBeTruthy();
    }
  });
  it('should be able to get some allotments', async () => {
    const payload = {
      dateFormat: 'DD-MM-YYYY',
      startDate: '01-12-2022',
      endDate: '15-12-2022',
      keyPath: `${chance.guid()}|${chance.guid()}`,
    };
    const urlParams = new URLSearchParams(payload).toString();
    const { allotments } = await doApiGet({
      url: `/allotment/${appKey}/${userId}?${urlParams}`,
      token: userToken,
      payload,
    });
    expect(plugins[0].queryAllotment).toHaveBeenCalled();
    expect(Array.isArray(allotments)).toBeTruthy();
    const call = plugins[0].queryAllotment.mock.calls[0][0];
    expect(call.payload).toEqual(payload);
    expect(call.token).toEqual(token);
  });
});
