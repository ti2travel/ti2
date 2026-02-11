/* globals describe it expect beforeAll, jest, afterEach */

const R = require('ramda');
const chance = require('chance').Chance();
const request = require('supertest');
const slugify = require('../../test/slugify');

const { env: { adminKey } } = process;

describe('user', () => {
  const testUtils = require('../../test/utils');
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
  let app;
  let sqldb;
  let appKey;
  const userId = chance.guid();
  let apiKey = chance.guid();
  // this token can be as rare as needed
  const token = {
    endpoint: chance.url(),
    apiKey,
  };
  let plugins;
  beforeAll(async () => {
    ({
      app,
      sqldb,
      doApiDelete,
      doApiGet,
      doApiPost,
      plugins,
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
  it('should be able to get the app\'s token template', async () => {
    const { template } = await doApiGet({
      url: `/app/${appName}/tokenTemplate`,
      token: userKey,
      payload: {},
    });
    expect(template).toBeTruthy();
    expect(R.path(['apiKey', 'regExp', 'source'], template)).toBeTruthy();
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
  const apiKey2 = chance.guid();
  const token2 = { ...token };
  it('create a second token', async () => {
    // set up new token
    await doApiPost({
      url: `/${appName}/${userId}`,
      token: userKey,
      payload: {
        tokenHint: apiKey2.split('-')[1],
        token: token2,
      },
    });
  });
  it('should be able to read a user/app token', async () => {
    const returnValue = await doApiGet({
      url: `/${appName}/${userId}/token`,
      token: userKey,
    });
    expect(returnValue.token).toEqual(token);
  });
  it('should be able to read the second user/app token by hint', async () => {
    const returnValue = await doApiGet({
      url: `/${appName}/${userId}/${apiKey2.split('-')[1]}/token`,
      token: userKey,
    });
    expect(returnValue.token).toEqual(token2);
  });
  it('should return a preflight response for token endpoint', async () => {
    const response = await request(app)
      .options(`/${appName}/${userId}/token`)
      .set('Origin', 'https://tcoutlook.tourconnect.dev')
      .set('Access-Control-Request-Method', 'GET');
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeTruthy();
  });
  it('should keep returning 404 for a missing token hint', async () => {
    const missingHint = chance.guid();
    const returnValue = await doApiGet({
      url: `/${appName}/${userId}/${missingHint}/token`,
      token: userKey,
      expectStatusCode: 404,
    });
    expect(returnValue.message).toContain('User integratio is not found');
  });
  it('should be able to create an app setting', async () => {
    const returnValue = await doApiPost({
      url: `/settings/${appName}/${userId}`,
      token: userKey,
      payload: {
        settings: {
          custom: true,
        },
      },
    });
    expect(returnValue.success).toBe(true);
  });
  it('should be able to get an app settings', async () => {
    const returnValue = await doApiGet({
      url: `/settings/${appName}/${userId}`,
      token: userKey,
    });
    expect(returnValue.settings.custom).toBe(true);
  });
  it('testing the user token should include the user app setting', async () => {
    const { valid } = await doApiPost({
      url: `/${appName}/${userId}/validate`,
      token: userKey,
      payload: {
        tokenHint: apiKey.split('-')[0],
      },
    });
    expect(plugins[0].validateToken).toHaveBeenCalled();
    expect(valid).toBe(true);
    expect(plugins[0].validateToken.mock.calls[0][0].token).toEqual({ custom: true, ...token });
  });
  it('should be able to delete an app settings', async () => {
    const returnValue = await doApiDelete({
      url: `/settings/${appName}/${userId}`,
      token: userKey,
    });
    expect(returnValue.success).toBe(true);
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
  it('should return 422 when stored app token is corrupted', async () => {
    await sqldb.query(
      'UPDATE UserAppKeys SET appKey = :appKey WHERE integrationId = :integrationId AND userId = :userId',
      {
        replacements: {
          appKey: 'corrupted-token-without-delimiter',
          integrationId: appName,
          userId,
        },
      },
    );
    const returnValue = await doApiGet({
      url: `/${appName}/${userId}/token`,
      token: userKey,
      expectStatusCode: 422,
    });
    expect(returnValue.message).toBe('Stored integration token is invalid. Please re-save credentials.');
  });
  it('should return 422 when stored app token is corrupted for hinted endpoint', async () => {
    const returnValue = await doApiGet({
      url: `/${appName}/${userId}/${apiKey2.split('-')[1]}/token`,
      token: userKey,
      expectStatusCode: 422,
    });
    expect(returnValue.message).toBe('Stored integration token is invalid. Please re-save credentials.');
  });
});
