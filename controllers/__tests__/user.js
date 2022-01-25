/* globals describe it expect beforeAll, afterAll, jest */

const faker = require('faker');
const request = require('supertest');
const { getRequireMocks } = require('../../../test/utils');
const app = require('../../../app');
const sqldb = require('../../../models');

const { env: { adminKey } } = process;

describe('user', () => {
  const appName = faker.helpers.slugify(
    faker.company.companyName(),
  ).toLowerCase();
  const newApp = {
    name: appName,
    packageName: `ti2-${appName}`,
    adminEmail: faker.internet.email(),
  };
  let appKey;
  const userId = faker.random.uuid();
  let apiKey = faker.random.uuid();
  // this token can be as rare as needed
  const token = {
    endpoint: faker.internet.url(),
    apiKey,
  };
  beforeAll(async () => {
    // create an App
    const resp = await request(app)
      .post('/app')
      .set('Authorization', `Bearer ${adminKey}`)
      .send(newApp);
    expect(resp.statusCode).toBe(200);
    expect(resp.body.value).toBeTruthy();
    appKey = resp.body.value;
    // create an App+User Mapping
    await request(app)
      .post(`/${appName}/${userId}`)
      .set('Authorization', `Bearer ${appKey}`)
      .send({
        tokenHint: apiKey.split('-')[0],
        token,
      });
  });
  let userKey;
  afterAll(async () => {
    await sqldb.sequelize.connectionManager.close();
  });
  afterEach(() => jest.clearAllMocks());
  it('a user should be able to get a user token via an admin key', async () => {
    const resp = await request(app)
      .post('/user')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({
        value: userId,
      });
    expect(resp.body.value).toBeTruthy();
    userKey = resp.body.value;
  });
  it('a user should be able to get a list of it\'s mapped apps', async () => {
    const resp = await request(app)
      .get(`/user/${userId}/apps`)
      .set('Authorization', `Bearer ${userKey}`);
    expect(resp.statusCode).toBe(200);
    expect(resp.body.userAppKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hint: apiKey.split('-')[0],
          userId,
          integrationId: appName,
        }),
      ]),
    );
  });
  it('should be able to delete a user/app key', async () => {
    const resp = await request(app)
      .delete(`/${appName}/${userId}`)
      .set('Authorization', `Bearer ${userKey}`)
      .send({ tokenHint: apiKey.split('-')[0] });
    expect(resp.statusCode).toBe(200);
    // make sure the app token is NOT there
    const respList = await request(app)
      .get(`/user/${userId}/apps`)
      .set('Authorization', `Bearer ${userKey}`);
    expect(respList.statusCode).toBe(200);
    expect(respList.body.userAppKeys).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          hint: apiKey.split('-')[0],
          userId,
          integrationId: appName,
        }),
      ]),
    );
  });
  it('should be able to create a user/app integration', async () => {
    // set up new token
    apiKey = faker.random.uuid();
    token.apiKey = apiKey;
    const resp = await request(app)
      .post(`/${appName}/${userId}`)
      .set('Authorization', `Bearer ${userKey}`)
      .send({
        tokenHint: apiKey.split('-')[0],
        token,
      });
    expect(resp.statusCode).toBe(200);
    // make sure the app token is there
    const respList = await request(app)
      .get(`/user/${userId}/apps`)
      .set('Authorization', `Bearer ${userKey}`);
    expect(respList.statusCode).toBe(200);
    expect(respList.body.userAppKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hint: apiKey.split('-')[0],
          userId,
          integrationId: appName,
        }),
      ]),
    );
  });
  it('should be able to get all the methods for an app', async () => {
    getRequireMocks({ jest, app: newApp });
    const methods = await request(app)
      .get(`/app/${appName}/methods`)
      .set('Authorization', `Bearer ${userKey}`);
    expect(methods.statusCode).toBe(200);
    expect(methods.body.methods).toEqual(
      expect.arrayContaining([
        'validateToken', 'getProduct',
      ]),
    );
  });
});
