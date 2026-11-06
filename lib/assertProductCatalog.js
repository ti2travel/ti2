const assert = require('assert');

const isId = value => ['string', 'number'].includes(typeof value)
  && String(value).trim() && (typeof value !== 'number' || Number.isFinite(value));

module.exports = (result, appKey) => {
  assert(result && Array.isArray(result.products),
    `${appKey} product search must return an object with a products array`);
  const productIds = new Set();
  for (const product of result.products) {
    assert(product && isId(product.productId), `${appKey} product is missing a stable productId`);
    const id = String(product.productId);
    assert(!productIds.has(id), `${appKey} catalog contains duplicate productId ${id}`);
    productIds.add(id);
    assert(Array.isArray(product.options), `${appKey} product ${id} must return an options array`);
    const optionIds = new Set();
    for (const option of product.options) {
      assert(option && isId(option.optionId), `${appKey} product ${id} has an invalid optionId`);
      const optionId = String(option.optionId);
      assert(!optionIds.has(optionId), `${appKey} product ${id} has duplicate optionId ${optionId}`);
      optionIds.add(optionId);
    }
  }
};
