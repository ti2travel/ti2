/* global describe, it, expect */

// const should = require('should');
const request = require('supertest');
const server = require('../../index');

describe('ping', () => {
  it('should get a server pong', async () => {
    const response = await request(server)
      .get('/ping')
      .set('Accept', 'application/json');
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.statusCode).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(Object.keys(response.body))
      .toEqual(expect.arrayContaining([
        'name',
        'description',
        'version',
        'uptime',
      ]));
  });
});
