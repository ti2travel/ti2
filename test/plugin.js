/* global jest, expect */
const chance = require('chance').Chance();

class Plugin {
  /**
   * For a comprehensive list of methods visit the
   * [Plugin Development]{@tutorial plugin-development} page.
   *
   * ---
   *
   * @param {Object} args - New / Overwriting attributes for the Plugin.
   */
  constructor(params = {}) {
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });
    // mock implementations
    this.validateToken = jest.fn(() => true);
    this.getProfile = jest.fn(() => {});
    this.updateProfile = jest.fn(() => {});
    this.getProduct = jest.fn(() => ({ products: [] }));
    this.getProducts = jest.fn(() => true);
    this.createLocation = jest.fn(() => ({ locationId: chance.guid() }));
    this.updateLocation = jest.fn(() => true);
    this.searchBooking = jest.fn(() => ({ bookings: [] }));
    this.searchProducts = jest.fn(() => ({ bookings: [], products: [] }));
    this.searchAvailability = jest.fn(({
      token,
      payload: {
        travelDateStart,
        travelDateEnd,
        dateFormat,
        occupancies,
      },
    }) => {
      expect(token).toBeTruthy();
      expect(travelDateStart).toBeTruthy();
      expect(travelDateEnd).toBeTruthy();
      expect(dateFormat).toBeTruthy();
      expect(Array.isArray(occupancies)).toBeTruthy();
      return { availability: [{ id: chance.guid() }] };
    });

    this.searchQuote = jest.fn(() => ({ quote: [{ id: chance.guid() }] }));
    this.createBooking = jest.fn(() => {});
  }

  /**
   *  Check the validity of an integration token.
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @returns {Boolean} - The token validity True/False
   */
  validateToken() {
    return Boolean(this);
  }
  /**
   * GPS Location Object
   * @typedef {Object} GPSLocation
   * @property {String} lat - GPS latitude
   * @property {String} lng - GPS Longitude
   */

  /**
   * Address Object
   * @typedef {Object} Address
   * @property {string} addressOne - Street Address first line of text
   * @property {string} addressTwo - Street Address second line of text
   * @property {string} city - City
   * @property {string} state - State
   * @property {string} zipCode - Zip/Postal Code
   * @property {GPSLocation} loc -Location
   */

  /**
   * Profile Object
   * @typedef {Object} Profile
   * @property {string} companyName
   * @property {Address} address
   */

  /**
   * Returns the profile details of the account.
   * @category Methods
   * @subcategory Content
   * Returns the profile details of the account.
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @returns {Profile} - The profile details.
   */
  getProfile() {
    return {};
  }

  /**
   * Updates profile information
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Profile} args.payload - Updated profile information
   * @returns {boolean} - True/False success status.
   */
  updateProfile() {
    return {};
  }

  /**
   * Location Object
   * @typedef {Object} Location
   * @property {string} telephone
   * @property {Address} address
   */

  /**
   * Create a Location
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Location} args.payload - The new location details.
   * @returns {Object} retVal - An object containing return values.
   * @returns {string} retVal.locationId - The new location unique identifier.
   */
  createLocation() {
    return { locationId: chance.guid() };
  }

  /**
   * Update a Location
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {string} args.locationId - The unique identifier of the location to update.
   * @param {Location} args.payload - The new location details.
   * @returns {boolean} - True/False success status.
   */
  updateLocation() {
    return true;
  }
  /**
   * Media Object
   * @typedef {Object} Media - Media Details
   * @property {string} mediaType - MimeType of media
   * @property {string} url - URL of media
   */

  /**
   * Media Collection
   * @typedef {Object} MediaCollection - Media Collection, grouped by type
   * @property {Array.Media} image
   * @property {Array.Media} video
  */

  /**
   * Room Object
   * @typedef {Object} RoomInfo - Room details object
   * @property {number} count - Number of rooms
   * @property {string} bedType - Bedding type
   * @property {string} other - Exta Information
   */

  /**
   * Value and UUnit spec
   * @typedef {Object} ValueUnit - ValueDetails fields
   * @property {string} unit - A unit specification
   * @property {number} value - The number of units
   */

  /**
   * Get the product details related to a location
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Object} args.locationId - A location unique identifier for the matching product.
   * @param {Object} args.productId - The product unique identifier.
   * @returns {Object} retVal - A return object.
   * @returns {Product} retVal.product - Details of the matching product.
   */
  /**
   * ProductInfo type
   * @typedef ProductInfo
   * @property {string} include
   * @property {string} exclude
   * @property {string} whatToBring
   */
  /**
   * bedsAndSofas type
   * @typedef BedsAndSofas
   * @property {boolean} isApartment
   * @property {numeric} count
   * @property {string} other
   */
  /**
   * Product Object
   * @typedef {Object} Product - Product information Object
   * @property {string} productId - A unique identifier for a product
   * @property {string} productName
   * @property {('accommodation'|'non-accommodation')} productType
   * @property {string} productCode
   * @property {string} description
   * @property {string} notes
   * @property {string} coverImageUrl
   * @property {boolean} interconnectingRooms
   * @property {string} amenities
   * @property {ValueUnit} roomCountInfo
   * @property {MediaCollection} media
   * @property {ValueUnit} roomSizeInfo
   * @property {ValueUnit} tourDuration
   * @property {number} totalMaxPassengers
   * @property {number} totalMinPassengers
   * @property {ValueUnit} totalDuration
   * @property {boolean} tourDurationDoesNotApply
   * @property {ProductInfo} productInfo
   * @property {BedsAndSofas} bedsAndSofas
   */
  getProduct() {
    return {};
  }

  /**
   * Get the list of products for a given location
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Object} args.locationId - A location unique identifier to get the list of products.
   * @returns {Object} retVal - An object containing return values.
   * @returns {Array.Product} retVal.products - An array of matching products.
   */
  getProducts() {
    return { products: [] };
  }

  /**
   * Create a Product
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {string} args.locationId - The unique identifier of the location that will contain the product.
   * @param {Product} args.payload - The new product details.
   * @returns {Object} retVal - An object containing return values.
   * @returns {string} retVal.locationId - The new location unique identifier.
   */
  createProduct() {
    return { locationId: chance.guid(), productId: chance.guid() };
  }

  /**
   * Update a Product
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {string} args.locationId - The unique identifier of the location that contains the product.
   * @param {string} args.productId - The unique identifier of the product to update.
   * @param {Product} args.payload - The new location details.
   * @returns {boolean} - True/False success status.
   */
  updateProduct() {
    return true;
  }

  searchHotelBooking = jest.fn(() => ({ bookings: [] }));

  /**
   * Booking Object
   * @typedef {Object} Booking
   * @property {string} id Booking unique identifier.
   * @property {Cancelled|Active|Pending} status The currrent booking status.
   * @property {Holder} holder Booking holder information.
   * @property {string} telephone Contact telephone.
   * @property {string} supplierId Supplier of the Booking
   * @property {string} hotelId A HotelId if the booking is for an accommodation.
   * @property {string} hotelName A Hotel Name if the booking is for an accommodation.
   * @property {BookingRoom[]} rooms Booking Room details.
   * @property {string} start CheckIn.
   * @property {string} end CheckOut.
   * @property {string} bookingDate Date when the booking was created.
   * @property {numeric} price Total price for the booking.
   * @property {CancelPolicy} cancelPolicy Cancellation policies for the booking.
   */
  /**
   * Booking Room
   * @typedef {Object} BookingRoom
   * @property {string} roomId
   * @property {string} description
   * @property {numeric} price
   */

  /**
   * Cancel Policy
   * @typedef {Object} CancelPolicy
   * @property {boolean} refundable
   * @property {string} cancelPenalties
   */

  /**
   * Search for bookings with a criteria.
   * @async
   * @param {Object} args - Booking search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Object} args.payload - Search criteria object.
   * @param {string} args.payload.bookingId - a Booking Id.
   * @param {string} args.payload.dateFormat - Date format sent, using [momentjs formatting](https://momentjs.com/docs/#/parsing/string-format/).
   * @param {string} args.payload.purchaseDateStart - Date of purchase start.
   * @param {string} args.payload.purchaseDateEnd - Date of purchase end.
   * @param {string} args.payload.travelDateStart - Date of travel start.
   * @param {string} args.payload.travelDateEnd - Date of travel end.
   * @param {Holder} args.payload.holder - Search for a particular holder.
   * @returns {object} retVal - the return object.
   * @returns {Booking[]} retVal.bookings - Array of Bookings matching the criteria.
   */
  searchBooking() {
  }

  /**
   * Search for bookable products
   * @async
   * @param {Object} args - Product search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Object} args.payload - Search criteria object.
   * @returns {object} retVal - the return object.
   * @returns {Hotel[]} retVal.hotels - Array of bookable hotels.
   * @returns {Product[]} retVal.products - Array of bookable activities.
   * @todo Define search criteria and Hotel/Product spec.
   */
  searchProducts() {
  }

  /**
   * Occupancy Object
   * @typedef {Object} Occupancy
   * @property {Pax[]} paxes
   */
  /**
   * A Pax item with an age spec.
   * @typedef {Object} Pax
   * @property {number} age Age in years of the pax when the startDate starts on local timezone.
   */
  /**
   * An availability return spec.
   * @typedef {Object} Availability
   * @property {string} id An identifier that can be used to retrieve a quote.
   */
  /**
   * A booking holder spec.
   * @typedef {Object} Holder
   * @property {string} name The booking's holder first name (s).
   * @property {string} surname Surname / Last Name(s) for the booking holder.
   * @property {string} email The booking's holder email.
   */
  /**
   * Search for availability of products winthin dates of travel.
   * @async
   * @param {Object} args - Availability search arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Object} args.payload - Search spect object.
   * @param {string} args.payload.dateFormat - Date format sent, using [momentjs formatting](https://momentjs.com/docs/#/parsing/string-format/).
   * @param {string} args.payload.travelDateStart - Date of travel start.
   * @param {string} args.payload.travelDateEnd - Date of travel end.
   * @param {Occupancy[]} args.payload.occupancies - Occupancy detail.
   * @returns {object} retVal - the return object
   * @returns {Availability[]} retVal.availability - Array of availability objects
   */
  searchAvailability() {
    // return (args);
  }

  /**
   * A quote return spec
   * @typedef {Object} Quote
   * @property {string} id An identifier that can be used to create a booking.
   */
  /**
   * Quote an availability.
   * @async
   * @param {Object} args - Availability quote arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Object} args.payload - Search spect object.
   * @param {string} args.payload.id - An availability Id.
   * @returns {object} retVal - the return object.
   * @returns {Quote} retVal.quote - A Quote Object instance.
   */
  searchQuote() {
    // return (args);
  }

  /**
   * Create a Booking
   * @async
   * @param {Object} args - Booking arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Object} args.payload - Search spect object.
   * @param {string} args.payload.id - A quote id.
   * @param {Holder} args.payload.holder - Contact information of the booking holder.
   * @returns {object} retVal - the return object.
   * @returns {Booking} retVal.booking - A Booking object.
   */
  createBooking() {}
}

module.exports = Plugin;
