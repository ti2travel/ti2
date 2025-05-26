/* globals beforeAll describe it expect */
const chance = require('chance').Chance();
const R = require('ramda');

const testUtils = require('../../test/utils');
const slugify = require('../../test/slugify');
let appController = require('../app');

const { env: { adminKey } } = process;

describe('cronjobs', () => {
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
  let doApiDelete;
  let appKey;
  const userId = chance.guid();
  const operationId = 'queryAllotment';
  const cron = '0 0 * * *';
  let bullJobId;

  beforeAll(async () => {
    ({ doApiPost, doApiGet, doApiDelete } = await testUtils({
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

  it('should create a new cronjob', async () => {
    const response = await doApiPost({
      url: `/cronjobs/${appName}/${userId}`,
      token: appKey,
      payload: {
        operationId,
        cron,
        payload: {
          startDate: '01/04/2023',
          endDate: '03/04/2023',
          keyPath: 'MAGLUX|7CQLDACMAGLUXDELSUI',
        },
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        pluginName: appName,
        userId,
        operationId,
        cron,
      }),
    );
    bullJobId = response.bullJobId;
    expect(bullJobId).toBeTruthy();
  });

  it('should list cronjobs', async () => {
    const { jobs } = await doApiGet({
      url: `/cronjobs/${appName}/${userId}`,
      token: appKey,
    });

    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: appName,
          userId,
          operationId,
          cron,
          bullJobId,
        }),
      ]),
    );
  });

  it('should delete a cronjob', async () => {
    const response = await doApiDelete({
      url: `/cronjobs/${appName}/${userId}/${bullJobId}`,
      token: appKey,
    });

    expect(response).toEqual({ success: true });

    // Verify it's deleted
    const { jobs } = await doApiGet({
      url: `/cronjobs/${appName}/${userId}`,
      token: appKey,
    });

    expect(jobs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bullJobId,
        }),
      ]),
    );
  });

  it('should fail to create cronjob with invalid operationId', async () => {
    try {
      await doApiPost({
        url: `/cronjobs/${appName}/${userId}`,
        token: appKey,
        payload: {
          operationId: 'invalidOperation',
          cron,
        },
      });
      throw new Error('Should have failed');
    } catch (error) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.message).toContain("Invalid operationId: 'invalidOperation' not found");
    }
  });

  it('should fail to delete non-existent cronjob', async () => {
    try {
      await doApiDelete({
        url: `/cronjobs/${appName}/${userId}/nonexistent`,
        token: appKey,
      });
      throw new Error('Should have failed');
    } catch (error) {
      expect(error.response.status).toBe(404);
      expect(error.response.data.message).toBe('Cronjob not found');
    }
  });
});
