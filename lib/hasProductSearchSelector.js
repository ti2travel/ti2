const selectorFields = [
  'searchInput',
  'optionId',
  'productId',
  'productName',
  'lastUpdatedFrom',
];

const controlFields = new Set([
  'forceRefresh', 'cacheOnly', 'backgroundJob', 'requestId', 'fullSyncTrigger',
  'admissionOverrideReason', 'fullSyncStartedAt', 'fullSyncAdmissionToken',
  'omitServiceCodes', 'pickupPointsRequired', 'credentials', 'scheduledProductSyncEnabled',
]);

module.exports = (payload, appKey) => Object.keys(payload).some(field => {
  if (controlFields.has(field)) return false;
  if (appKey === 'bokun' && ['currency', 'lang', 'language'].includes(field)) return false;
  const value = payload[field];
  // Unknown fields can be dynamic adapter filters; they must never populate the full cache.
  if (!selectorFields.includes(field)) return value !== undefined && value !== null;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return Boolean(trimmed) && !(field === 'searchInput' && trimmed === '*');
  }
  return value !== undefined && value !== null && value !== false;
});
