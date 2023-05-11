const Redis = require('ioredis');
const hash = require('object-hash');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const cache = new Redis(`${REDIS_URL}/2`);
const defaultTTL = 60 * 60; // 1 hour

const save = async ({
  pluginName,
  key: keyParam,
  value,
  ttl = defaultTTL,
}) => {
  const key = `${pluginName}:${(() => {
    if (typeof keyParam !== 'string') {
      return hash(keyParam);
    }
    return keyParam;
  })()}`;
  await cache.set(key, JSON.stringify(value));
  await cache.expire(key, ttl);
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
  let value = await get({ pluginName, key });
  if (value !== null) return value;
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
  key = `${pluginName}:${key}`;
  await cache.del(key);
};

module.exports = {
  cache,
  save,
  getOrExec,
  drop,
  get,
};
