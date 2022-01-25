/* globals describe it expect afterAll */

const faker = require('faker');
const request = require('supertest');
const app = require('../../../app');
const sqldb = require('../../../models');

const { env: { adminKey } } = process;

describe('admin', () => {
  const appName = faker.helpers.slugify(
    faker.company.companyName(),
  );
  const newApp = {
    name: appName,
    packageName: `ti2-${appName}`,
    adminEmail: faker.internet.email(),
  };
  let appKey;
  const userId = '536830b6ed19afa44a000002';
  afterAll(async () => {
    await sqldb.sequelize.connectionManager.close();
  });
  it('should be able to create an app', async () => {
    const resp = await request(app)
      .post('/app')
      .set('Authorization', `Bearer ${adminKey}`)
      .send(newApp);
    expect(resp.statusCode).toBe(200);
    expect(resp.body.value).toBeTruthy();
    appKey = resp.body.value;
  });
  it('the created app should be on the list of apps', async () => {
    const resp = await request(app)
      .get('/apps')
      .set('Authorization', `Bearer ${adminKey}`);
    expect(resp.statusCode).toBe(200);
    const { body: { integrations } } = resp;
    expect(integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining(newApp),
      ]),
    );
  });
  it('should be able to reset an app\'s key', async () => {
    const url = `/app/resetAppKey/${newApp.name}`;
    const resp = await request(app)
      .get(url)
      .set('Authorization', `Bearer ${adminKey}`);
    expect(resp.statusCode).toBe(200);
    const { body: { value } } = resp;
    expect(value).toBeTruthy();
    expect(value).not.toBe(appKey);
  });
  it.skip('should be able to create a new user authentication token', async () => {
    const resp = await request(app).post('/user')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({ userId });
    expect(resp.statusCode).toBe(200);
  });
});
