/* global beforeAll, describe, it, expect */

describe('ping', () => {
  const testUtils = require('../../test/utils');
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
