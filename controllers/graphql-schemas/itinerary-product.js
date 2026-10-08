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
    maxPaxWithInfants: Int
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
    Other: UnitRestriction
  }

  type ProductUnit {
    unitId: ID!
    unitName: String!
    restrictions: UnitRestriction
  }

  type ProductOption {
    optionId: ID!
    optionName: String!
    comment: String
    lastUpdateTimestamp: Int
    serviceType: String
    city: String
    country: String
    currency: String
    optionClass: String
    chargeUnit: String
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
    comment
    lastUpdateTimestamp
    serviceType
    city
    country
    currency
    optionClass
    chargeUnit
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
        maxPaxWithInfants
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
        maxPaxWithInfants
      }
      Double {
        allowed
        maxPax
        maxAdults
        maxPaxWithInfants
      }
      Twin {
        allowed
        maxPax
        maxAdults
        maxPaxWithInfants
      }
      Triple {
        allowed
        maxPax
        maxAdults
        maxPaxWithInfants
      }
      Quad {
        allowed
        maxPax
        maxAdults
        maxPaxWithInfants
      }
      Other {
        allowed
        maxPax
        maxAdults
        maxPaxWithInfants
      }
    }
  }
}`;

module.exports = {
  typeDefs,
  query,
};
