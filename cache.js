const Redis = require('ioredis');
const hash = require('object-hash');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const cache = new Redis(`${REDIS_URL}/2`);
const defaultTTL = 60 * 60; // 1 hour

const save = async ({
  pluginName,
  key: keyParam,
  value,
  skipTTL,
  ttl = defaultTTL,
  nx = false,
}) => {
  const key = `${pluginName}:${(() => {
    if (typeof keyParam !== 'string') {
      return hash(keyParam);
    }
    return keyParam;
  })()}`;
  const params = [];
  if (nx) {
    params.push('NX');
  }
  if (!skipTTL) {
    params.push('EX', ttl);
  }
  // console.log('saving key', key);
  // Use SET with NX option for atomic operation
  const result = await cache.set(key, JSON.stringify(value), ...params);
  return result === 'OK';
};

const get = async ({
  pluginName,
  key: keyParam,
}) => {
  const key = `${pluginName}:${(() => {
    if (typeof keyParam !== 'string') {
      return hash(keyParam);
    }
    return keyParam;
  })()}`;
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
  const key = (() => {
    if (!keyParam) {
      return hash({ fn, fnParams });
    }
    if (typeof keyParam !== 'string') {
      return hash(keyParam);
    }
    return keyParam;
  })();
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
  const key = `${pluginName}:${(() => {
    if (!keyParam) {
      return hash({ fn, fnParams });
    }
    if (typeof keyParam !== 'string') {
      return hash(keyParam);
    }
    return keyParam;
  })()}`;
  // console.log('dropping key', key);
  await cache.del(key);
};

const keys = async () => cache.keys('*');

module.exports = {
  cache,
  save,
  getOrExec,
  drop,
  get,
  keys,
};
