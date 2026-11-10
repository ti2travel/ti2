const { AsyncLocalStorage } = require('async_hooks');
const Redis = require('ioredis');
const hash = require('object-hash');
const productSearchCacheKey = require('./lib/productSearchCacheKey');

const supplierWriterStore = new AsyncLocalStorage();

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const cache = new Redis(`${REDIS_URL}/2`);
const defaultTTL = 60 * 60; // 1 hour

const normalizeKey = ({
  key: keyParam,
  fn,
  fnParams,
  useFunctionFallback = false,
}) => {
  if (useFunctionFallback && !keyParam) {
    return hash({ fn, fnParams });
  }
  if (typeof keyParam !== 'string') {
    return hash(keyParam);
  }
  return keyParam;
};

const buildKey = ({ pluginName, ...args }) => `${pluginName}:${normalizeKey(args)}`;

const lostCacheLockError = () => {
  const error = new Error('Product refresh lost cache lock ownership. Retry the refresh.');
  error.status = 409;
  return error;
};

const saveVersioned = async ({
  pluginName,
  key,
  value,
  ttl = defaultTTL,
  lockKey,
  lockOwnerToken,
}) => {
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new Error('Versioned cache save requires a positive integer TTL');
  }
  const savedAt = Date.now();
  const proposed = savedAt * 1000;
  // Keep the version counter after the cache expires so a later save cannot reuse an older version.
  // A runtime Redis error can leave a gap; version-first avoids publishing a new catalog with an old revision.
  const version = await cache.eval(
    `if ARGV[5] ~= '' and redis.call('get', KEYS[4]) ~= ARGV[5] then return false end
      local proposed = tonumber(ARGV[1])
      local previous = tonumber(redis.call('get', KEYS[3]) or '0')
      if proposed <= previous then proposed = previous + 1 end
      local version = string.format('%.0f', proposed)
      redis.call('set', KEYS[3], version)
      redis.call('setex', KEYS[1], ARGV[4], ARGV[2])
      redis.call('setex', KEYS[2], ARGV[4], ARGV[3])
      return version`,
    4,
    buildKey({ pluginName, key }),
    buildKey({ pluginName, key: `${key}:lastUpdated` }),
    buildKey({ pluginName, key: `${key}:version` }),
    buildKey({ pluginName, key: lockKey || `${key}:lock` }),
    proposed,
    JSON.stringify(value),
    JSON.stringify(savedAt),
    ttl,
    lockKey ? JSON.stringify(lockOwnerToken) : '',
  );
  if (version === null) throw lostCacheLockError();
  return { cacheVersion: Number(version), cacheSavedAt: savedAt };
};

const saveProductSyncStatus = async ({ pluginName, key, lockKey, lockOwnerToken, attempt, success, saved }) => {
  return cache.eval(
    "local raw = redis.call('get', KEYS[1]) "
      + "local value = raw and cjson.decode(raw) or {} "
      + "local attempt = cjson.decode(ARGV[2]) "
      + "if ARGV[1] == '' then "
      + "if redis.call('exists', KEYS[2]) == 1 then return 0 end "
      + "if value.lastAttempt and tonumber(value.lastAttempt.startedAt or 0) >= tonumber(attempt.startedAt) then return 0 end "
      + "elseif redis.call('get', KEYS[2]) ~= ARGV[1] then return 0 end "
      + "value.lastAttempt = attempt "
      + "if ARGV[3] ~= '' then value.lastSuccess = cjson.decode(ARGV[3]) end "
      + "if ARGV[5] ~= '' then value.lastSaved = cjson.decode(ARGV[5]) end "
      + "redis.call('setex', KEYS[1], ARGV[4], cjson.encode(value)) return 1",
    2, buildKey({ pluginName, key }), buildKey({ pluginName, key: lockKey }),
    lockOwnerToken === undefined ? '' : JSON.stringify(lockOwnerToken),
    JSON.stringify(attempt), success ? JSON.stringify(success) : '',
    30 * 24 * 60 * 60, saved ? JSON.stringify(saved) : '',
  );
};

const lostSupplierWriterError = () => {
  const error = new Error('Search lost its cache registration. Retry the search.');
  error.status = 503;
  return error;
};

const activeCacheGuard = pluginName => {
  const guard = supplierWriterStore.getStore();
  if (!guard || guard.pluginName !== pluginName) return null;
  return guard;
};

const cacheGuardError = guard => (
  guard && guard.kind === 'refresh-lock' ? lostCacheLockError() : lostSupplierWriterError()
);

const runWithCacheGuard = (guard, fn) => supplierWriterStore.run(guard, fn);

const runWithSupplierCacheWriter = (writer, fn) => runWithCacheGuard({
  pluginName: writer.pluginName,
  guardKey: writer.writerKey,
  ownerToken: writer.ownerToken,
  ttl: writer.ttl,
  kind: 'writer',
}, fn);

const runWithRefreshLock = (lock, fn) => runWithCacheGuard({
  pluginName: lock.pluginName,
  guardKey: lock.lockKey,
  ownerToken: lock.ownerToken,
  ttl: lock.ttl,
  kind: 'refresh-lock',
}, fn);

