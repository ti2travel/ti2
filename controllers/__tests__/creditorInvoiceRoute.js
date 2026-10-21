const request = require('supertest');
const testUtils = require('../../test/utils');

let app;
let createUserToken;

beforeAll(async () => {
  ({ app, createUserToken } = await testUtils({ plugins: ['tourplannx'], startServer: false }));
  const plugin = app.plugins.find(item => item.name === 'tourplannx');
  plugin.createCreditorInvoice = jest.fn();
  plugin.checkCreditorInvoice = jest.fn();
});

it.each(['', '/status'])('redacts invoice credentials in request events for %s', async suffix => {
  const events = [];
  const onRequestEnd = event => events.push(event);
  const plugin = app.plugins.find(item => item.name === 'tourplannx');
  plugin.events.on('request.end', onRequestEnd);
  try {
    const response = await request(app)
      .post(`/invoices/tourplannx/company/unknown-hint${suffix}`)
      .set('Authorization', `Bearer ${process.env.adminKey}`)
      .send({ credentials: { cookies: [{ name: 'session', value: 'secret' }] },
        invoice: { lines: [{}] } });
    expect(response.status).toBe(404);
    expect(events).toHaveLength(1);
    expect(events[0].body).toEqual({ lineCount: 1 });
  } finally {
    plugin.events.off('request.end', onRequestEnd);
  }
});

it.each(['', '/status'])('rejects a missing token for %s', async suffix => {
  const response = await request(app)
    .post(`/invoices/tourplannx/company/unknown-hint${suffix}`)
    .send({ invoice: { lines: [{}] } });
  expect(response.status).toBe(401);
});

it.each(['', '/status'])('rejects a user token for another company for %s', async suffix => {
  const response = await request(app)
    .post(`/invoices/tourplannx/company/unknown-hint${suffix}`)
    .set('Authorization', `Bearer ${createUserToken('another-company')}`)
    .send({ credentials: { cookies: [{ value: 'secret' }] }, invoice: { lines: [{}] } });
  expect(response.status).toBe(401);
});

it('lets the matching user token reach the integration lookup', async () => {
  const response = await request(app)
    .post('/invoices/tourplannx/company/unknown-hint')
    .set('Authorization', `Bearer ${createUserToken('company')}`)
    .send({ invoice: { lines: [{}] } });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ message: 'Tourplan NX integration not found' });
});

it('handles invoice control fields in the controller and keeps credentials out of the log', async () => {
  const events = [];
  const onRequestEnd = event => events.push(event);
  const plugin = app.plugins.find(item => item.name === 'tourplannx');
  plugin.events.on('request.end', onRequestEnd);
  try {
    const response = await request(app)
      .post('/invoices/tourplannx/company/unknown-hint')
      .set('Authorization', `Bearer ${process.env.adminKey}`)
      .send({
        credentials: { cookies: [{ name: 'session', value: 'secret' }] },
        invoice: { lines: [{}] },
        backgroundJob: true,
        callbackUrl: 'https://example.test/hook',
      });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Tourplan NX integration not found' });
    expect(events).toHaveLength(1);
    expect(events[0].body).toEqual({ lineCount: 1 });
    expect(JSON.stringify(events[0])).not.toContain('secret');
  } finally {
    plugin.events.off('request.end', onRequestEnd);
  }
});
