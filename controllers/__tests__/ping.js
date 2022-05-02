/* global describe, it, expect */
const testUtils = require('../../test/utils');

describe('ping', () => {
  let doApiGet;
  beforeAll(async () => {
    ({
      doApiGet,
    } = await testUtils());
  });
  it('should get a server pong', async () => {
    const response = await doApiGet({
      url: '/ping',
    });
    expect(Object.keys(response))
      .toEqual(expect.arrayContaining([
        'name',
        'description',
        'version',
        'uptime',
      ]));
  });
});
