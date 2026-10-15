const { startAfterProductSync } = require('../tourplanSyncMetadata');

const recordProductCacheSave = jest.fn();
const events2url = { name: 'events2url', recordProductCacheSave };

const sync = (overrides = {}) => startAfterProductSync({
  url: '/products/tourplannx/company-1/Desk%20A/search',
  payload: { forceRefresh: true, fullSyncTrigger: 'scheduled' },
  result: { success: true, result: { cacheUpdated: true, cachedProductCount: 4,
    catalogOptionCount: 8, catalogFingerprint: 'a'.repeat(64), cacheSavedAt: 1700000000000,
    cacheVersion: 1700000000000000 } },
  plugins: [events2url],
  ...overrides,
});

beforeEach(() => {
  recordProductCacheSave.mockReset();
});

it.each(['manual', 'scheduled'])('waits for Filematch to accept %s refresh', async fullSyncTrigger => {
  recordProductCacheSave.mockResolvedValue('catalog-generation');
  await expect(sync({ payload: { forceRefresh: true, fullSyncTrigger } }))
    .resolves.toBe('catalog-generation');
  expect(recordProductCacheSave).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'company-1',
    hint: 'Desk A',
    fullSyncTrigger,
    productCount: 4,
    optionCount: 8,
    cacheFingerprint: 'a'.repeat(64),
    cacheSavedAt: 1700000000000,
    cacheVersion: 1700000000000000,
  }));
});

it('treats an omitted fullSyncTrigger on forceRefresh as manual for the handoff', async () => {
  recordProductCacheSave.mockResolvedValue('catalog-generation');
  await expect(sync({
    payload: {
      forceRefresh: true,
      backgroundJob: true,
      admissionOverrideReason: 'verify omitted trigger defaults to manual',
    },
  })).resolves.toBe('catalog-generation');
  expect(recordProductCacheSave).toHaveBeenCalledWith(expect.objectContaining({
    fullSyncTrigger: 'manual',
  }));
});

it('accepts an already recorded marker from Filematch', async () => {
  recordProductCacheSave.mockResolvedValue('existing-generation');
  await expect(sync()).resolves.toBe('existing-generation');
});

it.each([
  { searchInput: '*' },
  { searchInput: ' * ' },
  { optionId: [] },
])('records an unscoped refresh with selector-shaped payload %j', async selector => {
  recordProductCacheSave.mockResolvedValue('catalog-generation');
  await expect(sync({ payload: { forceRefresh: true, fullSyncTrigger: 'scheduled', ...selector } }))
    .resolves.toBe('catalog-generation');
  expect(recordProductCacheSave).toHaveBeenCalledTimes(1);
});

it.each([
  { searchInput: 'harbour' },
  { optionId: ['room'] },
  { productId: 'product' },
  { productName: 'tour' },
  { lastUpdatedFrom: '2026-01-01' },
])('skips a scoped refresh with selector %j', async selector => {
  await sync({ payload: { forceRefresh: true, fullSyncTrigger: 'scheduled', ...selector } });
  expect(recordProductCacheSave).not.toHaveBeenCalled();
});

it('requires the awaitable ti2-events2url API', async () => {
  await expect(sync({ plugins: [] }))
    .rejects.toThrow('ti2-events2url recordProductCacheSave API');
  await expect(sync({ plugins: [{ name: 'events2url' }] }))
    .rejects.toThrow('ti2-events2url recordProductCacheSave API');
});

it('surfaces Filematch handoff failures from the plugin', async () => {
  recordProductCacheSave.mockRejectedValue(new Error('connection refused'));
  await expect(sync()).rejects.toThrow('connection refused');
});

it('does not generate for failed, unchanged, or unrelated searches', async () => {
  await sync({ result: { success: false, result: { cacheUpdated: true } } });
  await sync({ result: { success: true, result: { cacheUpdated: false } } });
  await sync({ url: '/products/tourplan/company-1/Desk%20A/search' });
  await sync({ payload: { forceRefresh: true, fullSyncTrigger: 'organic' } });
  expect(recordProductCacheSave).not.toHaveBeenCalled();
});
