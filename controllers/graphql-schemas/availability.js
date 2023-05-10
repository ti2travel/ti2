const typeDefs = `
  input UnitWithQuantity {
    unitId: ID
    quantity: Int
  }
  type Pricing {
    unitId: ID
    original: Float
    retail: Float
    net: Float
    currencyPrecision: Int
  }
  type Offer {
    offerId: ID
    title: String
    description: String
  }
  type PickupPoint {
    id: ID
    name: String
    pickupAvail: Boolean
    directions: String
    latitude: Float
    longitude: Float
    street: String
    postal: String
    city: String
    state: String
    country: String
    localDateTime: String
  }
  type Query {
    key(productId: ID, optionId: ID, currency: String, unitsWithQuantity: [UnitWithQuantity], jwtKey: String): String
    dateTimeStart: String
    dateTimeEnd: String
    allDay: Boolean
    vacancies: Int
    available: Boolean
    pricing: Pricing
    unitPricing: [Pricing]
    offer: [Offer]
    pickupAvailable: Boolean
    pickupRequired: Boolean
    pickupPoints: [PickupPoint]
  }
`;

const query = `query getAvailability ($productId: ID, $optionId: ID, $currency: String, $unitsWithQuantity: [UnitWithQuantity], $jwtKey: String) {
  key (productId: $productId, optionId: $optionId, currency: $currency, unitsWithQuantity: $unitsWithQuantity, jwtKey: $jwtKey)
  dateTimeStart
  dateTimeEnd
  allDay
  vacancies
  available
  pickupAvailable
  pickupRequired
  pickupPoints {
    id
    name
    pickupAvail
    directions
    latitude
    longitude
    street
    postal
    city
    state
    country
    localDateTime
  }
  pricing {
    ...pricingFields
  }
  unitPricing {
    ...pricingFields
  }
  offer {
    offerId
    title
    description
  }
}
fragment pricingFields on Pricing {
  unitId
  original
  retail
  net
  currencyPrecision
}
`;
module.exports = {
  typeDefs,
  query,
};
