#!/usr/bin/env node
const { cache } = require('../cache');
const { getSupplierOptionsAndRatesStore } = require('../lib/tourplanNxSupplierOptionsAndRatesStore');
const { migrateSupplierOptionsAndRates } = require('../lib/migrateSupplierOptionsAndRates');

const main = async () => {
  try {
    const totals = await migrateSupplierOptionsAndRates({
      redis: cache,
      store: getSupplierOptionsAndRatesStore(),
      apply: process.argv.includes('--apply'),
      progress: counts => console.log(JSON.stringify(counts)),
    });
    console.log(JSON.stringify({ complete: true, apply: process.argv.includes('--apply'), ...totals }));
  } catch (error) {
    // SDK errors can contain request details; only emit our error classification.
    console.error(JSON.stringify({ complete: false, error: error.code || error.name }));
    process.exitCode = 1;
  } finally {
    await cache.quit();
  }
};

main();
