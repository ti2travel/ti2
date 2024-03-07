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
    original: Float
    retail: Float
    net: Float
    currencyPrecision: Int
    currency: String
  }
  type Agent {
    id: String
    name: String
  }
  type Desk {
    id: String
    name: String
  }
  type PickupPoint {
    id: ID
    name: String
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
    id: ID
    orderId: ID
    orderReference: String
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
    pickupRequested: Boolean
    pickupPointId: ID
    pickupHotel: String
    pickupHotelRoom: String
    pickupPoint: PickupPoint
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
  pickupRequested
  pickupPointId
  pickupHotel
  pickupHotelRoom
  pickupPoint {
    id
    name
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
}`;

module.exports = {
  typeDefs,
  query,
};
