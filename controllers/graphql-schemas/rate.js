const typeDefs = `
  type Pricing {
    original: Int
    retail: Int
    currency: Int
    currencyPrecision: Int
  }
  type Query {
    rateId: ID
    rateName: String
    unitId: ID
    unitName: String
    pricing: [Pricing]
  }
`;

const query = `{
  rateId
  rateName
  unitId
  unitName
  pricing {
    original
    retail
    currencyPrecision
    currency
  }
}`;

module.exports = {
  typeDefs,
  query,
};
