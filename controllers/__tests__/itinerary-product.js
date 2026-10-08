/* globals describe it expect */

const { buildSchema, graphql } = require('graphql');
const Plugin = require('../../test/plugin');
const {
  typeDefs,
  query,
} = require('../graphql-schemas/itinerary-product');

const schema = buildSchema(typeDefs);

const runStockQuery = rootValue => graphql({
  schema,
  source: query,
  rootValue,
});

const productById = (products, productId) => (
  products.find(product => product.productId === productId)
);

describe('itinerary product contract', () => {
  const { products } = new Plugin().searchProductsForItinerary();

  it('returns the optional fields Tourplan plugins fill', async () => {
    const tourplan = await runStockQuery(productById(products, 'tourplan'));
    const tourplannx = await runStockQuery(productById(products, 'tourplannx'));

    expect(tourplan.errors).toBeUndefined();
    expect(tourplannx.errors).toBeUndefined();
    expect(tourplan.data.description).toBe('Hotel near Kings Cross');
    expect(tourplan.data.options[0]).toMatchObject({
      city: 'London',
      country: 'United Kingdom',
      currency: 'GBP',
      optionClass: 'Private',
      chargeUnit: 'day',
    });
    expect(tourplan.data.options[0].restrictions.Other).toBeNull();
    expect(tourplan.data.options[0].units[0].restrictions.maxPaxWithInfants).toBeNull();
    expect(tourplannx.data.options[0]).toMatchObject({
      city: 'Auckland',
      country: 'New Zealand',
      currency: 'NZD',
      optionClass: '3*',
      chargeUnit: 'night',
    });
    expect(tourplannx.data.options[0].units[0].restrictions.maxPaxWithInfants).toBe(999);
    expect(tourplannx.data.options[0].restrictions.Other).toMatchObject({
      allowed: true,
      maxPax: 2,
      maxAdults: 2,
      maxPaxWithInfants: 3,
    });
    expect(tourplannx.data.options[0].restrictions.Twin.maxPaxWithInfants).toBe(0);
  });

  it('keeps products that omit the new optional fields', async () => {
    const legacy = await runStockQuery(productById(products, 'legacy'));

    expect(legacy.errors).toBeUndefined();
    expect(legacy.data.description).toBeNull();
    expect(legacy.data.options[0]).toMatchObject({
      optionId: 'legacy-1',
      optionName: 'Standard',
      city: null,
      country: null,
      currency: null,
      optionClass: null,
      chargeUnit: null,
    });
    expect(legacy.data.options[0].units[0].restrictions.maxPaxWithInfants).toBeNull();
    expect(legacy.data.options[0].restrictions.Other).toBeNull();
    expect(legacy.data.options[0].restrictions.Double).toMatchObject({
      allowed: true,
      maxPax: 2,
      maxAdults: 2,
      maxPaxWithInfants: null,
    });
  });
});
