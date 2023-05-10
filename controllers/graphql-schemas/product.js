const typeDefs = `
  type Restriction {
    paxCount: Int
    minAge: Int
    maxAge: Int
  }
  type Pricing {
    original: Float
    retail: Float
    currency: String
    currencyPrecision: Int
  }
  type Unit {
    unitId: ID
    unitName: String
    subtitle: String
    restrictions: Restriction
    type: String
    pricing: [Pricing]
  }
  type Option {
    optionId: ID
    optionName: String
    units: [Unit]
  }
  type Query {
    productId: ID
    productName: String
    availableCurrencies: [String]
    defaultCurrency: String
    settlementMethods: [String]
    options: [Option]
  }
`;

const query = `{
  productId
  productName
  availableCurrencies
  defaultCurrency
  options {
    optionId
    optionName
    units {
      unitId
      unitName
      subtitle
      pricing {
        original
        retail
        currencyPrecision
        currency
      }
      restrictions {
        paxCount
        minAge
        maxAge
      }
    }
  }
}`;

module.exports = {
  typeDefs,
  query,
};
