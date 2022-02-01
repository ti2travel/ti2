/* globals describe it expect afterAll */

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
  const { doApiPost, doApiGet } = testUtils({
    plugins: [appName],
  });
  let appKey;
  const userId = '536830b6ed19afa44a000002';
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
    expect(integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining(newApp),
      ]),
    );
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
});
