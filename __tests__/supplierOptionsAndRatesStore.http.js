const http = require('http');
const axios = require('axios');
const { createSupplierOptionsAndRatesStore } = require('../lib/tourplanNxSupplierOptionsAndRatesStore');

describe('supplier HTTP transport', () => {
  let server;
  let respond;
  let calls;
  let store;
  const version = '11111111-1111-4111-8111-111111111111';
  const value = { options: [], suppliers: [], version, fetchedAt: Date.now(), cacheTtlSeconds: 2764800 };
  const pointer = { version, body: { store: 's3', bucket: 'fixture', key: 'key' } };
  beforeAll(async () => {
    server = http.createServer((req, res) => { calls += 1; respond(req, res); });
    await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
    store = createSupplierOptionsAndRatesStore({ endpoint: `http://127.0.0.1:${server.address().port}`, authorization: 'test' });
  });
  beforeEach(() => { calls = 0; });
  afterAll(async () => { await new Promise(resolve => { server.close(resolve); }); });
  it('retries temporary errors twice then returns the body', async () => {
    respond = (_, res) => {
      res.writeHead(calls < 3 ? 503 : 200);
      res.end(calls < 3 ? '{}' : JSON.stringify(value));
    };
    expect(await store.get(pointer)).toEqual(value);
    expect(calls).toBe(3);
  });
  it('fails after three unavailable responses', async () => {
    respond = (_, res) => { res.writeHead(503); res.end('{}'); };
    await expect(store.get(pointer)).rejects.toMatchObject({ supplierOptionsAndRatesStoreError: true });
    expect(calls).toBe(3);
  });
  it('does not retry access denial', async () => {
    respond = (_, res) => { res.writeHead(403); res.end('{}'); };
    await expect(store.get(pointer)).rejects.toMatchObject({ status: 403, statusCode: 403 });
    expect(calls).toBe(1);
  });

  it('fails a retention configuration error after one HTTP upload attempt', async () => {
    respond = (_, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'SupplierRetentionNotConfigured' }));
    };
    await expect(store.put('products_v3_0123456789abcdef_SUP1', value)).rejects.toMatchObject({
      code: 'SupplierRetentionNotConfigured', status: 503,
    });
    expect(calls).toBe(1);
  });

  it.each(['get', 'size', 'put'])('preserves cancellation of an in-flight %s without a storage outage', async method => {
    let started;
    const reading = new Promise(resolve => { started = resolve; });
    respond = () => started();
    const controller = new AbortController();
    const pending = method === 'put'
      ? store.put('products_v3_0123456789abcdef_SUP1', value, controller.signal)
      : store[method](pointer, controller.signal);
    const failure = pending.catch(error => error);
    await reading;
    controller.abort();
    const error = await failure;
    expect(axios.isCancel(error)).toBe(true);
    expect(error.status).toBeUndefined();
    expect(error.supplierOptionsAndRatesStoreError).toBeUndefined();
    expect(calls).toBe(1);
  });
});
