const selectorFields = [
  'searchInput',
  'optionId',
  'productId',
  'productName',
  'lastUpdatedFrom',
];

module.exports = payload => selectorFields.some(field => {
  const value = payload[field];
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return Boolean(trimmed) && !(field === 'searchInput' && trimmed === '*');
  }
  return value !== undefined && value !== null && value !== false;
});
