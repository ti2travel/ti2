/* globals describe it expect beforeAll, afterAll */

const faker = require('faker');
const request = require('supertest');
const jwt = require('jwt-promise');
const app = require('../../../app');
const sqldb = require('../../../models');

const { env: { adminKey, jwtSecret } } = process;

describe('app', () => {
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
  const apiKey = faker.random.uuid();
  // this token can be as long needed
  const token = {
    endpoint: faker.internet.url(),
    apiKey,
  };
  const encodePayload = {
    payload: { lorem: faker.lorem.paragraph() },
  };
  let encodedKey;
  beforeAll(async () => {
    const resp = await request(app)
      .post('/app')
      .set('Authorization', `Bearer ${adminKey}`)
      .send(newApp);
    expect(resp.statusCode).toBe(200);
    expect(resp.body.value).toBeTruthy();
    appKey = resp.body.value;
  });
  afterAll(async () => {
    await sqldb.sequelize.connectionManager.close();
  });
  it('should encode an airbitrary object', async () => {
    const resp = await request(app)
      .put(`/app/encode/${appName}`)
      .set('Authorization', `Bearer ${appKey}`)
      .send({ payload: encodePayload });
    expect(resp.statusCode).toBe(200);
    expect(resp.body.value).toBeTruthy();
    encodedKey = resp.body.value;
  });
  it('the encoded key should be decodable', async () => {
    const decoded = await jwt.verify(encodedKey, `${appName}.${jwtSecret}`);
    expect(decoded.payload).toEqual(expect.objectContaining(encodePayload));
  });
  it('should be able to create a user token for the app', async () => {
    const resp = await request(app)
      .post(`/${appName}/${userId}`)
      .set('Authorization', `Bearer ${appKey}`)
      .send({
        tokenHint: apiKey.split('-')[0],
        token,
      });
    expect(resp.statusCode).toBe(200);
  });
  it('should be able to get a list of all tokens related to the app', async () => {
    const resp = await request(app)
      .get(`/app/tokens/${appName}`)
      .set('Authorization', `Bearer ${appKey}`);
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
});
