/**
 * SDL + document for ti2 plugins
 */
const typeDefs = `
  type Passenger {
    firstName: String
    lastName: String
    passengerType: String!
    age: Int
    dob: String
    personId: String
  }

  type PaxConfig {
    roomType: String
    adults: Int
    children: Int
    infants: Int
    passengers: [Passenger]
  }

  type PuDoInfo {
    date: String
    time: String
    remarks: String
  }

  type ServiceLine {
    serviceLineId: ID!
    serviceLineUpdateCount: Int
    optionId: String!
    optionName: String
    linePrice: String
    quantity: Int
    startDate: String!
    supplierName: String
    supplierId: String
    paxList: [Passenger]
    paxConfigs: [PaxConfig]
    status: String
    puInfo: PuDoInfo
    doInfo: PuDoInfo
  }

  type Query {
    bookingId: ID!
    name: String!
    bookingStatus: String
    bookingStatusId: String
    isBooking: Boolean
    bookingAgent: String
    ref: String!
    agentRef: String
    agentId: String
    totalPrice: String!
    currency: String!
    travelDate: String!
    enteredDate: String!
    canEdit: Boolean!
    serviceLines: [ServiceLine]!
  }
`;

const query = `{
  name
  bookingId
  bookingStatus
  bookingStatusId
  isBooking
  bookingAgent
  ref
  agentRef
  agentId
  totalPrice
  currency
  travelDate
  enteredDate
  canEdit
  serviceLines {
    serviceLineId
    serviceLineUpdateCount
    linePrice
    quantity
    optionId
    optionName
    supplierId
    supplierName
    startDate
    status
    puInfo {
      date
      time
      remarks
    }
    doInfo {
      date
      time
      remarks
    }
    paxConfigs {
      roomType
      adults
      children
      infants
      passengers {
        firstName
        lastName
        passengerType
        age
        dob
        personId
      }
    }
    paxList {
      firstName
      lastName
      passengerType
      age
      dob
      personId
    }
  }
}`;

module.exports = {
  typeDefs,
  query,
};
