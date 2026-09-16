/* globals afterAll afterEach beforeEach describe expect it jest */

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../worker/queue', () => ({ removeJob: jest.fn() }));

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const sqldb = require('../../models');
const { removeJob } = require('../../worker/queue');
const { deleteIntegration } = require('../integrationLifecycle');

const originalPyfilematchUrl = process.env.PYFILEMATCH_URL;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe('integrationLifecycle database transitions', () => {
  let userId;
  const hint = 'Shared desk';

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.PYFILEMATCH_URL = 'http://catalog.test';
    userId = `tc-1460-${uuidv4()}`;
    await sqldb.User.create({ userId });
  });

  afterEach(async () => {
    await sqldb.CronJobs.destroy({ where: { userId } });
    await sqldb.UserAppKey.destroy({ where: { userId } });
    await sqldb.UserIntegrationSettings.destroy({ where: { userId } });
    await sqldb.IntegrationLifecycle.destroy({ where: { userId } });
    await sqldb.User.destroy({ where: { userId } });
  });

  afterAll(() => {
    if (originalPyfilematchUrl === undefined) {
      delete process.env.PYFILEMATCH_URL;
    } else {
      process.env.PYFILEMATCH_URL = originalPyfilematchUrl;
    }
  });

  it('removes only schedules owned by the deleted integration', async () => {
    await sqldb.CronJobs.bulkCreate([
      {
        pluginName: 'tourplan',
        pluginJobId: 'dailyReport',
        userId,
        hint,
        bullJobId: 'repeat:tourplan:1',
        cron: '0 9 * * *',
      },
      {
        pluginName: 'sellouts',
        pluginJobId: 'dailyReport',
        userId,
        hint,
        bullJobId: 'repeat:sellouts:1',
        cron: '0 9 * * *',
      },
    ]);
    axios.post.mockResolvedValue({ data: { status: 'deleted' } });

    await deleteIntegration({
      userId,
      integrationId: 'tourplan',
      hint,
      requestedBy: 'user:test',
    });

    expect(removeJob).toHaveBeenCalledTimes(1);
    expect(removeJob).toHaveBeenCalledWith('repeat:tourplan:1');
    expect(await sqldb.CronJobs.count({
      where: { userId, hint, pluginName: 'tourplan' },
    })).toBe(0);
    expect(await sqldb.CronJobs.count({
      where: { userId, hint, pluginName: 'sellouts' },
    })).toBe(1);
  });

  it('does not let a late failure overwrite external cleanup', async () => {
    const successfulCatalog = deferred();
    const failedCatalog = deferred();
    const successfulCatalogCalled = deferred();
    const failedCatalogCalled = deferred();
    axios.post
      .mockImplementationOnce(() => {
        successfulCatalogCalled.resolve();
        return successfulCatalog.promise;
      })
      .mockImplementationOnce(() => {
        failedCatalogCalled.resolve();
        return failedCatalog.promise;
      });

    const successfulDeletion = deleteIntegration({
      userId,
      integrationId: 'tourplan',
      hint,
      requestedBy: 'user:first',
      deferCompletion: true,
    });
    await successfulCatalogCalled.promise;
    const failedDeletion = deleteIntegration({
      userId,
      integrationId: 'tourplan',
      hint,
      requestedBy: 'user:second',
      deferCompletion: true,
    });
    await failedCatalogCalled.promise;

    successfulCatalog.resolve({ data: { status: 'deleted' } });
    await expect(successfulDeletion).resolves.toEqual(expect.objectContaining({
      status: 'external_cleanup',
    }));
    failedCatalog.reject(new Error('catalog unavailable'));
    await expect(failedDeletion).rejects.toMatchObject({ status: 503 });

    const lifecycle = await sqldb.IntegrationLifecycle.findOne({
      where: { userId, integrationId: 'tourplan', hint },
    });
    expect(lifecycle.status).toBe('external_cleanup');
  });

  it('lets a successful concurrent attempt recover a failed attempt', async () => {
    const failedCatalog = deferred();
    const successfulCatalog = deferred();
    const failedCatalogCalled = deferred();
    const successfulCatalogCalled = deferred();
    axios.post
      .mockImplementationOnce(() => {
        failedCatalogCalled.resolve();
        return failedCatalog.promise;
      })
      .mockImplementationOnce(() => {
        successfulCatalogCalled.resolve();
        return successfulCatalog.promise;
      });

    const failedDeletion = deleteIntegration({
      userId,
      integrationId: 'tourplan',
      hint,
      requestedBy: 'user:first',
      deferCompletion: true,
    });
    await failedCatalogCalled.promise;
    const successfulDeletion = deleteIntegration({
      userId,
      integrationId: 'tourplan',
      hint,
      requestedBy: 'user:second',
      deferCompletion: true,
    });
    await successfulCatalogCalled.promise;

    failedCatalog.reject(new Error('catalog unavailable'));
    await expect(failedDeletion).rejects.toMatchObject({ status: 503 });
    successfulCatalog.resolve({ data: { status: 'deleted' } });
    await expect(successfulDeletion).resolves.toEqual(expect.objectContaining({
      status: 'external_cleanup',
    }));

    const lifecycle = await sqldb.IntegrationLifecycle.findOne({
      where: { userId, integrationId: 'tourplan', hint },
    });
    expect(lifecycle.status).toBe('external_cleanup');
  });
});
