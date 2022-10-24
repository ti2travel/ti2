const typeDefs = `
  input UnitWithQuantity {
    unitId: ID
    quantity: Int
  }
  type Pricing {
    unitId: ID
    original: Int
    retail: Int
    net: Int
    currencyPrecision: Int
  }
  type Offer {
    offerId: ID
    title: String
    description: String
  }
  type Query {
    key(productId: String, optionId: String, currency: String, unitsWithQuantity: [UnitWithQuantity], jwtKey: String): String
    dateTimeStart: String
    dateTimeEnd: String
    allDay: Boolean
    vacancies: Int
    available: Boolean
    pricing: Pricing
    unitPricing: [Pricing]
    offer: Offer
  }
`;

const query = `query getAvailability ($pId: String, $oId: String, $currency: String, $unitsWithQuantity: [UnitWithQuantity], $jwtKey: String) {
  key (productId: $pId, optionId: $oId, currency: $currency, unitsWithQuantity: $unitsWithQuantity, jwtKey: $jwtKey)
  dateTimeStart
  dateTimeEnd
  allDay
  vacancies
  available
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
