/* globals describe expect it */

const {
  supplierCachePatterns,
  supplierCachePrefixes,
} = require('../tourplanNxSupplierCache');

describe('tourplanNxSupplierCache', () => {
  const identity = {
    url: 'https://nx.example/tenant',
    userId: 'company-a',
    hint: 'Live',
  };

  it('derives the credential-scoped prefixes without keeping the url', () => {
    expect(supplierCachePrefixes(identity)).toEqual([
      'products_v3_e439f5ef1ae1e55a',
      'suppliers_e439f5ef1ae1e55a',
      'booking_statuses_e439f5ef1ae1e55a',
    ]);
    expect(JSON.stringify(supplierCachePrefixes(identity))).not.toContain(identity.url);
  });

  it('changes the hash when the hint changes', () => {
    expect(supplierCachePrefixes({ ...identity, hint: 'Test' }))
      .not.toEqual(supplierCachePrefixes(identity));
  });

  it('returns nothing when the credential has no url', () => {
    expect(supplierCachePrefixes({ ...identity, url: '' })).toEqual([]);
    expect(supplierCachePrefixes({ ...identity, url: null })).toEqual([]);
  });

  it('turns only exact credential prefixes into scan patterns', () => {
    expect(supplierCachePatterns([
      'products_v3_e439f5ef1ae1e55a',
      'suppliers_e439f5ef1ae1e55a',
      'products_v3_*',
      '*',
      'products_v3_short',
    ])).toEqual([
      'products_v3_e439f5ef1ae1e55a*',
      'suppliers_e439f5ef1ae1e55a*',
    ]);
  });
});