// Fail before a long fetch once the registration or refresh lock is already gone.
// The save itself checks ownership again in the same Redis command as the write.
const assertCacheGuard = async pluginName => {
  const guard = activeCacheGuard(pluginName);
  if (!guard) return;
  const alive = await expireIfValue({
    pluginName,
    key: guard.guardKey,
    value: guard.ownerToken,
    ttl: guard.ttl,
  });
  if (!alive) throw cacheGuardError(guard);
};

const save = async ({
  pluginName,
  key: keyParam,
  value,
  skipTTL,
  ttl = defaultTTL,
  lockKey,
  lockOwnerToken,
}) => {
  const key = buildKey({ pluginName, key: keyParam });
  const guard = activeCacheGuard(pluginName);
  const ownership = [];
  if (guard) {
    ownership.push({
      key: buildKey({ pluginName, key: guard.guardKey }),
      token: JSON.stringify(guard.ownerToken),
      ttl: guard.ttl ? String(guard.ttl) : '',
    });
  }
  if (lockKey) {
    const ownedKey = buildKey({ pluginName, key: lockKey });
    const token = JSON.stringify(lockOwnerToken);
    if (!ownership.some(item => item.key === ownedKey && item.token === token)) {
      ownership.push({ key: ownedKey, token, ttl: '' });
    }
  }
  if (ownership.length > 0) {
    // Ownership is read in the same script as SET, so a delayed command cannot
    // land after deletion has cleared the writer or refresh lock.
    const saved = await cache.eval(
      `local guards = tonumber(ARGV[1])
        for i = 1, guards do
          if redis.call('get', KEYS[i + 1]) ~= ARGV[i + 3] then return 0 end
        end
        redis.call('set', KEYS[1], ARGV[2])
        if ARGV[3] ~= '' then redis.call('expire', KEYS[1], tonumber(ARGV[3])) end
        for i = 1, guards do
          local renew = ARGV[guards + 3 + i]
          if renew ~= '' then redis.call('expire', KEYS[i + 1], tonumber(renew)) end
        end
        return 1`,
      ownership.length + 1,
      key,
      ...ownership.map(item => item.key),
      String(ownership.length),
      JSON.stringify(value),
      skipTTL ? '' : String(ttl),
      ...ownership.map(item => item.token),
      ...ownership.map(item => item.ttl),
    );
    if (saved !== 1) throw guard ? cacheGuardError(guard) : lostCacheLockError();
    return;
  }
  // console.log('saving key', key);
  await cache.set(key, JSON.stringify(value));
  if (!skipTTL) {
    await cache.expire(key, ttl);
  }
};

const saveIfNotExists = async ({
  pluginName,
  key: keyParam,
  value,
  ttl = defaultTTL,
}) => {
  const key = buildKey({ pluginName, key: keyParam });
  const result = await cache.set(key, JSON.stringify(value), 'EX', ttl, 'NX');
  return result === 'OK';
};

const expireIfValue = async ({
  pluginName,
  key: keyParam,
  value,
  ttl = defaultTTL,
}) => {
  const key = buildKey({ pluginName, key: keyParam });
  const expectedValue = JSON.stringify(value);
  const result = await cache.eval(`
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('expire', KEYS[1], ARGV[2])
    end
    return 0
  `, 1, key, expectedValue, ttl);
  return result === 1;
};

const dropIfValue = async ({
  pluginName,
  key: keyParam,
  value,
}) => {
  const key = buildKey({ pluginName, key: keyParam });
  const expectedValue = JSON.stringify(value);
  const result = await cache.eval(`
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    end
    return 0
  `, 1, key, expectedValue);
  return result === 1;
};

const get = async ({
  pluginName,
  key: keyParam,
}) => {
  const key = buildKey({ pluginName, key: keyParam });
  const storeVal = await cache.get(key);
  if (!storeVal) return storeVal;
  return JSON.parse(storeVal);
};

const getOrExec = async ({
  pluginName,
  key: keyParam,
  ttl,
  fn,
  fnParams,
  forceRefresh,
}) => {
  await assertCacheGuard(pluginName);
  const key = normalizeKey({ key: keyParam, fn, fnParams, useFunctionFallback: true });
  let value;
  if (!forceRefresh) {
    value = await get({ pluginName, key });
    if (value !== null) return value;
  }
  value = await fn(...fnParams);
  await save({
    pluginName,
    key,
    value,
    ttl,
  });
  return value;
};

const drop = async ({
  pluginName,
  key: keyParam,
  fn,
  fnParams,
}) => {
  const key = buildKey({
    pluginName,
    key: keyParam,
    fn,
    fnParams,
    useFunctionFallback: true,
  });
  // console.log('dropping key', key);
  await cache.del(key);
};

const supplierCacheKeys = ({ userId, hint, ownerToken }) => {
  const base = productSearchCacheKey({ userId, hint });
  return {
    fenceKey: `${base}:deletion`,
    writerKey: ownerToken ? `${base}:supplier-writer:${ownerToken}` : '',
    writerPattern: `${base}:supplier-writer:*`,
  };
};

