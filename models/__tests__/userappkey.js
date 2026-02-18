/* globals describe it expect */
const { UserAppKey } = require('../index');

describe('UserAppKey.mergeTokenPayload', () => {
  it('uses appKey as base, then settings override same keys, then configuration', () => {
    const appKey = { endpoint: 'https://old.example.com', apiKey: 'secret' };
    const settings = { endpoint: 'https://updated.example.com', onlyInSettings: true };
    const configuration = { foo: 'bar' };

    const result = UserAppKey.mergeTokenPayload(appKey, settings, configuration);

    expect(result.endpoint).toBe('https://updated.example.com');
    expect(result.onlyInSettings).toBe(true);
    expect(result.apiKey).toBe('secret');
    expect(result.configuration).toEqual({ foo: 'bar' });
  });

  it('returns only appKey when settings and configuration are empty', () => {
    const appKey = { access_token: 'x', refresh_token: 'y' };
    const result = UserAppKey.mergeTokenPayload(appKey, {}, null);
    expect(result).toEqual({ access_token: 'x', refresh_token: 'y' });
  });

  it('strips empty and nil values from appKey', () => {
    const appKey = { a: 1, b: '', c: null, d: [] };
    const result = UserAppKey.mergeTokenPayload(appKey, {}, null);
    expect(result).toEqual({ a: 1 });
  });

  it('handles null/undefined appKey or settings', () => {
    expect(UserAppKey.mergeTokenPayload(null, { x: 1 }, null)).toEqual({ x: 1 });
    expect(UserAppKey.mergeTokenPayload({ a: 1 }, null, null)).toEqual({ a: 1 });
    expect(UserAppKey.mergeTokenPayload({}, {}, undefined)).toEqual({});
  });
});
