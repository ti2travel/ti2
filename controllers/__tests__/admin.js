/* globals beforeAll describe it expect */

const chance = require('chance').Chance();
const testUtils = require('../../test/utils');
const slugify = require('../../test/slugify');

const { env: { adminKey } } = process;

describe('admin', () => {
  const appName = slugify(
    chance.company(),
  );
  const newApp = {
    name: appName,
    packageName: `ti2-${appName}`,
    adminEmail: chance.email(),
  };
  let appKey;
  const userId = '536830b6ed19afa44a000002';
  let doApiPost; let
    doApiGet;
  beforeAll(async () => {
    ({
      doApiGet,
      doApiPost,
    } = await testUtils({
      plugins: [appName],
    }));
  });
  it('should be able to create an app', async () => {
    ({ value: appKey } = await doApiPost({
      url: '/app',
      token: adminKey,
      payload: newApp,
    }));
    expect(appKey).toBeTruthy();
  });
  it('the created app should be on the list of apps', async () => {
    const { integrations } = await doApiGet({
      url: '/apps',
      token: adminKey,
    });
    expect(integrations.find(({ name }) => name === newApp.name)).toBeTruthy();
  });
  it('should be able to reset an app\'s key', async () => {
    const url = `/app/resetAppKey/${newApp.name}`;
    const { value } = await doApiGet({
      url,
      token: adminKey,
    });
    expect(value).toBeTruthy();
    expect(value).not.toBe(appKey);
  });
  it('should be able to create a new user authentication token', async () => {
    const { value } = await doApiPost({
      url: '/user',
      token: adminKey,
      payload: { userId },
    });
    expect(value).toBeTruthy();
  });
  it('the created user should be on the user list', async () => {
    const { users } = await doApiGet({
      url: '/users',
      token: adminKey,
    });
    expect(users.find(currentUser => currentUser.userId === userId)).toBeTruthy();
  });
});