// Itinerary search writes booking-status caches without the product-search lock.
// Register the writer before the plugin call, and keep the deletion fence until the
// credential is gone, so a search cannot save statuses after cleanup scans them.
const beginSupplierCacheWrite = async ({
  pluginName,
  userId,
  hint,
  ownerToken,
  ttl = defaultTTL,
}) => {
  const { fenceKey, writerKey } = supplierCacheKeys({ userId, hint, ownerToken });
  const result = await cache.eval(
    `if redis.call('exists', KEYS[2]) == 1 then return 0 end
      redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2])
      if redis.call('exists', KEYS[2]) == 1 then
        if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('del', KEYS[1]) end
        return 0
      end
      return 1`,
    2,
    buildKey({ pluginName, key: writerKey }),
    buildKey({ pluginName, key: fenceKey }),
    JSON.stringify(ownerToken),
    ttl,
  );
  return result === 1;
};

const endSupplierCacheWrite = ({
  pluginName,
  userId,
  hint,
  ownerToken,
}) => dropIfValue({
  pluginName,
  key: supplierCacheKeys({ userId, hint, ownerToken }).writerKey,
  value: ownerToken,
});

const beginSupplierCacheDeletion = ({
  pluginName,
  userId,
  hint,
  ownerToken,
  ttl = defaultTTL,
}) => saveIfNotExists({
  pluginName,
  key: supplierCacheKeys({ userId, hint }).fenceKey,
  value: ownerToken,
  ttl,
});

const endSupplierCacheDeletion = ({
  pluginName,
  userId,
  hint,
  ownerToken,
}) => dropIfValue({
  pluginName,
  key: supplierCacheKeys({ userId, hint }).fenceKey,
  value: ownerToken,
});

const supplierCacheWritesActive = async ({ pluginName, userId, hint }) => {
  const matches = await scan({
    pluginName,
    pattern: supplierCacheKeys({ userId, hint }).writerPattern,
  });
  return matches.length > 0;
};

const dropProductSearch = async ({
  pluginName,
  userId,
  hint,
  lockOwnerToken,
}) => {
  const key = productSearchCacheKey({ userId, hint });
  const keysToDelete = [key, `${key}:lastUpdated`, `${key}:version`,
    `${key}:sync-status`, `${key}:lock:outcome`];
  // A deletion owner may clear keys while it still holds the lock. Any other owner blocks cleanup.
  return cache.eval(
    `local owner = redis.call('get', KEYS[1])
      if ARGV[1] ~= '' then
        if owner ~= ARGV[1] then return -1 end
      elseif owner then
        return -1
      end
      return redis.call('del', unpack(KEYS, 2))`,
    keysToDelete.length + 1,
    buildKey({ pluginName, key: `${key}:lock` }),
    ...keysToDelete.map(cacheKey => buildKey({ pluginName, key: cacheKey })),
    lockOwnerToken ? JSON.stringify(lockOwnerToken) : '',
  );
};

const keys = async () => cache.keys('*');

const scan = ({
  pluginName,
  pattern,
  count = 1000,
}) => new Promise((resolve, reject) => {
  const fullPattern = `${pluginName}:${pattern}`;
  const foundKeys = [];
  const prefixLength = pluginName.length + 1; // +1 for the colon

  const stream = cache.scanStream({ match: fullPattern, count });
  stream.on('data', keys => {
    keys.forEach(key => {
      // Return keys without the plugin prefix
      foundKeys.push(key.slice(prefixLength));
    });
  });
  stream.on('end', () => resolve(foundKeys));
  stream.on('error', reject);
});

const DROP_BATCH_SIZE = 500;

const deleteInBatches = async fullKeys => {
  if (fullKeys.length === 0) return 0;
  const batch = fullKeys.slice(0, DROP_BATCH_SIZE);
  const deleted = await cache.del(...batch);
  if (fullKeys.length <= DROP_BATCH_SIZE) return deleted;
  return deleted + await deleteInBatches(fullKeys.slice(DROP_BATCH_SIZE));
};

const dropMatching = async ({ pluginName, patterns = [] }) => {
  const matches = await Promise.all(patterns.map(pattern => scan({ pluginName, pattern })));
  const fullKeys = [...new Set(matches.flat())].map(key => buildKey({ pluginName, key }));
  return deleteInBatches(fullKeys);
};

module.exports = {
  cache,
  save,
  saveVersioned,
  saveProductSyncStatus,
  saveIfNotExists,
  expireIfValue,
  dropIfValue,
  beginSupplierCacheWrite,
  endSupplierCacheWrite,
  beginSupplierCacheDeletion,
  endSupplierCacheDeletion,
  supplierCacheWritesActive,
  runWithSupplierCacheWriter,
  runWithRefreshLock,
  getOrExec,
  drop,
  dropMatching,
  dropProductSearch,
  get,
  keys,
  scan,
};
