## Core Functionality Requirements

### 1. Authentication
- Ability to validate credentials (username/password or API keys)
- Ability to 

### 2. Product Search & Details
Optional, but very nice to have:
- List products are filtered by the credentials
- 
Required output data structure:
```
interface ProductSearch {
  // Basic product details
  productId: string;
  productName: string;
  description?: string;
  
  // Supplier information
  supplierId: string;
  supplierName: string;
  supplierAddress?: string;
  
  // Product configuration
  serviceTypes: string[];  // e.g., ['Accommodation', 'Transfer', 'Activity']
  
  // Pricing units/options
  options: {
    optionId: string;
    optionName: string;
    lastUpdateTimestamp?: number;
    serviceType: string;
    
    // Room/capacity restrictions if applicable
    restrictions: {
      roomTypeRequired: boolean;
      maxPax?: number;
      ageRestrictions?: {
        minAge?: number;
        maxAge?: number;
      };
    };
    
    // Available units (rooms/seats/slots)
    units: {
      unitId: string;  // e.g., 'Single', 'Double', 'Adult', 'Child'
      unitName: string;
      pricing: any[];  // Pricing details
      restrictions: {
        allowed: boolean;
        paxCount?: number;
        minAge?: number;
        maxAge?: number;
      };
    }[];
  }[];
}
```


### 3. Availability Search
Required endpoint/data:
```
interface AvailabilityRequest {
  optionId: string;
  startDate: string;  // YYYY-MM-DD
  paxConfigs: {
    roomType?: string;  // For accommodation
    adults?: number;
    children?: number;
    infants?: number;
  }[];
  chargeUnitQuantity?: number;
}

interface AvailabilityResponse {
  bookable: boolean;
  rates: {
    rateId: string;
    externalRateText?: string;
  }[];
}
```


### 4. Booking/Quote Creation
Required capabilities:
```
interface QuoteRequest {
  quoteName: string;
  rateId?: string;
  quoteId?: string;  // For existing quotes
  optionId: string;
  startDate: string;
  reference?: string;
  
  paxConfigs: {
    roomType?: string;
    passengers?: {
      firstName: string;
      lastName: string;
      passengerType: 'Adult' | 'Child' | 'Infant';
      age?: number;
      dob?: string;
      personId?: string;
    }[];
  }[];
  
  extras?: {
    selectedExtra: {
      id: string;
    };
    quantity: number;
  }[];
  
  // Optional pickup/dropoff info
  puInfo?: {
    time?: string;
    location?: string;
    flightDetails?: string;
  };
  doInfo?: {
    time?: string;
    location?: string;
    flightDetails?: string;
  };
  
  notes?: string;
}
```


### 5. Booking Search/Retrieval

Required search capabilities:
```
interface BookingSearch {
  purchaseDateStart?: string;  // YYYY-MM-DD
  purchaseDateEnd?: string;    // YYYY-MM-DD
  bookingId?: string;
  name?: string;  // Customer name search
}
```

### Integration Approaches
## Option 1: Adapting to Existing APIs
If the third-party system has existing APIs:
1. Create mapping functions to transform their data structure to match our expected format
2. Handle data type conversions (e.g., dates, numbers, enums)
3. Implement error handling for their specific error responses
4. Cache responses where appropriate to improve performance

## Option 2: Custom API Development
If the third-party is building APIs specifically for us:
1. Provide them with our expected data structures
2. Share our GraphQL schemas for product and booking data
3. Define required endpoints and methods
4. Specify authentication mechanism
5. Document error handling expectations

## Additional Considerations

- Rate limiting and throttling requirements
- Caching strategies and TTL requirements
- Error handling and retry mechanisms
- Data validation requirements
- Testing environment availability
- Support for multiple currencies
- Handling of special characters and text encoding
- Timezone handling
Booking modification/cancellation capabilities
