/* globals jest */
const faker = require('faker');
const { fieldSets } = require('../__fixtures__/fieldData');

module.exports = () => ({
  validateToken: jest.fn(() => true),
  getProfile: jest.fn(() => fieldSets.profile.leftSide),
  updateProfile: jest.fn(() => true),
  getLocations: jest.fn(() => fieldSets.locations.leftSide.locations),
  getLocation: jest.fn(() => fieldSets.locations.leftSide.locations[0]),
  createLocation: jest.fn(() => ({ locationId: faker.random.uuid() })),
  updateLocation: jest.fn(() => true),
  getProducts: jest.fn(),
  getProduct: jest.fn(),
  createProduct: jest.fn(() => (({ productId: faker.random.uuid() }))),
  updateProduct: jest.fn(() => true),
});
