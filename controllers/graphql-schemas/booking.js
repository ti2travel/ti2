const typeDefs = `
  type Holder {
    name: String
    surname: String
    fullName: String
    phoneNumber: String
    emailAddress: String
  }
  type UnitItem {
    unitItemId: ID
    unitId: ID
    unitName: String
  }
  type Price {
    original: Int
    retail: Int
    net: Int
    currencyPrecision: Int
    currency: String
  }
  type Agent {
    id: Int
    name: String
  }
  type Desk {
    id: Int
    name: String
  }
  type Query {
    id: ID
    orderId: ID
    bookingId: ID
    supplierBookingId: ID
    status: String
    productId: String
    productName: String
    optionId: String
    optionName: String
    cancellable: Boolean
    editable: Boolean
    unitItems: [UnitItem]
    start: String
    end: String
    allDay: Boolean
    bookingDate: String
    holder: Holder
    notes: String
    price: Price
    cancelPolicy: String
    resellerReference: String
    publicUrl: String
    privateUrl: String
    agent: Agent
    desk: Desk
  }
`;

const query = `{
  id
  orderId
  bookingId
  supplierBookingId
  status
  productId
  productName
  optionId
  optionName
  cancellable
  editable
  unitItems {
    unitItemId
    unitId
    unitName
  }
  start
  end
  allDay
  bookingDate
  holder {
    name
    surname
    fullName
    phoneNumber
    emailAddress
  }
  notes
  price {
    original
    retail
    net
    currencyPrecision
    currency
  }
  cancelPolicy
  optionId
  resellerReference
  publicUrl
  privateUrl
  agent {
    id
    name
  }
  desk {
    id
    name
  }
}`;

module.exports = {
  typeDefs,
  query,
};
