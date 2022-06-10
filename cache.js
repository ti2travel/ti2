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
  const key = `${pluginName}:${keyParam}`;
  const keyType = typeof value === 'string';
  await cache.set(key, JSON.stringify({
    keyType,
    value: keyType === 'string' ? value : JSON.stringify(value),
  }));
  await cache.expire(key, ttl);
};

const get = async ({
  pluginName,
  key: keyParam,
}) => {
  const key = `${pluginName}:${keyParam}`;
  const storeVal = await cache.get(key);
  if (!storeVal) return storeVal;
  const { keyType, value } = JSON.parse(storeVal);
  if (keyType === 'string') {
    return value;
  }
  return JSON.parse(value);
};

const getOrExec = async ({
  pluginName,
  key: keyParam,
  ttl,
  fn,
  fnParams,
}) => {
  const key = keyParam || hash({ fn, fnParams });
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
  fn,
  fnParams,
}) => {
  let key = hash({ fn, fnParams });
  key = `${pluginName}:${key}`;
  await cache.del(key);
};

module.exports = {
  cache,
  save,
  getOrExec,
  drop,
};
