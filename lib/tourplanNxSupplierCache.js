const crypto = require('crypto');

// Same identity string as ti2-tourplannx _getProductCacheKeyPrefix,
// _getSupplierCacheKey, and _getBookingStatusesCacheKey.
// getOrExec must be called with this string as `key`. Without it, TI2 stores
// hash({ fn, fnParams }) and these prefixes do not match.
const PREFIX_PATTERN = /^(products_v3|suppliers|booking_statuses)_[0-9a-f]{16}$/;

const supplierIdentity = key => {
  const match = /^products_v3_([a-f0-9]{16})_(.+)$/.exec(key);
  return match && !/^(all|services|locations|countriesByCode|destinationsByCode|agentCurrencyCode_.+)$/.test(match[2])
    ? { hash: match[1], code: match[2] } : null;
};

const supplierCachePrefixes = ({ url, userId, hint }) => {
  if (typeof url !== 'string' || url.length === 0) return [];
  const hash = crypto.createHash('sha256')
    .update(`${url}|${userId || ''}|${hint || ''}`)
    .digest('hex')
    .slice(0, 16);
  return ['products_v3', 'suppliers', 'booking_statuses'].map(name => `${name}_${hash}`);
};

const validSupplierCachePrefixes = prefixes => (
  (Array.isArray(prefixes) ? prefixes : []).filter(prefix => PREFIX_PATTERN.test(prefix))
);

const supplierCachePatterns = prefixes => (
  validSupplierCachePrefixes(prefixes).map(prefix => `${prefix}*`)
);

module.exports = {
  supplierIdentity,
  supplierCachePatterns,
  supplierCachePrefixes,
  validSupplierCachePrefixes,
};
