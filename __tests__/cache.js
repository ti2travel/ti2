/* globals describe it expect beforeAll afterAll afterEach */

const cache = require('../cache');
const productSearchCacheKey = require('../lib/productSearchCacheKey');

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

  describe('dropProductSearch', () => {
    const identity = { pluginName: testPluginName, userId: 'cleanup-company', hint: 'cleanup-desk' };
    const suffixes = ['', ':lastUpdated', ':version', ':sync-status', ':lock:outcome'];

    it('removes only this integration cache and preserves other companies, hints and plugins', async () => {
      const otherIdentities = [
        { ...identity, userId: 'other-company' },
        { ...identity, hint: 'other-desk' },
        { ...identity, pluginName: 'other-cleanup-plugin' },
      ];
      const entries = [identity, ...otherIdentities].flatMap(item => suffixes.map(suffix => ({
        pluginName: item.pluginName,
        key: `${productSearchCacheKey(item)}${suffix}`,
      })));
      entries.push({
        pluginName: identity.pluginName,
        key: `${productSearchCacheKey(identity)}:booking-details`,
      });
      try {
        await Promise.all(entries.map(entry => cache.save({ ...entry, value: 'retained' })));
        expect(await cache.dropProductSearch(identity)).toBe(suffixes.length);
        for (const entry of entries) {
          const target = entry.pluginName === identity.pluginName
            && suffixes.some(suffix => entry.key === `${productSearchCacheKey(identity)}${suffix}`);
          expect(await cache.get(entry)).toBe(target ? null : 'retained');
        }
        expect(await cache.dropProductSearch(identity)).toBe(0);
      } finally {
        await Promise.all(entries.map(entry => cache.drop(entry)));
      }
    });

    it('preserves the cache and writer lock until a running refresh finishes', async () => {
      const key = productSearchCacheKey(identity);
      const lockKey = `${key}:lock`;
      testKeys.push(key, lockKey);
      await cache.save({ ...identity, key, value: { products: ['product'] } });
      await cache.save({ ...identity, key: lockKey, value: 'refresh-owner' });
      expect(await cache.dropProductSearch(identity)).toBe(-1);
      expect(await cache.get({ ...identity, key })).toEqual({ products: ['product'] });
      expect(await cache.get({ ...identity, key: lockKey })).toBe('refresh-owner');
      await cache.dropIfValue({ ...identity, key: lockKey, value: 'refresh-owner' });
      expect(await cache.dropProductSearch(identity)).toBe(1);
    });

    it('lets the deletion owner clear keys without releasing its lock', async () => {
      const key = productSearchCacheKey(identity);
      const lockKey = `${key}:lock`;
      testKeys.push(key, lockKey);
      await cache.save({ ...identity, key, value: { products: ['product'] } });
      await cache.save({ ...identity, key: lockKey, value: 'deletion-owner' });
      expect(await cache.dropProductSearch({
        ...identity,
        lockOwnerToken: 'other-owner',
      })).toBe(-1);
      expect(await cache.get({ ...identity, key })).toEqual({ products: ['product'] });
      expect(await cache.dropProductSearch({
        ...identity,
        lockOwnerToken: 'deletion-owner',
      })).toBe(1);
      expect(await cache.get({ ...identity, key })).toBeNull();
      expect(await cache.get({ ...identity, key: lockKey })).toBe('deletion-owner');
    });
  });

  describe('dropMatching', () => {
    it('removes only keys under the requested credential prefixes', async () => {
      const pluginName = testPluginName;
      const owned = [
        'products_v3_e439f5ef1ae1e55a_SUP1',
        'products_v3_e439f5ef1ae1e55a_all',
        'products_v3_e439f5ef1ae1e55a_locations',
        'suppliers_e439f5ef1ae1e55a',
        'booking_statuses_e439f5ef1ae1e55a',
      ];
      const hashedSupplierKey = 'suppliers_cccccccccccccccc';
      const retained = [
        'products_v3_aaaaaaaaaaaaaaaa_SUP1',
        'suppliers_bbbbbbbbbbbbbbbb',
        productSearchCacheKey({ userId: 'cleanup-company', hint: 'cleanup-desk' }),
      ];
      const explicitEntries = [...owned, ...retained].map(key => ({ pluginName, key }));
      let hashedReads = 0;
      const hashedFn = async () => {
        hashedReads += 1;
        return 'hashed-supplier';
      };
      const readHashedSupplier = () => cache.getOrExec({
        pluginName,
        fnParams: [hashedSupplierKey],
        fn: hashedFn,
        ttl: 60,
      });
      try {
        await Promise.all(explicitEntries.map(entry => cache.save({ ...entry, value: 'cached' })));
        await cache.getOrExec({
          pluginName,
          key: 'suppliers_e439f5ef1ae1e55a',
          fnParams: ['suppliers_e439f5ef1ae1e55a'],
          fn: async () => 'supplier-list',
          ttl: 60,
        });
        expect(await readHashedSupplier()).toBe('hashed-supplier');
        expect(await cache.dropMatching({
          pluginName,
          patterns: [
            'products_v3_e439f5ef1ae1e55a*',
            'suppliers_e439f5ef1ae1e55a*',
            'booking_statuses_e439f5ef1ae1e55a*',
            `${hashedSupplierKey}*`,
          ],
        })).toBe(owned.length);
        await Promise.all(owned.map(async key => {
          expect(await cache.get({ pluginName, key })).toBeNull();
        }));
        await Promise.all(retained.map(async key => {
          expect(await cache.get({ pluginName, key })).toBe('cached');
        }));
        expect(await readHashedSupplier()).toBe('hashed-supplier');
        expect(hashedReads).toBe(1);
      } finally {
        await Promise.all(explicitEntries.map(entry => cache.drop(entry)));
        await cache.drop({ pluginName, fn: hashedFn, fnParams: [hashedSupplierKey] });
      }
    });
  });

  describe('cache write ownership', () => {
    it.each(['save', 'saveVersioned'])('%s cannot write after its lock disappears or changes owner', async method => {
      const key = `ownership-${method}`;
      const lockKey = `${key}:lock`;
      const args = { pluginName: testPluginName, key, lockKey, lockOwnerToken: 'old-owner',
        value: { products: ['stale'] }, ttl: 60 };
      testKeys.push(key, lockKey, `${key}:version`, `${key}:lastUpdated`);
      await expect(cache[method](args)).rejects.toMatchObject({ status: 409 });
      await cache.save({ pluginName: testPluginName, key: lockKey, value: 'new-owner' });
      await expect(cache[method](args)).rejects.toMatchObject({ status: 409 });
      for (const suffix of ['', ':version', ':lastUpdated']) {
        expect(await cache.get({ pluginName: testPluginName, key: `${key}${suffix}` })).toBeNull();
      }
      expect(await cache.get({ pluginName: testPluginName, key: lockKey })).toBe('new-owner');
      await cache[method]({ ...args, lockOwnerToken: 'new-owner' });
      expect(await cache.get({ pluginName: testPluginName, key })).toEqual(args.value);
    });
  });

  describe('saveVersioned', () => {
    it('records a partial save separately from the last complete success and retains it on failure', async () => {
      const key = 'partial:status';
      const lockKey = 'partial:lock';
      testKeys.push(key, lockKey);
      await cache.save({ pluginName: testPluginName, key: lockKey, value: 'owner' });
      const success = { succeededAt: 100, productCount: 2, optionCount: 3 };
      await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        lockOwnerToken: 'owner', attempt: { status: 'succeeded' }, success });
      const saved = { savedAt: 200, partial: true, productCount: 3, optionCount: 4,
        missingActivityIds: ['missing'] };
      await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        lockOwnerToken: 'owner', attempt: { status: 'partial' }, saved });
      await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        lockOwnerToken: 'owner', attempt: { status: 'failed' } });
      expect(await cache.get({ pluginName: testPluginName, key })).toEqual({
        lastAttempt: { status: 'failed' }, lastSuccess: success, lastSaved: saved,
      });
    });
    it('only lets the current refresh owner update status and retains the last successful counts', async () => {
      const key = 'sync:status';
      const lockKey = 'sync:lock';
      testKeys.push(key, lockKey);
      await cache.save({ pluginName: testPluginName, key: lockKey, value: 'first-owner' });
      const success = { succeededAt: 123, productCount: 30, optionCount: 60 };
      await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        lockOwnerToken: 'first-owner', attempt: { status: 'succeeded' }, success });
      await cache.save({ pluginName: testPluginName, key: lockKey, value: 'new-owner' });
      expect(await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        lockOwnerToken: 'first-owner', attempt: { status: 'failed' } })).toBe(0);
      expect(await cache.get({ pluginName: testPluginName, key }))
        .toEqual({ lastAttempt: { status: 'succeeded' }, lastSuccess: success });
      await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        lockOwnerToken: 'new-owner', attempt: { status: 'failed', reason: 'upstream timeout' } });
      expect(await cache.get({ pluginName: testPluginName, key })).toEqual({
        lastAttempt: { status: 'failed', reason: 'upstream timeout' }, lastSuccess: success,
      });
      expect(await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        attempt: { status: 'failed', startedAt: 200 } })).toBe(0);
      await cache.drop({ pluginName: testPluginName, key: lockKey });
      expect(await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        attempt: { status: 'failed', startedAt: 200 } })).toBe(1);
      expect(await cache.saveProductSyncStatus({ pluginName: testPluginName, key, lockKey,
        attempt: { status: 'failed', startedAt: 100 } })).toBe(0);
      expect((await cache.get({ pluginName: testPluginName, key })).lastSuccess).toEqual(success);
    });
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

  describe('supplier cache writers', () => {
    const identity = {
      pluginName: testPluginName,
      userId: 'itinerary-company',
      hint: 'itinerary-desk',
    };

    const cleanup = async ownerToken => {
      await cache.endSupplierCacheWrite({ ...identity, ownerToken });
      await cache.endSupplierCacheDeletion({ ...identity, ownerToken });
    };

    it('keeps deletion waiting while either of two searches is still registered', async () => {
      const first = 'scoped-writer-a';
      const second = 'scoped-writer-b';
      try {
        expect(await cache.beginSupplierCacheWrite({ ...identity, ownerToken: first, ttl: 30 })).toBe(true);
        expect(await cache.beginSupplierCacheWrite({ ...identity, ownerToken: second, ttl: 30 })).toBe(true);
        expect(await cache.supplierCacheWritesActive(identity)).toBe(true);
        await cache.endSupplierCacheWrite({ ...identity, ownerToken: first });
        expect(await cache.supplierCacheWritesActive(identity)).toBe(true);
        await cache.endSupplierCacheWrite({ ...identity, ownerToken: second });
        expect(await cache.supplierCacheWritesActive(identity)).toBe(false);
      } finally {
        await cleanup(first);
        await cleanup(second);
      }
    });

    it('blocks a new booking-status writer after deletion raises the fence', async () => {
      const ownerToken = 'itinerary-writer';
      const deletionToken = 'deletion-owner';
      try {
        expect(await cache.beginSupplierCacheWrite({
          ...identity, ownerToken, ttl: 30,
        })).toBe(true);
        expect(await cache.supplierCacheWritesActive(identity)).toBe(true);
        expect(await cache.beginSupplierCacheDeletion({
          ...identity, ownerToken: deletionToken, ttl: 30,
        })).toBe(true);
        expect(await cache.beginSupplierCacheWrite({
          ...identity, ownerToken: 'late-writer', ttl: 30,
        })).toBe(false);
        await cache.endSupplierCacheWrite({ ...identity, ownerToken });
        expect(await cache.supplierCacheWritesActive(identity)).toBe(false);
        expect(await cache.beginSupplierCacheWrite({
          ...identity, ownerToken: 'during-deletion', ttl: 30,
        })).toBe(false);
      } finally {
        await cleanup(ownerToken);
        await cleanup('late-writer');
        await cleanup('during-deletion');
        await cache.endSupplierCacheDeletion({ ...identity, ownerToken: deletionToken });
      }
    });

    it('rejects a cache write after the writer registration is gone', async () => {
      const ownerToken = 'expired-writer';
      const key = 'suppliers_expired';
      const writer = {
        pluginName: testPluginName,
        writerKey: `${productSearchCacheKey(identity)}:supplier-writer:${ownerToken}`,
        ownerToken,
        ttl: 30,
      };
      try {
        expect(await cache.beginSupplierCacheWrite({
          ...identity, ownerToken, ttl: 30,
        })).toBe(true);
        await cache.runWithSupplierCacheWriter(writer, () => cache.save({
          pluginName: testPluginName,
          key,
          value: 'fresh',
        }));
        expect(await cache.get({ pluginName: testPluginName, key })).toBe('fresh');
        await cache.endSupplierCacheWrite({ ...identity, ownerToken });
        await expect(cache.runWithSupplierCacheWriter(writer, () => cache.getOrExec({
          pluginName: testPluginName,
          key,
          fn: async () => 'recreated',
          ttl: 30,
        }))).rejects.toMatchObject({
          status: 503,
          message: 'Search lost its cache registration. Retry the search.',
        });
        expect(await cache.get({ pluginName: testPluginName, key })).toBe('fresh');
      } finally {
        await cleanup(ownerToken);
        await cache.drop({ pluginName: testPluginName, key });
      }
    });

    const holdWriteUntilGuardIsGone = async ({ dropGuard, write }) => {
      const redis = cache.cache;
      const originalEval = redis.eval.bind(redis);
      const originalSet = redis.set.bind(redis);
      let dropped = false;
      const dropBeforeCommand = async () => {
        if (dropped) return;
        dropped = true;
        redis.eval.mockImplementation(originalEval);
        redis.set.mockImplementation(originalSet);
        await dropGuard();
      };
      jest.spyOn(redis, 'eval').mockImplementation(async (...args) => {
        if (String(args[0]).includes("redis.call('set'")) await dropBeforeCommand();
        return originalEval(...args);
      });
      jest.spyOn(redis, 'set').mockImplementation(async (...args) => {
        await dropBeforeCommand();
        return originalSet(...args);
      });
      try {
        await write();
      } finally {
        redis.eval.mockRestore();
        redis.set.mockRestore();
      }
    };

    it('does not land a write that reaches Redis after the writer registration is gone', async () => {
      const ownerToken = 'delayed-writer';
      const key = 'suppliers_delayed';
      const writer = {
        pluginName: testPluginName,
        writerKey: `${productSearchCacheKey(identity)}:supplier-writer:${ownerToken}`,
        ownerToken,
        ttl: 30,
      };
      try {
        expect(await cache.beginSupplierCacheWrite({
          ...identity, ownerToken, ttl: 30,
        })).toBe(true);
        await holdWriteUntilGuardIsGone({
          dropGuard: () => cache.endSupplierCacheWrite({ ...identity, ownerToken }),
          write: () => expect(cache.runWithSupplierCacheWriter(writer, () => cache.save({
            pluginName: testPluginName,
            key,
            value: 'stale',
            ttl: 60,
          }))).rejects.toMatchObject({ status: 503 }),
        });
        expect(await cache.get({ pluginName: testPluginName, key })).toBeNull();
      } finally {
        await cleanup(ownerToken);
        await cache.drop({ pluginName: testPluginName, key });
      }
    });

    it('checks the refresh lock in the same command as a raw supplier write', async () => {
      const ownerToken = 'refresh-owner';
      const key = 'suppliers_refresh_guard';
      const lockKey = `${productSearchCacheKey(identity)}:lock`;
      const lock = {
        pluginName: testPluginName, lockKey, ownerToken, ttl: 30,
      };
      try {
        expect(await cache.saveIfNotExists({
          pluginName: testPluginName, key: lockKey, value: ownerToken, ttl: 30,
        })).toBe(true);
        await cache.runWithRefreshLock(lock, () => cache.save({
          pluginName: testPluginName, key, value: 'while-held', ttl: 60,
        }));
        expect(await cache.get({ pluginName: testPluginName, key })).toBe('while-held');
        await holdWriteUntilGuardIsGone({
          dropGuard: () => cache.dropIfValue({
            pluginName: testPluginName, key: lockKey, value: ownerToken,
          }),
          write: () => expect(cache.runWithRefreshLock(lock, () => cache.save({
            pluginName: testPluginName,
            key,
            value: 'after-lock-lost',
            ttl: 60,
          }))).rejects.toMatchObject({ status: 409 }),
        });
        expect(await cache.get({ pluginName: testPluginName, key })).toBe('while-held');
      } finally {
        await cache.dropIfValue({
          pluginName: testPluginName, key: lockKey, value: ownerToken,
        });
        await cache.drop({ pluginName: testPluginName, key });
      }
    });

    it('keeps concurrent Bluebird searches on their own cache guards', async () => {
      const Bluebird = require('bluebird');
      Bluebird.config({ asyncHooks: true });
      const first = 'concurrent-writer-a';
      const second = 'concurrent-writer-b';
      const keyA = 'suppliers_concurrent_a';
      const keyB = 'suppliers_concurrent_b';
      const writerFor = ownerToken => ({
        pluginName: testPluginName,
        writerKey: `${productSearchCacheKey(identity)}:supplier-writer:${ownerToken}`,
        ownerToken,
        ttl: 30,
      });
      let unlock;
      const hold = new Promise(resolve => { unlock = resolve; });
      let arrived = 0;
      let releaseArrived;
      const allArrived = new Promise(resolve => { releaseArrived = resolve; });
      const markArrived = () => {
        arrived += 1;
        if (arrived === 2) releaseArrived();
      };
      const search = (ownerToken, key) => cache.runWithSupplierCacheWriter(
        writerFor(ownerToken),
        () => Bluebird.map([key], async () => {
          markArrived();
          await hold;
          await cache.save({
            pluginName: testPluginName,
            key,
            value: ownerToken,
            ttl: 60,
          });
        }, { concurrency: 2 }),
      );
      try {
        expect(await cache.beginSupplierCacheWrite({
          ...identity, ownerToken: first, ttl: 30,
        })).toBe(true);
        expect(await cache.beginSupplierCacheWrite({
          ...identity, ownerToken: second, ttl: 30,
        })).toBe(true);
        const searchA = search(first, keyA);
        const searchB = search(second, keyB);
        await allArrived;
        await cache.endSupplierCacheWrite({ ...identity, ownerToken: first });
        unlock();
        await expect(searchA).rejects.toMatchObject({ status: 503 });
        await searchB;
        expect(await cache.get({ pluginName: testPluginName, key: keyA })).toBeNull();
        expect(await cache.get({ pluginName: testPluginName, key: keyB })).toBe(second);
        await cache.endSupplierCacheWrite({ ...identity, ownerToken: second });
        await expect(cache.runWithSupplierCacheWriter(writerFor(second), () => Bluebird.map(
          [keyB],
          async () => cache.save({
            pluginName: testPluginName,
            key: keyB,
            value: 'after-registration-removed',
            ttl: 60,
          }),
          { concurrency: 1 },
        ))).rejects.toMatchObject({ status: 503 });
        expect(await cache.get({ pluginName: testPluginName, key: keyB })).toBe(second);
      } finally {
        if (unlock) unlock();
        Bluebird.config({ asyncHooks: false });
        await cleanup(first);
        await cleanup(second);
        await cache.drop({ pluginName: testPluginName, key: keyA });
        await cache.drop({ pluginName: testPluginName, key: keyB });
      }
    });
  });
});
