const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const { createSupplierOptionsAndRatesStore, getSupplierOptionsAndRatesStore } = require('../lib/tourplanNxSupplierOptionsAndRatesStore');

const endpoint = 'http://filematch.test/internal/ti2/supplier-options-and-rates';
const version = '11111111-1111-4111-8111-111111111111';
const value = { version, fetchedAt: Date.now(), cacheTtlSeconds: 2764800, options: [], suppliers: [] };
const pointer = { version, fetchedAt: value.fetchedAt, cacheTtlSeconds: value.cacheTtlSeconds,
  body: { store: 's3', bucket: 'fixture', key: `tourplannx/products_v3/0123456789abcdef/SUP1/${version}.json`,
    byteLength: Buffer.byteLength(JSON.stringify(value)) } };

describe('Filematch supplier storage client', () => {
  let mock;
  let store;
  beforeEach(() => {
    mock = new MockAdapter(axios);
    store = createSupplierOptionsAndRatesStore({ endpoint, authorization: 'service-token', writesEnabled: true });
  });
  afterEach(() => mock.restore());

  it('uploads raw bytes through Filematch and returns its pointer', async () => {
    mock.onPost(`${endpoint}/objects`).reply(config => {
      expect(config.headers.Authorization).toBe('service-token');
      expect(config.headers['Content-Type']).toBe('application/octet-stream');
      expect(JSON.parse(config.data)).toEqual(value);
      expect(config.params.cacheKey).toBe('products_v3_0123456789abcdef_SUP1');
      return [200, pointer];
    });
    expect(await store.put('products_v3_0123456789abcdef_SUP1', value)).toEqual(pointer);
    expect(await store.size(pointer)).toBe(pointer.body.byteLength);
  });

  it.each(['', '{', '{}', JSON.stringify({ ...value, options: null }),
    JSON.stringify({ ...value, version: 'another' })])('rejects malformed body %s', async raw => {
    mock.onGet(`${endpoint}/objects`).reply(200, Buffer.from(raw));
    expect(await store.get(pointer)).toBeNull();
  });

  it('reads complete bodies with empty options arrays', async () => {
    mock.onGet(`${endpoint}/objects`).reply(200, Buffer.from(JSON.stringify(value)));
    expect(await store.get(pointer)).toEqual(value);
  });

  it('distinguishes a missing object from an unavailable Filematch route', async () => {
    mock.onGet().replyOnce(404, Buffer.from(JSON.stringify({ code: 'SupplierOptionsAndRatesMissing' })));
    expect(await store.get(pointer)).toBeNull();
    mock.onGet().replyOnce(404, Buffer.from('Cannot GET /objects'));
    await expect(store.get(pointer)).rejects.toMatchObject({ supplierOptionsAndRatesStoreError: true, statusCode: 404 });
  });

  it('uses structured headers to recognize a missing HEAD response', async () => {
    mock.onHead().reply(404, '', { 'x-supplier-options-and-rates-missing': 'true' });
    const old = { ...pointer, body: { ...pointer.body, byteLength: undefined } };
    expect(await store.size(old)).toBeNull();
  });

  it('does not retry service authorization or underlying S3 access failures', async () => {
    mock.onGet().replyOnce(401);
    await expect(store.get(pointer)).rejects.toMatchObject({ status: 401, statusCode: 401 });
    mock.onGet().replyOnce(503, Buffer.from(JSON.stringify({ storageStatus: 403 })));
    await expect(store.get(pointer)).rejects.toMatchObject({ status: 403, statusCode: 403 });
    expect(mock.history.get).toHaveLength(2);
  });

  it.each([503, 404])('does not retry a retention configuration error (storage status %s)', async status => {
    mock.onPost().reply(503, { code: 'SupplierRetentionNotConfigured', storageStatus: status });
    await expect(store.put('products_v3_0123456789abcdef_SUP1', value)).rejects.toMatchObject({
      code: 'SupplierRetentionNotConfigured', status: 503, statusCode: status,
    });
    expect(mock.history.post).toHaveLength(1);
  });

  it('reports an undeployed cleanup route as a deployment error without retrying', async () => {
    mock.onHead(`${endpoint}/status`).reply(404);
    await expect(store.checkAvailability()).rejects.toMatchObject({
      code: 'SupplierOptionsAndRatesRouteUnavailable', status: 502, statusCode: 404,
    });
    expect(mock.history.head).toHaveLength(1);
    expect(mock.history.delete).toHaveLength(0);
  });

  it('does not retry a permanent retention configuration failure', async () => {
    mock.onPost().reply(503, { code: 'SupplierRetentionNotConfigured' });
    await expect(store.put('products_v3_0123456789abcdef_SUP1', value)).rejects.toMatchObject({
      code: 'SupplierRetentionNotConfigured', statusCode: 503,
      supplierOptionsAndRatesStoreError: true,
    });
    expect(mock.history.post).toHaveLength(1);
  });

  it('paginates cleanup and rechecks ownership before retrying an HTTP mutation', async () => {
    const guard = jest.fn().mockResolvedValue();
    mock.onDelete(`${endpoint}/hashes/0123456789abcdef`).replyOnce(503)
      .onDelete(`${endpoint}/hashes/0123456789abcdef`).replyOnce(200, { continuationToken: 'next' })
      .onDelete(`${endpoint}/hashes/0123456789abcdef`).replyOnce(200, { continuationToken: null });
    await store.deletePrefixes(['products_v3_0123456789abcdef'], guard);
    expect(guard).toHaveBeenCalledTimes(3);
    expect(mock.history.delete[2].params.continuationToken).toBe('next');
  });

  it('stops cleanup when ownership is lost between retries', async () => {
    mock.onDelete().reply(503);
    const guard = jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('lost'));
    await expect(store.deletePrefixes(['products_v3_0123456789abcdef'], guard)).rejects.toThrow('lost');
    expect(mock.history.delete).toHaveLength(1);
  });

  it('requires the existing Filematch connection when writes are enabled', () => {
    const names = ['ti2_events2url_eventsURL', 'TI2_SUPPLIER_OPTIONS_AND_RATES_WRITES'];
    const saved = names.map(name => process.env[name]);
    try {
      delete process.env.ti2_events2url_eventsURL;
      process.env.TI2_SUPPLIER_OPTIONS_AND_RATES_WRITES = 'true';
      expect(() => getSupplierOptionsAndRatesStore()).toThrow('Filematch service connection');
    } finally {
      names.forEach((name, index) => {
        if (saved[index] === undefined) delete process.env[name];
        else process.env[name] = saved[index];
      });
    }
  });
});
