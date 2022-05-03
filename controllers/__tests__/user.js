/* globals describe it expect beforeAll, jest, afterEach */

const chance = require('chance').Chance();
const testUtils = require('../../test/utils');
const slugify = require('../../test/slugify');

const { env: { adminKey } } = process;

describe('user', () => {
  const appName = slugify(
    chance.company(),
  ).toLowerCase();
  const newApp = {
    name: appName,
    packageName: `ti2-${appName}`,
    adminEmail: chance.email(),
  };
  let doApiGet; let doApiPost; let
    doApiDelete;
  let appKey;
  const userId = chance.guid();
  let apiKey = chance.guid();
  // this token can be as rare as needed
  const token = {
    endpoint: chance.url(),
    apiKey,
  };
  beforeAll(async () => {
    ({
      doApiDelete,
      doApiGet,
      doApiPost,
    } = await testUtils({
      plugins: [appName],
    }));
    // create an App
    ({ value: appKey } = await doApiPost({
      url: '/app',
      token: adminKey,
      payload: newApp,
    }));
    const url = `/${appName}/${userId}`;
    await doApiPost({
      url,
      token: appKey,
      payload: {
        tokenHint: apiKey.split('-')[0],
        token,
      },
    });
  });
  let userKey;
  afterEach(() => jest.clearAllMocks());
  it('a user should be able to get a user token via an admin key', async () => {
    ({ value: userKey } = await doApiPost({
      url: '/user',
      token: adminKey,
      payload: {
        userId,
      },
    }));
    expect(userKey).toBeTruthy();
  });
  it('a user should be able to get a list of it\'s mapped apps', async () => {
    const { userAppKeys } = await doApiGet({
      token: userKey,
      url: `/user/${userId}/apps`,
    });
    expect(userAppKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hint: apiKey.split('-')[0],
          userId,
          integrationId: appName,
        }),
      ]),
    );
  });
  it('should be able to delete a user/app key', async () => {
    await doApiDelete({
      url: `/${appName}/${userId}`,
      token: userKey,
      payload: { tokenHint: apiKey.split('-')[0] },
    });
    const { userAppKeys } = await doApiGet({
      url: `/user/${userId}/apps`,
      token: userKey,
    });
    expect(userAppKeys).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          hint: apiKey.split('-')[0],
          userId,
          integrationId: appName,
        }),
      ]),
    );
  });
  it('should be able to create a user/app integration', async () => {
    // set up new token
    apiKey = chance.guid();
    token.apiKey = apiKey;
    await doApiPost({
      url: `/${appName}/${userId}`,
      token: userKey,
      payload: {
        tokenHint: apiKey.split('-')[0],
        token,
      },
    });
    // make sure the app token is there
    const { userAppKeys } = await doApiGet({
      url: `/user/${userId}/apps`,
      token: userKey,
    });
    expect(userAppKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hint: apiKey.split('-')[0],
          userId,
          integrationId: appName,
        }),
      ]),
    );
  });
  it('should be able to get all the methods for an app', async () => {
    const { methods } = await doApiGet({
      url: `/app/${appName}/methods`,
      token: userKey,
    });
    expect(methods).toEqual(
      expect.arrayContaining([
        'validateToken', 'getProduct',
      ]),
    );
  });
});
