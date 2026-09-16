/* globals afterAll beforeEach describe expect it jest */

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../worker/queue', () => ({ removeJob: jest.fn() }));
jest.mock('../../models', () => ({
  sequelize: {
    transaction: jest.fn(callback => callback({ LOCK: { UPDATE: 'UPDATE' } })),
  },
  User: { findOne: jest.fn() },
  UserAppKey: {
    count: jest.fn(),
    destroy: jest.fn(),
    findOne: jest.fn(),
  },
  UserIntegrationSettings: { destroy: jest.fn() },
  CronJobs: { findAll: jest.fn() },
  IntegrationLifecycle: {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  },
}));

const axios = require('axios');
const sqldb = require('../../models');
const { removeJob } = require('../../worker/queue');
const {
  activateCatalog,
  completeDeletion,
  deleteIntegration,
  prepareActivation,
} = require('../integrationLifecycle');

const originalPyfilematchUrl = process.env.PYFILEMATCH_URL;

const lifecycleRecord = overrides => ({
  userId: 'company-a',
  integrationId: 'tourplan',
  hint: 'Desk A',
  generation: 1,
  status: 'active',
  requestId: 'request-1',
  requestedAt: new Date('2026-09-14T20:00:00.000Z'),
  updatedAt: new Date(),
  retryCount: 0,
  save: jest.fn().mockResolvedValue(),
  get: jest.fn(function get() {
    return {
      userId: this.userId,
      integrationId: this.integrationId,
      hint: this.hint,
      generation: this.generation,
      requestId: this.requestId,
      requestedAt: this.requestedAt,
      retryCount: this.retryCount,
      status: this.status,
      artifacts: this.artifacts,
    };
  }),
  ...overrides,
});

