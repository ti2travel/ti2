/* globals beforeAll describe expect it */

const chance = require('chance').Chance();

describe('provider-neutral booking tools controller', () => {
  const testUtils = require('../../test/utils');
  const appKey = 'booking-tools-test';
  const userId = `booking-tools-${chance.guid()}`;
  const hint = 'primary';
  const token = { endpoint: 'https://example.test' };
  let doApiPost;
  let userToken;
  let plugins;

  beforeAll(async () => {
    const utils = await testUtils({ plugins: [appKey] });
    ({ doApiPost, plugins } = utils);
    userToken = utils.createUserToken(userId);
    await doApiPost({
      url: '/user',
      token: process.env.adminKey,
      payload: { userId, email: `${userId}@example.com` },
    });
    await doApiPost({
      url: `/${appKey}/${userId}`,
      token: userToken,
      payload: { tokenHint: hint, token },
    });
  });

  it('dispatches a read without exposing trusted runtime as public payload', async () => {
    const result = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/get_booking`,
      token: userToken,
      payload: {
        request: { bookingId: '100' },
        runtime: { credentials: { sessionValue: 'secret' } },
      },
    });

    expect(result).toEqual(expect.objectContaining({ bookingId: '100', version: '3' }));
    expect(plugins[0].getBooking).toHaveBeenCalledWith(expect.objectContaining({
      token,
      payload: {
        bookingId: '100',
        credentials: { sessionValue: 'secret' },
      },
    }));
  });

  it('enforces the expected version and records a conflict', async () => {
    const result = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/update_booking`,
      token: userToken,
      payload: {
        request: {
          bookingId: '100',
          expectedVersion: '2',
          patch: { name: 'Changed' },
        },
        runtime: { idempotencyKey: chance.guid() },
      },
    });

    expect(result).toEqual(expect.objectContaining({
      outcome: 'conflict',
      bookingId: '100',
      nextVersion: '3',
    }));
    expect(plugins[0].updateBooking).not.toHaveBeenCalled();
  });

  it('replays a completed write by idempotency key', async () => {
    const key = chance.guid();
    const payload = {
      request: {
        bookingId: '100',
        expectedVersion: '3',
        patch: { name: 'Changed' },
      },
      runtime: { idempotencyKey: key },
    };
    const first = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/update_booking`,
      token: userToken,
      payload,
    });
    const replay = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/update_booking`,
      token: userToken,
      payload,
    });

    expect(first.outcome).toBe('completed');
    expect(replay.operationId).toBe(first.operationId);
    expect(plugins[0].updateBooking).toHaveBeenCalledTimes(1);
  });

  it('redacts secrets from persisted operation records', async () => {
    const write = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/update_booking`,
      token: userToken,
      payload: {
        request: {
          bookingId: '100',
          expectedVersion: '3',
          patch: { consultant: 'TEST' },
        },
        runtime: {
          idempotencyKey: chance.guid(),
          credentials: { sessionValue: 'do-not-store' },
        },
      },
    });
    const operation = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/get_booking_operation`,
      token: userToken,
      payload: { request: { operationId: write.operationId } },
    });

    expect(JSON.stringify(operation)).not.toContain('do-not-store');
    expect(operation.outcome).toBe('completed');
  });

  it('rejects process and provider-specific fields at the generic boundary', async () => {
    const result = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/update_booking`,
      token: userToken,
      payload: {
        request: {
          bookingId: '100',
          expectedVersion: '3',
          patch: { naturalLanguage: 'change everything' },
        },
        runtime: { idempotencyKey: chance.guid() },
      },
      expectStatusCode: 400,
    });
    expect(result.error).toMatch(/naturalLanguage is not part of the generic booking contract/);
  });

  it('continues an authorization-gated write without accepting a public confirmation flag', async () => {
    plugins[0].getBooking.mockRejectedValueOnce(new Error('externalSessionRequired'));
    const pending = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/update_booking`,
      token: userToken,
      payload: {
        request: {
          bookingId: '100',
          expectedVersion: '3',
          patch: { name: 'After login' },
        },
        runtime: { idempotencyKey: chance.guid() },
      },
    });
    const continued = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/continue_booking_operation`,
      token: userToken,
      payload: {
        request: { operationId: pending.operationId },
        runtime: {},
      },
    });

    expect(pending.outcome).toBe('auth_required');
    expect(pending.inputRequest.type).toBe('external_session');
    expect(continued).toEqual(expect.objectContaining({
      operationId: pending.operationId,
      outcome: 'completed',
      bookingId: '100',
    }));
  });

  it('serializes concurrent writes with the same idempotency key', async () => {
    const callCount = plugins[0].updateBooking.mock.calls.length;
    plugins[0].updateBooking.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return { outcome: 'completed', changes: [] };
    });
    const key = chance.guid();
    const write = () => doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/update_booking`,
      token: userToken,
      payload: {
        request: {
          bookingId: '100',
          expectedVersion: '3',
          patch: { name: 'One write' },
        },
        runtime: { idempotencyKey: key },
      },
    });
    const [first, second] = await Promise.all([write(), write()]);

    expect(second.operationId).toBe(first.operationId);
    expect(plugins[0].updateBooking.mock.calls.length - callCount).toBe(1);
  });

  it('records provider validation failures without leaking secrets', async () => {
    plugins[0].updateBooking.mockRejectedValueOnce(
      new Error('Invalid status; secret=do-not-store'),
    );
    const result = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/update_booking`,
      token: userToken,
      payload: {
        request: {
          bookingId: '100',
          expectedVersion: '3',
          patch: { statusId: 'INVALID' },
        },
        runtime: { idempotencyKey: chance.guid() },
      },
    });
    const operation = await doApiPost({
      url: `/booking-tools/${appKey}/${userId}/${hint}/get_booking_operation`,
      token: userToken,
      payload: { request: { operationId: result.operationId } },
    });

    expect(result.outcome).toBe('failed');
    expect(JSON.stringify(operation)).not.toContain('do-not-store');
    expect(operation.error).toContain('secret=***');
  });
});
