const request = require('supertest');
const chance = require('chance').Chance();
const cache = require('../../cache');
const testUtils = require('../../test/utils');

jest.mock('../../worker/queue', () => ({
  ...jest.requireActual('../../worker/queue'),
  addJob: jest.fn().mockResolvedValue('synthetic-job'),
}));

const { addJob } = require('../../worker/queue');
const credentials = { cookies: [{ name: 'session', value: 'synthetic-cookie' }] };
let app;
let plugin;
let userId;
let hint;

beforeAll(async () => {
  const utils = await testUtils({ plugins: ['tourplannx'], startServer: false });
  app = utils.app;
  plugin = app.plugins.find(item => item.name === 'tourplannx');
  ({ userId, hint } = await utils.appSetup({
    appName: 'tourplannx',
    userId: `credential-search-${chance.guid()}`,
    tokenDataParam: { endpoint: 'https://example.test', apiKey: 'synthetic-key' },
    tokenHint: 'synthetic-desk',
  }));
  plugin.cacheSettings = { bookingsSearch: { cacheInMiddleware: true } };
});

beforeEach(() => {
  jest.clearAllMocks();
  plugin.searchItineraries = jest.fn().mockResolvedValue({ bookings: [] });
});

it('keeps credential searches synchronous and uncached without recording payload values', async () => {
  const events = [];
  const capture = event => events.push(event);
  const create = jest.spyOn(plugin.axios, 'create');
  const get = jest.spyOn(cache, 'get');
  const save = jest.spyOn(cache, 'save');
  plugin.events.on('request.start', capture);
  plugin.events.on('request.end', capture);
  try {
    const response = await request(app)
      .post(`/bookings/tourplannx/${userId}/${hint}/search`)
      .set('Authorization', `Bearer ${process.env.adminKey}`)
      .send({ credentials, bookingId: 'synthetic-reference', backgroundJob: true,
        callbackUrl: 'https://example.test/hook' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ bookings: [] });
    expect(plugin.searchItineraries).toHaveBeenCalledTimes(1);
    expect(plugin.searchItineraries.mock.calls[0][0].payload.credentials).toEqual(credentials);
    expect(create).toHaveBeenCalledTimes(1);
    expect(plugin.searchItineraries.mock.calls[0][0].axios).toBe(create.mock.results[0].value);
    expect(addJob).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(events).toHaveLength(2);
    events.forEach(event => expect(event.body).toEqual({ hasCredentials: true }));
    expect(JSON.stringify(events)).not.toMatch(/synthetic-cookie|synthetic-reference|example.test\/hook/);
  } finally {
    plugin.events.off('request.start', capture);
    plugin.events.off('request.end', capture);
    get.mockRestore();
    save.mockRestore();
    create.mockRestore();
  }
});

it('redacts credential-bearing provider errors', async () => {
  plugin.searchItineraries.mockRejectedValue(Object.assign(new Error('synthetic-cookie'), {
    isAxiosError: true,
    config: { headers: { Cookie: 'synthetic-cookie' } },
    response: { status: 401, data: 'synthetic-cookie' },
  }));
  const response = await request(app)
    .post(`/bookings/tourplannx/${userId}/${hint}/search`)
    .set('Authorization', `Bearer ${process.env.adminKey}`)
    .send({ credentials, bookingId: 'synthetic-reference' });
  expect(response.status).toBe(401);
  expect(JSON.stringify(response.body)).not.toContain('synthetic-cookie');
});

it('preserves background search behavior without inline credentials', async () => {
  const response = await request(app)
    .post(`/bookings/tourplannx/${userId}/${hint}/search`)
    .set('Authorization', `Bearer ${process.env.adminKey}`)
    .send({ bookingId: 'synthetic-reference', backgroundJob: true });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ jobId: 'synthetic-job' });
  expect(addJob).toHaveBeenCalledTimes(1);
  expect(plugin.searchItineraries).not.toHaveBeenCalled();
});
