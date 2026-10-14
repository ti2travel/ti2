const Redis = require('ioredis');
const hash = require('object-hash');

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

const saveVersioned = async ({ pluginName, key, value, ttl = defaultTTL }) => {
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new Error('Versioned cache save requires a positive integer TTL');
  }
  const savedAt = Date.now();
  const proposed = savedAt * 1000;
  // Keep the version counter after the cache expires so a later save cannot reuse an older version.
  // A runtime Redis error can leave a gap; version-first avoids publishing a new catalog with an old revision.
  const version = await cache.eval(
    "local proposed = tonumber(ARGV[1]) "
      + "local previous = tonumber(redis.call('get', KEYS[3]) or '0') "
      + "if proposed <= previous then proposed = previous + 1 end "
      + "local version = string.format('%.0f', proposed) "
      + "redis.call('set', KEYS[3], version) "
      + "redis.call('setex', KEYS[1], ARGV[4], ARGV[2]) "
      + "redis.call('setex', KEYS[2], ARGV[4], ARGV[3]) "
      + "return version",
    3, buildKey({ pluginName, key }), buildKey({ pluginName, key: `${key}:lastUpdated` }),
    buildKey({ pluginName, key: `${key}:version` }),
    proposed, JSON.stringify(value), JSON.stringify(savedAt), ttl,
  );
  return { cacheVersion: Number(version), cacheSavedAt: savedAt };
};

const save = async ({
  pluginName,
  key: keyParam,
  value,
  skipTTL,
  ttl = defaultTTL,
}) => {
  const key = buildKey({ pluginName, key: keyParam });
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
  saveIfNotExists,
  expireIfValue,
  dropIfValue,
  getOrExec,
  drop,
  get,
  keys,
  scan,
};
