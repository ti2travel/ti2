const typeDefs = `

  type Extra {
    id: ID!
    name: String!
    chargeBasis: String
    isCompulsory: Boolean
    isPricePerPerson: Boolean
  }

  type UnitRestriction {
    allowed: Boolean
    minAge: Int
    maxAge: Int
    maxPax: Int
    maxAdults: Int
  }

  type OptionRestrictions {
    roomTypeRequired: Boolean
    Adult: UnitRestriction
    Child: UnitRestriction
    Infant: UnitRestriction
    Single: UnitRestriction
    Double: UnitRestriction
    Twin: UnitRestriction
    Triple: UnitRestriction
    Quad: UnitRestriction
  }

  type ProductUnit {
    unitId: ID!
    unitName: String!
    restrictions: UnitRestriction
  }

  type ProductOption {
    optionId: ID!
    optionName: String!
    lastUpdateTimestamp: Int
    serviceType: String
    extras: [Extra]
    units: [ProductUnit]
    restrictions: OptionRestrictions
  }

  type Query {
    productId: ID!
    productName: String!
    address: String
    description: String
    serviceTypes: [String]
    options: [ProductOption]
  }
`;

const query = `{
  productId
  productName
  description
  serviceTypes
  address
  options {
    optionId
    optionName
    lastUpdateTimestamp
    serviceType
    extras {
      id
      name
      chargeBasis
      isCompulsory
      isPricePerPerson
    }
    units {
      unitId
      unitName
      restrictions {
        allowed
        minAge
        maxAge
        maxPax
        maxAdults
      }
    }
    restrictions {
      roomTypeRequired
      Adult {
        allowed
        minAge
        maxAge
      }
      Child {
        allowed
        minAge
        maxAge
      }
      Infant {
        allowed
        minAge
        maxAge
      }
      Single {
        allowed
        maxPax
        maxAdults
      }
      Double {
        allowed
        maxPax
        maxAdults
      }
      Twin {
        allowed
        maxPax
        maxAdults
      }
      Triple {
        allowed
        maxPax
        maxAdults
      }
      Quad {
        allowed
        maxPax
        maxAdults
      }
    }
  }
}`;

module.exports = {
  typeDefs,
  query,
};
