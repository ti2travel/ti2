/* globals describe it expect beforeAll, afterAll */

const chance = require('chance').Chance();
const request = require('supertest');
const jwt = require('jwt-promise');

const app = require('../../index');
const sqldb = require('../../models/db');
const { slugify } = require('../../test/utils');

const { env: { adminKey, jwtSecret } } = process;

describe('app', () => {
  const appName = slugify(
    chance.company(),
  ).toLowerCase();
  const newApp = {
    name: appName,
    packageName: `ti2-${appName}`,
    adminEmail: chance.email(),
  };
  let appKey;
  const userId = chance.guid();
  const apiKey = chance.guid();
  // this token can be as long needed
  const token = {
    endpoint: chance.url(),
    apiKey,
  };
  const encodePayload = {
    payload: { lorem: chance.paragraph() },
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
    await sqldb.connectionManager.close();
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
