/* globals beforeAll describe it expect */
const chance = require('chance').Chance();
const jwt = require('jwt-promise');
const R = require('ramda');

const testUtils = require('../../test/utils');
const slugify = require('../../test/slugify');
let appController = require('../app');

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
  let doApiPost;
  let doApiGet;
  let doApiPut;
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
  beforeAll(async () => {
    ({ doApiPost, doApiGet, doApiPut } = await testUtils({
      plugins: [appName],
    }));
    appController = appController([appName]);
  });
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
  it('should be able to test a user token for the app', async () => {
    const { valid } = await doApiPost({
      url: `/${appName}/${userId}/validate`,
      token: appKey,
      payload: {
        tokenHint: apiKey.split('-')[0],
        token,
      },
    });
    expect(valid).toBe(true);
  });
  describe('jobs', () => {
    it('the scheduled job should have been created for the user', async () => {
      const jobs = R.path(
        ['jobs'],
        await appController.getAppScheduledJobs({
          integrationId: appName,
          userId,
        }),
      );
      expect(Array.isArray(jobs)).toBeTruthy();
      expect(R.head(R.project(['pluginJobId', 'cron'], jobs)))
        .toEqual({
          pluginJobId: 'dailyReport',
          cron: '0 9 * * *',
        });
    });
    it.todo('if a new version of the plugin has a different set of scheduled tasks, they shoul dbe re-syncjed');
    let jobId;
    it('should be able to run a job', async () => {
      let status;
      ({ jobId, status } = await doApiPost({
        url: `/${appName}/${userId}/jobRun`,
        token: appKey,
        payload: {
          payload: {
            method: 'dailyReport',
          },
        },
      }));
      expect(jobId).toBeTruthy();
      expect(status).toBeTruthy();
    });
    it('should be able to get the status of a ran job', async () => {
      await global.sleep(5e3);
      const url = `/${appName}/${userId}/${jobId}/jobStatus`;
      const jobStatus = await doApiGet({
        url,
        token: appKey,
        payload: {},
      });
      expect(jobStatus.jobId).toBeTruthy();
      expect(jobStatus.status).toBe('success');
      expect(jobStatus.result).toEqual({ someVal: true });
    }, 6e3);
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
