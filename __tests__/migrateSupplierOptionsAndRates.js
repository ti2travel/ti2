const { cache: redis } = require('../cache');
const { migrateSupplierOptionsAndRates } = require('../lib/migrateSupplierOptionsAndRates');

describe('supplier options and rates migration', () => {
  const prefix = 'tourplannx:products_v3_0123456789abcdef_';
  const key = `${prefix}MIGRATION`;
  const value = { options: [{ description: 'x'.repeat(32000) }], suppliers: [],
    version: '11111111-1111-4111-8111-111111111111', fetchedAt: Date.now(), cacheTtlSeconds: 2764800 };
  const pointer = { version: value.version, body: { store: 's3', key: 'test' } };
  let store;
  const keys = [key, `${prefix}all`, `${prefix}services`, `${prefix}POINTER`];
  beforeEach(async () => {
    await redis.del(...keys);
    await redis.set(key, JSON.stringify(value), 'PX', 60000);
    store = { writesEnabled: true, put: jest.fn(async () => pointer) };
  });
  afterEach(async () => { await redis.del(...keys); });

  // Keep the fixture isolated from other development catalogs without flushing Redis.
  const fixtureRedis = () => ({ get: (...args) => redis.get(...args),
    pttl: (...args) => redis.pttl(...args), memory: (...args) => redis.memory(...args),
    eval: (...args) => redis.eval(...args),
    scan: async () => ['0', keys] });
  const run = () => migrateSupplierOptionsAndRates({ redis: fixtureRedis(), store, apply: true });

  it('copies only legacy supplier options and rates and preserves the absolute expiry', async () => {
    await redis.set(`${prefix}all`, JSON.stringify(value), 'EX', 60);
    await redis.set(`${prefix}services`, '{}', 'EX', 60);
    await redis.set(`${prefix}POINTER`, JSON.stringify(pointer), 'EX', 60);
    const before = await redis.pttl(key);
    store.put.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return pointer;
    });
    const result = await run();
    expect(JSON.parse(await redis.get(key))).toEqual(pointer);
    const remaining = await redis.pttl(key);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(before - 80);
    expect(result).toMatchObject({ copied: 1, skipped: 3, conflicts: 0 });
    expect(result.bytesReleased).toBeGreaterThan(30000);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it('counts corrupt JSON without blocking valid suppliers later in the scan', async () => {
    await redis.set(key, '{broken', 'EX', 60);
    await redis.set(`${prefix}POINTER`, JSON.stringify(value), 'EX', 60);
    const result = await run();
    expect(result).toMatchObject({ corrupt: 1, skipped: 3, copied: 1 });
    expect(await redis.get(key)).toBe('{broken');
    expect(JSON.parse(await redis.get(`${prefix}POINTER`))).toEqual(pointer);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it.each(['deleted', 'expired', 'changed'])('does not overwrite a %s key during upload', async change => {
    store.put.mockImplementation(async () => {
      if (change === 'changed') await redis.set(key, 'new supplier', 'EX', 60);
      else if (change === 'expired') {
        await redis.pexpire(key, 1);
        await new Promise(resolve => setTimeout(resolve, 20));
      } else await redis.del(key);
      return pointer;
    });
    const result = await run();
    expect(result).toMatchObject({ copied: 0, conflicts: 1 });
    expect(await redis.get(key)).toBe(change === 'changed' ? 'new supplier' : null);
  });

  it('can be rerun without uploading an existing pointer', async () => {
    await run();
    store.put.mockClear();
    expect(await run()).toMatchObject({ copied: 0 });
    expect(store.put).not.toHaveBeenCalled();
  });

  it('does not mutate on dry run and stops on a storage error', async () => {
    await migrateSupplierOptionsAndRates({ redis: fixtureRedis(), store });
    expect(store.put).not.toHaveBeenCalled();
    store.put.mockRejectedValue(new Error('storage unavailable'));
    await expect(run()).rejects.toThrow('storage unavailable');
    expect(JSON.parse(await redis.get(key))).toEqual(value);
  });
});
