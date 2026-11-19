/* globals beforeAll describe expect it jest */
const testUtils = require('../../test/utils');

// Provider-neutral booking-edit tools. Ti2 validates the generic contract, forwards the
// consultant's session at the payload root and keeps both out of its request log.
describe('booking tools route', () => {
  const appName = 'booking-tools-test';
  const hint = 'primary';
  let doApiPost;
  let createUserToken;
  let plugin;
  let userId;
  let integrationToken;

  beforeAll(async () => {
    const utils = await testUtils({ plugins: [appName] });
    ({ doApiPost, createUserToken } = utils);
    plugin = utils.plugins.find(item => item.name === appName);
    ({ userId, token: integrationToken } = await utils.appSetup({ appName, tokenHint: hint }));
  });

  const url = tool => `/booking-tools/${appName}/${userId}/${hint}/${tool}`;

  it('dispatches a read to the plugin with the request and the root-level session', async () => {
    plugin.listBookingReferenceData = jest.fn(async () => ({
      referenceData: { consultants: { values: [{ id: 'ER', label: 'Erica' }], total: 1 } },
    }));

    const result = await doApiPost({
      url: url('list_booking_reference_data'),
      token: createUserToken(userId),
      payload: {
        request: { categories: ['consultants'], query: 'eri' },
        credentials: { cookies: [{ name: 'session', value: 'secret' }] },
      },
    });

    expect(result).toEqual({
      referenceData: { consultants: { values: [{ id: 'ER', label: 'Erica' }], total: 1 } },
    });
    expect(plugin.listBookingReferenceData).toHaveBeenCalledWith(expect.objectContaining({
      token: integrationToken,
      userId,
      hint,
      payload: {
        categories: ['consultants'],
        query: 'eri',
        credentials: { cookies: [{ name: 'session', value: 'secret' }] },
      },
    }));
  });

  it('dispatches a write with the booking, the expected version and the batch', async () => {
    plugin.updateBookingServices = jest.fn(async () => ({
      outcome: 'completed', bookingId: '100', outcomes: [{ index: 0, targetId: '7', outcome: 'completed' }],
    }));

    const result = await doApiPost({
      url: url('update_booking_services'),
      token: createUserToken(userId),
      payload: {
        request: { bookingId: '100', expectedVersion: '3', updates: [{ serviceId: '7', quantity: 4 }] },
        credentials: { cookies: [{ name: 'session', value: 'secret' }] },
      },
    });

    expect(result.outcome).toBe('completed');
    expect(plugin.updateBookingServices).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        bookingId: '100',
        expectedVersion: '3',
        updates: [{ serviceId: '7', quantity: 4 }],
        credentials: { cookies: [{ name: 'session', value: 'secret' }] },
      },
    }));
  });

  it('rejects a host decision smuggled into a write', async () => {
    plugin.removeBookingServices = jest.fn();

    const result = await doApiPost({
      url: url('remove_booking_services'),
      token: createUserToken(userId),
      payload: { request: { bookingId: '100', expectedVersion: '3', serviceIds: [{ confirmed: true }] } },
      expectStatusCode: 400,
    });

    expect(result.message).toBe('confirmed is not part of the generic booking contract');
    expect(plugin.removeBookingServices).not.toHaveBeenCalled();
  });

  it('rejects a field that is not part of the tool contract', async () => {
    plugin.listBookingReferenceData = jest.fn();

    const result = await doApiPost({
      url: url('list_booking_reference_data'),
      token: createUserToken(userId),
      payload: { request: { categories: ['consultants'], bookingId: '100' } },
      expectStatusCode: 400,
    });

    expect(result.message).toBe('bookingId is not part of the list_booking_reference_data contract');
    expect(plugin.listBookingReferenceData).not.toHaveBeenCalled();
  });

  it('rejects provider payloads and process state anywhere in the request', async () => {
    plugin.listBookingReferenceData = jest.fn();

    const result = await doApiPost({
      url: url('list_booking_reference_data'),
      token: createUserToken(userId),
      payload: { request: { query: { naturalLanguage: 'everything' } } },
      expectStatusCode: 400,
    });

    expect(result.message).toBe('naturalLanguage is not part of the generic booking contract');
    expect(plugin.listBookingReferenceData).not.toHaveBeenCalled();
  });

  it.each([
    ['list_booking_reference_data', { categories: 'consultants' }, 'categories is not valid for list_booking_reference_data'],
    ['remove_booking_services', { bookingId: '100', serviceIds: ['7'] }, 'remove_booking_services needs expectedVersion'],
    ['update_booking_services', { bookingId: '100', expectedVersion: '3', updates: [] }, 'updates is not valid for update_booking_services'],
  ])('rejects a %s request that breaks the field types', async (tool, request, message) => {
    const result = await doApiPost({
      url: url(tool),
      token: createUserToken(userId),
      payload: { request },
      expectStatusCode: 400,
    });

    expect(result.message).toBe(message);
  });

  it.each(['constructor', '__proto__', 'toString'])('treats the inherited name %s as an unknown tool', async tool => {
    const result = await doApiPost({
      url: url(tool),
      token: createUserToken(userId),
      payload: { request: {} },
      expectStatusCode: 400,
    });

    expect(result.message).toBe(`Unknown booking tool: ${tool}`);
  });

  it('rejects an unknown tool', async () => {
    const result = await doApiPost({
      url: url('drop_all_bookings'),
      token: createUserToken(userId),
      payload: { request: {} },
      expectStatusCode: 400,
    });

    expect(result.message).toBe('Unknown booking tool: drop_all_bookings');
  });

  it('reports a tool the booking system does not support', async () => {
    delete plugin.listBookingReferenceData;

    const result = await doApiPost({
      url: url('list_booking_reference_data'),
      token: createUserToken(userId),
      payload: { request: {} },
      expectStatusCode: 501,
    });

    expect(result.message).toBe(`list_booking_reference_data is not supported by ${appName}`);
  });

  it('reports a booking system that is not installed', async () => {
    const result = await doApiPost({
      url: `/booking-tools/not-installed/${userId}/${hint}/list_booking_reference_data`,
      token: createUserToken(userId),
      payload: { request: {} },
      expectStatusCode: 404,
    });

    expect(result.message).toBe('Booking system not-installed is not available');
  });

  it('refuses a user token for another company', async () => {
    await doApiPost({
      url: url('list_booking_reference_data'),
      token: createUserToken('another-company'),
      payload: { request: {} },
      expectStatusCode: 401,
    });
  });

  it('keeps the session and request values out of the request log', async () => {
    plugin.listBookingReferenceData = jest.fn(async () => ({ referenceData: {} }));
    const events = [];
    const onRequestEnd = event => events.push(event);
    plugin.events.on('request.end', onRequestEnd);
    try {
      await doApiPost({
        url: url('list_booking_reference_data'),
        token: createUserToken(userId),
        payload: {
          request: { query: 'Jane Doe' },
          credentials: { cookies: [{ name: 'session', value: 'secret' }] },
        },
      });
    } finally {
      plugin.events.off('request.end', onRequestEnd);
    }

    expect(events).toHaveLength(1);
    expect(events[0].body).toEqual({ requestFields: ['query'], hasCredentials: true });
    expect(JSON.stringify(events[0])).not.toContain('secret');
    expect(JSON.stringify(events[0])).not.toContain('Jane Doe');
  });
});
