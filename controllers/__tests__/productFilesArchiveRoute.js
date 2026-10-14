const request = require('supertest');
const testUtils = require('../../test/utils');

let app;
let createUserToken;
let appSetup;

beforeAll(async () => {
  ({ app, createUserToken, appSetup } = await testUtils({ plugins: ['tourplannx'], startServer: false }));
});

it('routes the projection version GET through auth and the plugin', async () => {
  const { userId, hint } = await appSetup({ appName: 'tourplannx' });
  const url = `/tourplannx/${userId}/${hint}/product-files-archive`;
  const plugin = app.plugins.find(item => item.name === 'tourplannx');
  plugin.getProductFilesProjectionVersion = jest.fn(() => 3);
  try {
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url)
      .set('Authorization', `Bearer ${createUserToken('another-company')}`)).status).toBe(401);
    const wrongApp = await request(app)
      .get(`/other-app/${userId}/${hint}/product-files-archive`)
      .set('Authorization', `Bearer ${createUserToken(userId)}`);
    expect(wrongApp.status).toBe(400);
    expect(wrongApp.body.message).toBe('Only TourPlan NX is supported');
    const unknownHint = await request(app)
      .get(`/tourplannx/${userId}/unknown-hint/product-files-archive`)
      .set('Authorization', `Bearer ${createUserToken(userId)}`);
    expect(unknownHint.status).toBe(404);
    expect(unknownHint.body.message).toBe('Integration not found');
    const authorized = await request(app).get(url)
      .set('Authorization', `Bearer ${createUserToken(userId)}`);
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({ projectionVersion: 3 });
    expect(plugin.getProductFilesProjectionVersion).toHaveBeenCalledTimes(1);
  } finally {
    delete plugin.getProductFilesProjectionVersion;
  }
});

it('authenticates before parsing a large archive request', async () => {
  const largeUsage = { option: { note: 'x'.repeat(1024 * 1024) } };
  const url = '/tourplannx/company/Live/product-files-archive';
  const requestEnds = [];
  const onRequestEnd = event => requestEnds.push(event);
  app.plugins[0].events.on('request.end', onRequestEnd);

  try {
    const unauthorized = await request(app).post(url)
      .send({ selection: 'usage', usage: largeUsage });
    expect(unauthorized.status).toBe(401);

    const authorized = await request(app).post(url)
      .set('Authorization', `Bearer ${process.env.adminKey}`)
      .send({ selection: 'usage', usage: largeUsage });
    expect(authorized.status).toBe(404);
    expect(authorized.body.message).toBe('Integration not found');
    expect(requestEnds).toHaveLength(1);
    expect(requestEnds[0].body).toEqual({ selection: 'usage', usageHash: undefined, usageCount: 1 });
  } finally {
    app.plugins[0].events.off('request.end', onRequestEnd);
  }
});

it('accepts a usage request above the former 16 MiB parser limit', async () => {
  const largeUsage = { option: { note: 'x'.repeat(17 * 1024 * 1024) } };
  const response = await request(app).post('/tourplannx/company/Live/product-files-archive')
    .set('Authorization', `Bearer ${process.env.adminKey}`)
    .send({ selection: 'usage', usage: largeUsage });
  expect(response.status).toBe(404);
  expect(response.body.message).toBe('Integration not found');
}, 30000);

it('rejects a user token for another company before parsing the archive body', async () => {
  const response = await request(app).post('/tourplannx/company/Live/product-files-archive')
    .set('Authorization', `Bearer ${createUserToken('another-company')}`)
    .send({ selection: 'all' });
  expect(response.status).toBe(401);
});
