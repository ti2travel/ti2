/* global jest, expect */
/* eslint class-methods-use-this: "off", max-len: "off" */
const R = require('ramda');

const jestPlugin = (() => {
  if (typeof jest === 'undefined') {
    return {
      fn: fn => fn,
    };
  }
  return jest;
})();

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
    this.validateToken = jestPlugin.fn(() => true);
    this.getProfile = jestPlugin.fn(() => {});
    this.updateProfile = jestPlugin.fn(() => {});
    this.getProduct = jestPlugin.fn(() => ({ products: [] }));
    this.getProducts = jestPlugin.fn(() => true);
    this.createLocation = jestPlugin.fn(() => ({ locationId: chance.guid() }));
    this.updateLocation = jestPlugin.fn(() => true);
    this.searchBooking = jestPlugin.fn(() => ({ bookings: [] }));
    this.searchProducts = jestPlugin.fn(() => ({ bookings: [], products: [] }));
    this.searchAvailability = jestPlugin.fn(({
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
    this.searchQuote = jestPlugin.fn(() => ({ quote: [{ id: chance.guid() }] }));
    this.createBooking = jestPlugin.fn(() => {});
    this.searchItineraries = jestPlugin.fn(() => ({ bookings: [] }));
    this.searchProductsForItinerary = jestPlugin.fn(() => ({ products: [] }));
    this.searchAvailabilityForItinerary = jestPlugin.fn(({
      token,
      payload: {
        optionId,
        startDate,
        paxConfigs,
      },
    }) => {
      expect(token).toBeTruthy();
      expect(optionId).toBeTruthy();
      expect(startDate).toBeTruthy();
      expect(paxConfigs).toBeTruthy();
      return { bookable: true, rates: [{ rateId: 'Default' }] };
    });
    this.getCreateItineraryFields = jestPlugin.fn(() => ({
      customFields: [],
    }));
    this.addServiceToItinerary = jestPlugin.fn(() => ({
      message: '',
      booking: {
        id: chance.guid(),
        reference: chance.guid(),
        linePrice: chance.guid(),
        lineId: chance.guid(),
      },
    }));

    this.queryAllotment = jestPlugin.fn(async args => {
      const {
        axios,
        payload,
      } = args;
      if (payload.keyPath === 'errorAxios') {
        await axios.get('http://www.example.com');
      }
      if (payload.keyPath === 'errorGeneral') {
        await axios.get('http://www.example.com');
      }
      return { allotments: [] };
    });
    this.tokenTemplate = jestPlugin.fn(() => ({
      apiKey: {
        type: 'text',
        regExp: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
        description: 'Api Key',
      },
    }));
    this.errorPathsAxiosErrors = jestPlugin.fn(() => ([
      ['response', 'data', 'what'],
    ]));
    this.errorPathsAxiosAny = jestPlugin.fn(() => ([
      err => {
        return R.path(['data', 'error'], err);
      }
    ]));

    /**
     * Background and schedule Jos
     */
    this.jobs = [{
      method: 'dailyReport',
      payload: {
        action: 'report',
      },
      cron: '0 9 * * *',
    }];

    this.dailyReport = jestPlugin.fn(() => ({
      someVal: true,
    }));
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
   * Returns the the token template of a plugin.
   * Properties are dynamic since every attribute should correspond to a token
   * key, every attribute should contain at least the type (ie text) a regExp and 
   * a description.
   * The regExp property gets decomposed into both source and flags as strings.
   */
  tokenTemplate() {
    return {};
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

  searchHotelBooking = jestPlugin.fn(() => ({ bookings: [] }));

  /**
   * Booking Object
   * @typedef {Object} Booking
   * @property {string} id Booking unique identifier.
   * @property {Cancelled|Active|Pending} status The currrent booking status.
   * @property {Holder} holder Booking holder information.
   * @property {string} telephone Contact telephone.
   * @property {string} supplierBookingId Booking Id for the supplier booking system
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
   * Retrieve an availability calendar over a date range
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
  availabilityCalendar() {
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

  /**
   * @typedef {Object} Passenger
   * @property {string} firstName - Passenger first name
   * @property {string} lastName - Passenger last name
   * @property {PassengerType} passengerType - Passenger type
   * @property {number} [age] - Passenger age
   * @property {string} [dob] - Date of birth (YYYY-MM-DD)
   * @property {string} [personId] - Unique identifier for the passenger
   */

  /**
   * @typedef {('Single'|'Double'|'Twin'|'Triple'|'Quad'|'Other')} RoomType
   */

  /**
   * @typedef {('Adult'|'Child'|'Infant')} PassengerType
   */

  /**
   * @typedef {Object} PaxConfig - At least one of adults, children or infants must be provided
   * @property {RoomType} [roomType] - Room type
   * @property {number} [adults] - Number of adults
   * @property {number} [children] - Number of children
   * @property {number} [infants] - Number of infants
   * @property {Array<Passenger>} [passengers] - List of passengers for this pax config
   */

  /**
   * @typedef {Object} PUDOInfo
   * @property {string} [time] - Travel time
   * @property {string} [location] - Location details
   * @property {string} [flightDetails] - Flight information
   */


  // ItineraryProduct Related Types
  /**
   * @typedef {Object} ItineraryProductUnit
   * @property {RoomType|PassengerType} unitId - Unit identifier for Accommodation products, allowed values: 'Single', 'Double', 'Twin', 'Triple', 'Quad'; for Activity products, allowed values: 'Adult', 'Child', 'Infant'
   * @property {string} unitName - Unit name, can be the same as unitId
   * @property {ItineraryUnitRestriction} restrictions - Unit restrictions
   */

  /**
   * @typedef {Object} ItineraryUnitRestriction
   * @property {boolean} allowed - Whether the unit is available
   * @property {number} [minAge] - Minimum age requirement
   * @property {number} [maxAge] - Maximum age requirement
   */

  /**
   * @typedef {Object} ItineraryProductOption
   * @property {string} optionId - Option identifier, this identifier should be unique in a sense that it should be able to represent the option and the product. For example, if in your system the option identifier are 1, 2, 3, say the productId is '123', the optionId you provided to us should be something like '123-1' or '123-2' etc.
   * @property {string} optionName - Option name
   * @property {number} [lastUpdateTimestamp] - Last update time
   * @property {string} serviceType - Type of service, one of 'Accommodation', 'Activity', 'Transfer'
   * @property {Array<Extra>} extras - Extras allowed for this product option
   * @property {Array<ItineraryProductUnit>} units - Available units
   * @property {Object} restrictions - Aggregated restrictions of each unit for this product option
   * @property {boolean} [restrictions.roomTypeRequired] - Whether room type is required, if it's required, our IA tool will check if the roomType in the paxConfigs matches the roomType allowed in the option
   * @property {ItineraryUnitRestriction} [restrictions.Adult] - restrictions for adult
   * @property {ItineraryUnitRestriction} [restrictions.Child] - restrictions for child
   * @property {ItineraryUnitRestriction} [restrictions.Infant] - restrictions for infant
   * @property {ItineraryUnitRestriction} [restrictions.Single] - restrictions for Single room type
   * @property {ItineraryUnitRestriction} [restrictions.Double] - restrictions for Double room type
   * @property {ItineraryUnitRestriction} [restrictions.Twin] - restrictions for Twin room type
   * @property {ItineraryUnitRestriction} [restrictions.Triple] - restrictions for Triple room type
   * @property {ItineraryUnitRestriction} [restrictions.Quad] - restrictions for Quad room type
   */

  /**
   * @typedef {Object} ItineraryProduct - An itinerary product contains two levels: product, option. For accommodation products, the product is the hotel, the option is the room name (Deluxe Room, Ocean View Room, etc). For activity products, the product is the Tour Company, the option is the activity type (e.g. Full Day, Half Day, etc). Specific data examples will be provided in the tutorial page.
   * @property {string} productId - ItineraryProduct identifier
   * @property {string} productName - ItineraryProduct name
   * @property {Array<string>} [serviceTypes] - Types of services offered: ['Accommodation', 'Activity', 'Transfer']
   * @property {Array<ItineraryProductOption>} options - Available options
   */

  // Booking Related Types
  /**
   * @typedef {Object} CustomFieldValue
   * @property {string} id - Custom Field identifier
   * @property {string} value - Field value
   */

  /**
   * @typedef {Object} Extra
   * @property {string} id - Extra identifier
   * @property {string} name - Extra name
   */

  /**
   * @typedef {Object} ItineraryServiceLine
   * @property {string} serviceLineId - Service line identifier
   * @property {string} optionId - Option identifier
   * @property {string} optionName - Option name
   * @property {string} [supplierName] - Supplier name
   * @property {string} [supplierId] - Supplier id
   * @property {string} startDate - Start date (YYYY-MM-DD)
   * @property {Array<PaxConfig>} paxConfigs - List of pax configs for this service line
   * @property {Array<Passenger>} paxList - List of passengers for this service line
   */

  /**
   * @typedef {Object} ItineraryBooking
   * @property {string} bookingId - Unique booking identifier
   * @property {string} name - Booking name
   * @property {string} bookingStatus - Booking status
   * @property {string} ref - Booking reference
   * @property {string} agentRef - external booking reference
   * @property {string} totalPrice - Total price of the booking
   * @property {string} travelDate - Start Date of travel (YYYY-MM-DD)
   * @property {string} enteredDate - Date of booking (YYYY-MM-DD)
   * @property {ItineraryServiceLine[]} serviceLines - Booked service lines
  */

  /**
   * @typedef {('yes-no'|'short'|'long'|'count'|'extended-option')} CustomFieldTypes
  /**
   * @typedef {Object} CreateItineraryCustomField
   * @property {string} id - Custom Field identifier
   * @property {string} label - Custom Field label
   * @property {CustomFieldTypes} type - Custom Field type
   * @property {boolean} [isPerService] - Whether the custom field is per service, or per entire booking/quote
   * @property {Array<Object>} [options] - Options if the type is extended-option
   * @property {Object} options.value - Option value
   * @property {Object} options.label - Option label
   */

  /**
   * Search for bookable products
   * @async
   * @param {Object} args
   * @param {Object} args.token - Authentication token
   * @param {object} args.payload - Search criteria
   * @param {string} [args.payload.productId] - Optional specific product to search for
   * @param {string} [args.payload.optionId] - Optional specific product option to search for
   * @param {string} [args.payload.searchInput] - Optional text search across all fields
   * @param {boolean} [args.payload.forceRefresh] - Optional flag to bypass cache
   * @returns {object} retVal - the return object.
   * @returns {Array<ItineraryProduct>} retVal.products - An array of products spec objects.
   */
  searchProductsForItinerary() {}

  /**
   * @typedef {Object} SearchAvailabilityForItineraryResponse
   * @property {boolean} bookable - Whether the product is bookable
   * @property {Array} [rates] - If there are multiple rates, they will be returned in this array
   * @property {string} rates[].rateId - It's ok if you don't use such a thing as rateId in your internal system, but you can use it to package important information so we can make a booking. For example, you can do jwt.encode({ foo: 'bar' }, secret) and send it to us here, and later when we make a booking, we send the rateId to you so you can decode it and get the foo: 'bar' information.
   * @property {string} [rates[].externalRateText] - Combined rate description
   */
  /**
   * Search for product availability
   * @async
   * @param {Object} args
   * @param {Object} args.token - Authentication token
   * @param {object} args.payload - Search criteria
   * @param {string} args.payload.optionId - ItineraryProduct option ID
   * @param {string} args.payload.startDate - YYYY-MM-DD format
   * @param {Array<PaxConfig>} args.payload.paxConfigs - Required for room-based products
   * @param {number} [args.payload.chargeUnitQuantity=1] - Number of units to book
   * @returns {SearchAvailabilityForItineraryResponse}
   */
  searchAvailabilityForItinerary() {}

  /**
   * @typedef {Object} AddServiceToItineraryResponse
   * @property {string} message - Error message
   * @property {object} booking - Booking object
   * @property {string} booking.id - Booking identifier from your system
   * @property {string} booking.reference - Reference number from your system
   * @property {string} booking.linePrice - Price of the booking line
   * @property {string} booking.lineId - Line identifier from your system
  */
  /**
   * Create an itinerary
   * @async
   * @param {Object} args
   * @param {Object} args.token - Authentication token
   * @param {object} args.payload - Booking/Quote details
   * @param {string} args.payload.QB - 'Q' for quote, 'B' for booking
   * @param {string} args.payload.quoteName - Name of the booking/quote
   * @param {string} [args.payload.quoteId] - identifier of the booking/quote, if one is provided, we are expecting the service line to be inserted to an existing booking/quote
   * @param {string} [args.payload.lineId] - identifier of the service line in the booking/quote, if one is provided, we are expecting an existing service line to be updated
   * @param {string} [args.payload.rateId] - Rate identifier, we are sending 'Default' if no rates are provided by the check availability call
   * @param {string} args.payload.optionId - Option identifier of the service line
   * @param {string} args.payload.startDate - Start date always in (YYYY-MM-DD) format
   * @param {string} [args.payload.reference] - Reference number from external system
   * @param {Array<PaxConfig>} args.payload.paxConfigs - Passenger configurations
   * @param {Array<Object>} [args.payload.extras] - Additional extras
   * @param {Extra} args.payload.extras.selectedExtra - Selected extra
   * @param {number} args.payload.extras.quantity - quantity
   * @param {PUDOInfo} [args.payload.puInfo] - Pickup information
   * @param {PUDOInfo} [args.payload.doInfo] - Dropoff information
   * @param {string} [args.payload.notes] - Additional notes
   * @param {Array<CustomFieldValue>} [args.payload.customFieldValues] - Custom field values
   * @returns {AddServiceToItineraryResponse}
   */
  addServiceToItinerary() {}

  /**
   * Some additional fields available for the addServiceToItinerary call
   * @async
   * @param {Object} args
   * @param {Object} args.token - Authentication token
   * @returns {object} retVal - the return object.
   * @returns {Array<CreateItineraryCustomField>} retVal.customFields - An array of custom fields spec objects.
   */
  getCreateItineraryFields() {}

  /**
   * Allotment Object
  /**
   * @typedef {Object} Allotment
   * @property {string} name - The name of the allotment.
   * @property {string} description - A description of the allotment.
   * @property {string} appliesTo - Specifies what the allotment applies to.
   * @property {string} splitCode - The code used to split the allotment.
   * @property {string} unitType - The type of unit used for the allotment.
   * @property {Date} date - The date associated with the allotment using the input format.
   * @property {string} release - The release period of the allotment as specified in the day inventory.
   * @property {number} max - The maximum quantity allowed for the allotment as specified in the day inventory.
   * @property {number} booked - The booked quantity of the allotment as specified in the day inventory.
   * @property {boolean} request - Indicates whether requests are allowed for the allotment, based on the day inventory.
   * @property {string[]} keyPaths - An array of key paths generated by combining supplier code and product codes.
   */

  /**
   * Search for itineraries
   * @async
   * @param {Object} args
   * @param {Object} args.token - Authentication token
   * @param {object} args.payload - Search criteria
   * @param {string} args.payload.purchaseDateStart - Start date for purchase search (YYYY-MM-DD)
   * @param {string} args.payload.purchaseDateEnd - End date for purchase search (YYYY-MM-DD)
   * @param {string} args.payload.travelDateStart - Start date for travel search (YYYY-MM-DD)
   * @param {string} args.payload.travelDateEnd - End date for travel search (YYYY-MM-DD)
   * @param {string} args.payload.name - Search by customer name
   * @param {string} args.payload.bookingId - Search by booking ID
   * @returns {object} retVal - the return object.
   * @returns {Array<ItineraryBooking>} retVal.bookings - An array of itinerary bookings matching search criteria.
   */
  searchItineraries() {}

  /**
   * Query Allotment
   * @async
   * @param {Object} args - Allotment query arguments.
   * @param {Object} args.token - A token definition, it's content varies between integrations.
   * @param {Object} args.payload - Search spect object.
   *      dateFormat = 'DD/MM/YYYY',
      startDate,
      endDate,
      keyPath,
   * @param {string} args.payload.dateFormat - Date format to use for params and return value (i.e. DD/MM/YYYY
   * @param {string} args.payload.startDate - Start date for the query of allotment objects
   * @param {string} args.payload.endDate - End date for the query of allotment objects
   * @param {string} args.payload.keyPath - End date for the query of allotment objects
   * @returns {object} retVal - the return object.
   * @returns {Allotment[]} retVal.allotment - An array of allotment spec objects.
   */
  queryAllotment() {}
}

module.exports = Plugin;
