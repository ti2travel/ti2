const Redis = require('ioredis');
const hash = require('object-hash');

const { addJob } = require('./worker/queue');

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
  await cache.set(`${key}:timestamp`, `${Date.now()}`);
  if (!skipTTL) {
    await cache.expire(key, ttl);
    await cache.expire(`${key}:timestamp`, ttl);
  }
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
  alwaysCache = false,
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
  const getTimestamp = await cache.get(`${pluginName}:${key}:timestamp`);
  const isTooOld = getTimestamp && Date.now() - parseInt(getTimestamp, 10) > ttl * 1000;
  if (isTooOld) {
    // send function to a job queue
    const isRunning = await cache.get(`${pluginName}:${key}:job`);
    if (!isRunning) {
      // TODO: make sure adding the correct payload to addJob
      const jobPayload = {};
      await addJob(jobPayload, {});
      await cache.set(`${pluginName}:${key}:job`, '1');
      await cache.expire(`${pluginName}:${key}:job`, 60);
    }
  }
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
    skipTTL: alwaysCache,
  });
  return value;
};

const drop = async ({
  pluginName,
  key: keyParam,
  fn,
  fnParams,
}) => {
  let key = `${pluginName}:${(() => {
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