describe('integrationLifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PYFILEMATCH_URL = 'http://catalog.test';
    sqldb.User.findOne.mockResolvedValue({ userId: 'company-a' });
    sqldb.UserAppKey.destroy.mockResolvedValue(1);
    sqldb.UserAppKey.findOne.mockResolvedValue({ id: 1 });
    sqldb.UserAppKey.count.mockResolvedValue(0);
    sqldb.UserIntegrationSettings.destroy.mockResolvedValue(1);
    sqldb.CronJobs.findAll.mockResolvedValue([]);
    sqldb.IntegrationLifecycle.update.mockResolvedValue([1]);
    axios.post.mockResolvedValue({ data: { status: 'deleted' } });
  });

  afterAll(() => {
    if (originalPyfilematchUrl === undefined) {
      delete process.env.PYFILEMATCH_URL;
    } else {
      process.env.PYFILEMATCH_URL = originalPyfilematchUrl;
    }
  });

  it('serializes a re-add behind a failed or active deletion', async () => {
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycleRecord({ status: 'failed' }));

    await expect(prepareActivation({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      transaction: { LOCK: { UPDATE: 'UPDATE' } },
    })).rejects.toMatchObject({ status: 409 });
  });

  it('assigns a new generation before reactivating a removed integration', async () => {
    const lifecycle = lifecycleRecord({ status: 'complete', generation: 4 });
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);

    const result = await prepareActivation({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      transaction: { LOCK: { UPDATE: 'UPDATE' } },
    });

    expect(result.generation).toBe(5);
    expect(result.status).toBe('provisioning');
    expect(result.artifacts).toEqual({ requiresCatalogActivation: true });
    expect(lifecycle.save).toHaveBeenCalled();
  });

  it('cleans exact schedules, credentials, final-hint settings, and catalog state', async () => {
    const lifecycle = lifecycleRecord();
    const schedule = { bullJobId: 'repeat:exact:123', destroy: jest.fn().mockResolvedValue() };
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);
    sqldb.CronJobs.findAll
      .mockResolvedValueOnce([schedule])
      .mockResolvedValueOnce([schedule]);

    const result = await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
      deferCompletion: true,
    });

    expect(sqldb.CronJobs.findAll).toHaveBeenCalledWith({
      where: {
        userId: 'company-a',
        hint: 'Desk A',
        pluginName: 'tourplan',
      },
      transaction: expect.any(Object),
      lock: 'UPDATE',
    });
    expect(removeJob).toHaveBeenCalledWith('repeat:exact:123');
    expect(schedule.destroy).toHaveBeenCalled();
    expect(sqldb.UserAppKey.destroy).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'company-a',
        integrationId: 'tourplan',
        hint: 'Desk A',
      },
    }));
    expect(sqldb.UserIntegrationSettings.destroy).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'company-a', integrationId: 'tourplan' },
    }));
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/productSync/integration-lifecycle'),
      {
        action: 'delete',
        companyId: 'company-a',
        integrationId: 'tourplan',
        hint: 'Desk A',
        generation: 2,
      },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual(expect.objectContaining({
      status: 'external_cleanup',
      generation: 2,
      requestId: expect.any(String),
      retryCount: 0,
    }));
  });

  it('blocks deletion while integration schedule provisioning is in progress', async () => {
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycleRecord({
      status: 'provisioning',
    }));

    await expect(deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('recovers stale provisioning by advancing the deletion generation', async () => {
    const lifecycle = lifecycleRecord({
      status: 'provisioning',
      generation: 3,
      updatedAt: new Date(Date.now() - 10 * 60e3),
    });
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);

    const result = await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    });

    expect(result).toEqual(expect.objectContaining({ generation: 4, status: 'complete' }));
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ action: 'delete', generation: 4 }),
      expect.any(Object),
    );
  });

  it('returns 404 without creating lifecycle or catalog work for an unknown hint', async () => {
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(null);
    sqldb.UserAppKey.findOne.mockResolvedValue(null);

    await expect(deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Unknown desk',
      requestedBy: 'user-a',
    })).rejects.toMatchObject({ status: 404 });

    expect(sqldb.IntegrationLifecycle.create).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it.each([
    ['superseded', 409],
    ['retry', 503],
    ['unexpected', 502],
  ])('maps catalog activation status %s to HTTP %i', async (status, expectedStatus) => {
    axios.post.mockResolvedValueOnce({ data: { status } });

    await expect(activateCatalog(lifecycleRecord()))
      .rejects.toMatchObject({ status: expectedStatus });
  });

  it('maps the catalog retry HTTP response to a retryable activation error', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 409, data: { status: 'retry', generation: 1 } },
    });

    await expect(activateCatalog(lifecycleRecord()))
      .rejects.toMatchObject({ status: 503 });
  });

  it('advances the generation before deleting after a timed-out activation', async () => {
    const lifecycle = lifecycleRecord({
      status: 'failed_activation',
      generation: 3,
    });
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);

    const result = await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    });

    expect(result.generation).toBe(4);
    expect(result.status).toBe('complete');
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ generation: 4 }),
      expect.any(Object),
    );
  });

  it('keeps the cleanup request identity and increments retries for incomplete work', async () => {
    const lifecycle = lifecycleRecord({
      status: 'failed',
      generation: 3,
      requestId: 'original-request',
      retryCount: 2,
    });
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);

    const result = await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    });

    expect(result).toEqual(expect.objectContaining({
      generation: 3,
      requestId: 'original-request',
      retryCount: 3,
    }));
  });

  it('returns the persisted terminal state when another delete wins completion', async () => {
    const lifecycle = lifecycleRecord();
    const persisted = lifecycleRecord({
      generation: 2,
      status: 'external_cleanup',
      artifacts: { catalog: { status: 'deleted' } },
    });
    sqldb.IntegrationLifecycle.findOne
      .mockResolvedValueOnce(lifecycle)
      .mockResolvedValueOnce(persisted);
    sqldb.IntegrationLifecycle.update
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([0]);

    const result = await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
      deferCompletion: false,
    });

    expect(result.status).toBe('external_cleanup');
  });

  it('persists completed artifact counts and the failure stage for a retry', async () => {
    const lifecycle = lifecycleRecord();
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);
    axios.post.mockRejectedValueOnce(new Error('catalog unavailable'));

    await expect(deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('product catalog cleanup'),
    });

    expect(sqldb.IntegrationLifecycle.update).toHaveBeenLastCalledWith({
      status: 'failed',
      artifacts: {
        credentials: 1,
        cronJobs: 0,
        settings: 1,
        failureStage: 'product catalog cleanup',
      },
      lastError: 'catalog unavailable',
    }, expect.any(Object));
  });

  it('records completed schedule cleanup when credential cleanup fails', async () => {
    const lifecycle = lifecycleRecord();
    const schedule = { bullJobId: 'repeat:exact:123', destroy: jest.fn().mockResolvedValue() };
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);
    sqldb.CronJobs.findAll
      .mockResolvedValueOnce([schedule])
      .mockResolvedValueOnce([schedule]);
    sqldb.UserAppKey.destroy.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('credential and settings cleanup'),
    });

    expect(sqldb.IntegrationLifecycle.update).toHaveBeenLastCalledWith({
      status: 'failed',
      artifacts: {
        cronJobs: 1,
        failureStage: 'credential and settings cleanup',
      },
      lastError: 'database unavailable',
    }, expect.any(Object));
  });

  it('skips catalog lifecycle calls when no service is configured', async () => {
    delete process.env.PYFILEMATCH_URL;
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycleRecord());

    const result = await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    });

    expect(axios.post).not.toHaveBeenCalled();
    expect(result.artifacts.catalog).toEqual(expect.objectContaining({
      status: 'deleted',
      skipped: true,
      reason: 'catalog_lifecycle_not_configured',
    }));
  });

  it('resumes external cleanup without reopening completed TI2 stages', async () => {
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycleRecord({
      status: 'external_cleanup',
      generation: 2,
      artifacts: { catalog: { status: 'deleted' } },
    }));

    const result = await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
      deferCompletion: true,
    });

    expect(result.status).toBe('external_cleanup');
    expect(sqldb.IntegrationLifecycle.update).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('finalizes the matching generation and records external cleanup artifacts', async () => {
    const lifecycle = lifecycleRecord({
      status: 'external_cleanup',
      generation: 2,
      artifacts: { credentials: 1 },
    });
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);

    const result = await completeDeletion({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      generation: 2,
      externalArtifacts: { partnerMappings: 1 },
    });

    expect(lifecycle.status).toBe('complete');
    expect(lifecycle.artifacts).toEqual({
      credentials: 1,
      external: { partnerMappings: 1 },
    });
    expect(lifecycle.save).toHaveBeenCalled();
    expect(result.status).toBe('complete');
  });

  it('preserves shared integration settings while another hint remains', async () => {
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycleRecord());
    sqldb.UserAppKey.count.mockResolvedValue(1);

    await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    });

    expect(sqldb.UserIntegrationSettings.destroy).not.toHaveBeenCalled();
  });

  it('keeps a legacy shared Bull schedule while another database reference remains', async () => {
    const lifecycle = lifecycleRecord();
    const schedule = { bullJobId: 'repeat:shared:123', destroy: jest.fn().mockResolvedValue() };
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycle);
    sqldb.CronJobs.findAll
      .mockResolvedValueOnce([schedule])
      .mockResolvedValueOnce([schedule, { bullJobId: schedule.bullJobId }]);

    await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    });

    expect(removeJob).not.toHaveBeenCalled();
    expect(schedule.destroy).toHaveBeenCalled();
  });

  it('returns a completed tombstone without repeating downstream cleanup', async () => {
    sqldb.IntegrationLifecycle.findOne.mockResolvedValue(lifecycleRecord({
      status: 'complete',
      generation: 2,
    }));

    const result = await deleteIntegration({
      userId: 'company-a',
      integrationId: 'tourplan',
      hint: 'Desk A',
      requestedBy: 'user-a',
    });

    expect(result.status).toBe('complete');
    expect(removeJob).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });
});
