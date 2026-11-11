/* eslint-disable no-await-in-loop, no-restricted-syntax, no-continue */
// Read, upload and compare-and-replace one key at a time to bound migration memory.
const { supplierIdentity } = require('./tourplanNxSupplierCache');

const replaceBody = async (redis, key, expected, pointer) => redis.eval(
  `if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
    if redis.call('pttl', KEYS[1]) <= 0 then return 0 end
    redis.call('set', KEYS[1], ARGV[2], 'KEEPTTL')
    return 1`,
  1,
  key,
  expected,
  JSON.stringify(pointer),
);

const migrateSupplierOptionsAndRates = async ({
  redis, store, apply = false, progress = () => {},
}) => {
  if (apply && (!store || !store.writesEnabled)) {
    throw new Error('Enable supplier options and rates writes before applying the migration');
  }
  const totals = {
    copied: 0, skipped: 0, corrupt: 0, conflicts: 0, candidates: 0, bytesReleased: 0,
  };
  const seen = new Set();
  let cursor = '0';
  do {
    const page = await redis.scan(cursor, 'MATCH', 'tourplannx:products_v3_*', 'COUNT', 100);
    [cursor] = page;
    for (const key of page[1]) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (!supplierIdentity(key.slice('tourplannx:'.length))) {
        totals.skipped += 1;
        continue;
      }
      const raw = await redis.get(key);
      if (!raw) {
        totals.skipped += 1;
        continue;
      }
      let value;
      try { value = JSON.parse(raw); } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        totals.corrupt += 1;
        totals.skipped += 1;
        progress({ ...totals });
        continue;
      }
      if (!value || !Array.isArray(value.options)) {
        totals.skipped += 1;
        continue;
      }
      const remaining = await redis.pttl(key);
      if (remaining === -1) throw new Error('Supplier migration found a body without expiry');
      if (remaining <= 0) {
        totals.skipped += 1;
        continue;
      }
      totals.candidates += 1;
      if (apply) {
        const before = await redis.memory('USAGE', key) || 0;
        const pointer = await store.put(key.slice('tourplannx:'.length), value);
        if (await replaceBody(redis, key, raw, pointer)) {
          totals.copied += 1;
          const after = await redis.memory('USAGE', key) || 0;
          totals.bytesReleased += Math.max(0, before - after);
        } else {
          totals.conflicts += 1;
        }
      }
      progress({ ...totals });
    }
  } while (cursor !== '0');
  return totals;
};

module.exports = { migrateSupplierOptionsAndRates, replaceBody };
