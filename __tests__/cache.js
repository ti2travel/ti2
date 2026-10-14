/* globals describe it expect beforeAll afterAll afterEach */

const cache = require('../cache');

describe('cache', () => {
  const testPluginName = 'testPlugin';
  const testKeys = [];

  afterEach(async () => {
    // Clean up test keys
    for (const key of testKeys) {
      await cache.drop({ pluginName: testPluginName, key });
    }
    testKeys.length = 0;
  });

  describe('saveVersioned', () => {
    it('rejects invalid TTLs before changing the catalog or version', async () => {
      const key = 'versioned:invalid-ttl';
      testKeys.push(key, `${key}:lastUpdated`, `${key}:version`);
      const first = await cache.saveVersioned({
        pluginName: testPluginName, key, value: { n: 1 }, ttl: 60,
      });
      for (const ttl of [0, 1.5]) {
        await expect(cache.saveVersioned({
          pluginName: testPluginName, key, value: { n: 2 }, ttl,
        })).rejects.toThrow('positive integer TTL');
      }
      expect(await cache.get({ pluginName: testPluginName, key })).toEqual({ n: 1 });
      expect(await cache.cache.get(`${testPluginName}:${key}:version`))
        .toBe(String(first.cacheVersion));
    });

    it('keeps versions increasing when time repeats or moves backwards', async () => {
      const key = 'versioned:test';
      const ttl = 60;
      testKeys.push(key, `${key}:lastUpdated`, `${key}:version`);
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now');
      let first;
      let second;
      let third;
      try {
        clock.mockReturnValue(now);
        first = await cache.saveVersioned({ pluginName: testPluginName, key, value: { n: 1 }, ttl });
        second = await cache.saveVersioned({ pluginName: testPluginName, key, value: { n: 2 }, ttl });
        clock.mockReturnValue(now - 1000);
        third = await cache.saveVersioned({ pluginName: testPluginName, key, value: { n: 3 }, ttl });
      } finally {
        clock.mockRestore();
      }

      expect(first.cacheVersion).toBeLessThan(second.cacheVersion);
      expect(second.cacheVersion).toBeLessThan(third.cacheVersion);
      expect(await cache.get({ pluginName: testPluginName, key })).toEqual({ n: 3 });
      expect(await cache.get({ pluginName: testPluginName, key: `${key}:lastUpdated` }))
        .toBe(now - 1000);
      for (const expiringKey of [key, `${key}:lastUpdated`]) {
        const remaining = await cache.cache.ttl(`${testPluginName}:${expiringKey}`);
        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThanOrEqual(ttl);
      }
      expect(await cache.cache.ttl(`${testPluginName}:${key}:version`)).toBe(-1);
    });
  });


  describe('saveIfNotExists', () => {
    it('should only save the first value for a key', async () => {
      const key = 'lock:test';
      testKeys.push(key);

      const firstSaved = await cache.saveIfNotExists({
        pluginName: testPluginName,
        key,
        value: { owner: 'first' },
        ttl: 60,
      });
      const secondSaved = await cache.saveIfNotExists({
        pluginName: testPluginName,
        key,
        value: { owner: 'second' },
        ttl: 60,
      });

      expect(firstSaved).toBe(true);
      expect(secondSaved).toBe(false);
      expect(await cache.get({ pluginName: testPluginName, key })).toEqual({ owner: 'first' });
    });
  });

  describe('owner-token helpers', () => {
    it('should only renew and drop a key when the expected value still owns it', async () => {
      const key = 'owner-lock:test';
      testKeys.push(key);

      await cache.save({ pluginName: testPluginName, key, value: 'owner-a', ttl: 1 });

      const renewedByWrongOwner = await cache.expireIfValue({
        pluginName: testPluginName,
        key,
        value: 'owner-b',
        ttl: 60,
      });
      const renewedByOwner = await cache.expireIfValue({
        pluginName: testPluginName,
        key,
        value: 'owner-a',
        ttl: 60,
      });
      const droppedByWrongOwner = await cache.dropIfValue({
        pluginName: testPluginName,
        key,
        value: 'owner-b',
      });

      expect(renewedByWrongOwner).toBe(false);
      expect(renewedByOwner).toBe(true);
      expect(droppedByWrongOwner).toBe(false);
      expect(await cache.get({ pluginName: testPluginName, key })).toBe('owner-a');

      const droppedByOwner = await cache.dropIfValue({
        pluginName: testPluginName,
        key,
        value: 'owner-a',
      });
      expect(droppedByOwner).toBe(true);
      expect(await cache.get({ pluginName: testPluginName, key })).toBeFalsy();
    });
  });

  describe('scan', () => {
    it('should return keys matching the pattern without plugin prefix', async () => {
      // Save some test keys
      const keys = ['product:123', 'product:456', 'booking:789'];
      for (const key of keys) {
        testKeys.push(key);
        await cache.save({ pluginName: testPluginName, key, value: { test: true } });
      }

      // Scan for product keys
      const result = await cache.scan({ pluginName: testPluginName, pattern: 'product:*' });

      expect(result).toHaveLength(2);
      expect(result).toContain('product:123');
      expect(result).toContain('product:456');
      expect(result).not.toContain('booking:789');
    });

    it('should return empty array when no keys match', async () => {
      const result = await cache.scan({ pluginName: testPluginName, pattern: 'nonexistent:*' });

      expect(result).toEqual([]);
    });

    it('should not include keys from other plugins', async () => {
      const otherPluginName = 'otherPlugin';

      // Save keys for both plugins
      await cache.save({ pluginName: testPluginName, key: 'shared:key1', value: { test: true } });
      await cache.save({ pluginName: otherPluginName, key: 'shared:key2', value: { test: true } });
      testKeys.push('shared:key1');

      // Scan should only return keys for the specified plugin
      const result = await cache.scan({ pluginName: testPluginName, pattern: 'shared:*' });

      expect(result).toHaveLength(1);
      expect(result).toContain('shared:key1');
      expect(result).not.toContain('shared:key2');

      // Cleanup other plugin key
      await cache.drop({ pluginName: otherPluginName, key: 'shared:key2' });
    });

    it('should handle wildcard patterns correctly', async () => {
      const keys = ['cache:v1:product:1', 'cache:v1:product:2', 'cache:v2:product:1'];
      for (const key of keys) {
        testKeys.push(key);
        await cache.save({ pluginName: testPluginName, key, value: { test: true } });
      }

      // Scan with nested wildcard
      const result = await cache.scan({ pluginName: testPluginName, pattern: 'cache:v1:*' });

      expect(result).toHaveLength(2);
      expect(result).toContain('cache:v1:product:1');
      expect(result).toContain('cache:v1:product:2');
    });
  });
});
