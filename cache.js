const Redis = require('ioredis');
const hash = require('object-hash');
const productSearchCacheKey = require('./lib/productSearchCacheKey');

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
  if (lockKey) {
    const saved = await cache.eval(
      `if redis.call('get', KEYS[2]) ~= ARGV[1] then return 0 end
        redis.call('set', KEYS[1], ARGV[2])
        if ARGV[3] ~= '' then redis.call('expire', KEYS[1], ARGV[3]) end
        return 1`,
      2,
      key,
      buildKey({ pluginName, key: lockKey }),
      JSON.stringify(lockOwnerToken),
      JSON.stringify(value),
      skipTTL ? '' : ttl,
    );
    if (!saved) throw lostCacheLockError();
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

const dropProductSearch = async ({ pluginName, userId, hint }) => {
  const key = productSearchCacheKey({ userId, hint });
  const keysToDelete = [key, `${key}:lastUpdated`, `${key}:version`,
    `${key}:sync-status`, `${key}:lock:outcome`];
  // Never remove another refresh's lock; retry deletion once its writer has finished.
  return cache.eval(
    `if redis.call('exists', KEYS[1]) == 1 then return -1 end
      return redis.call('del', unpack(KEYS, 2))`,
    keysToDelete.length + 1,
    buildKey({ pluginName, key: `${key}:lock` }),
    ...keysToDelete.map(cacheKey => buildKey({ pluginName, key: cacheKey })),
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

module.exports = {
  cache,
  save,
  saveVersioned,
  saveProductSyncStatus,
  saveIfNotExists,
  expireIfValue,
  dropIfValue,
  getOrExec,
  drop,
  dropProductSearch,
  get,
  keys,
  scan,
};
