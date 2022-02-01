/* global describe, it, expect */

const { doApiGet } = require('../../test/utils')();

describe('ping', () => {
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
