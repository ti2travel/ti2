const typeDefs = `
  type Passenger {
    firstName: String!
    lastName: String!
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

  type ServiceLine {
    serviceLineId: ID!
    optionId: ID!
    optionName: String!
    startDate: String!
    supplierName: String
    supplierId: String
    paxList: [Passenger]
    paxConfigs: [PaxConfig]
  }

  type Query {
    bookingId: ID!
    name: String!
    bookingStatus: String!
    ref: String!
    agentRef: String
    totalPrice: String!
    travelDate: String!
    enteredDate: String!
    serviceLines: [ServiceLine]!
  }
`;

const query = `{
  name
  bookingId
  bookingStatus
  ref
  agentRef
  totalPrice
  travelDate
  enteredDate
  serviceLines {
    serviceLineId
    optionId
    optionName
    supplierName
    supplierId
    startDate
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
