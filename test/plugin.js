/* global jest */

class Plugin {
  constructor(params = {}) {
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });
  }

  validateToken = jest.fn();

  getProduct = jest.fn();

  searchHotelBooking = jest.fn();
}

module.exports = Plugin;
