/* globals describe it expect */

const chance = require('chance').Chance();
const jwt = require('jwt-promise');
const testUtils = require('../../test/utils');
const slugify = require('../../test/slugify');

const { env: { adminKey, jwtSecret } } = process;

describe('app', () => {
  const appName = slugify(
    chance.company(),
  );
  const newApp = {
    name: appName,
    packageName: `ti2-${appName}`,
    adminEmail: chance.email(),
  };
  const { doApiPost, doApiGet, doApiPut } = testUtils({
    plugins: [appName],
  });
  let appKey;
  const userId = chance.guid();
  const apiKey = chance.guid();
  // this token can be as long needed
  const token = {
    endpoint: chance.url(),
    apiKey,
  };
  const encodePayload = {
    payload: { lorem: chance.paragraph() },
  };
  let encodedKey;
  it('should create a new app', async () => {
    ({ value: appKey } = await doApiPost({
      url: '/app',
      token: adminKey,
      payload: newApp,
    }));
    expect(appKey).toBeTruthy();
  });
  it('should encode an airbitrary object', async () => {
    ({ value: encodedKey } = await doApiPut({
      url: `/app/encode/${appName}`,
      token: appKey,
      payload: encodePayload,
    }));
    expect(encodedKey).toBeTruthy();
  });
  it('the encoded key should be decodable', async () => {
    const decoded = await jwt.verify(encodedKey, `${appName}.${jwtSecret}`);
    expect(decoded).toEqual(expect.objectContaining(encodePayload));
  });
  it('should be able to create a user token for the app', async () => {
    const { value } = await doApiPost({
      url: `/${appName}/${userId}`,
      token: appKey,
      payload: {
        tokenHint: apiKey.split('-')[0],
        token,
      },
    });
    expect(parseInt(value, 10)).toBeGreaterThan(0);
  });
  it('should be able to get a list of all tokens related to the app', async () => {
    const { userAppKeys } = await doApiGet({
      url: `/app/tokens/${appName}`,
      token: appKey,
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
});
