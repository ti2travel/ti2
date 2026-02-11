
### Important notes:
   - Required methods:
      - [searchProductsForItinerary]{@link Plugin#searchProductsForItinerary}
      - [searchAvailabilityForItinerary]{@link Plugin#searchAvailabilityForItinerary}
      - [addServiceToItinerary]{@link Plugin#addServiceToItinerary}
      - [searchItineraries]{@link Plugin#searchItineraries}
   - Optional methods:
      - [getCreateItineraryFields]{@link Plugin#getCreateItineraryFields}
   
   - If a key in the payload is said to be optional, it may be undefined or null, please handle them accordingly
   - expected return structure should be exactly as described in the documentation, it's ok to include extra fields in the response, but please note that our IA tool will only handle the fields that are described in the documentation
   ---

### Existing Itinerary Assist Plugin
[Tourplan](https://github.com/tourconnect/ti2-tourplan)
Feel free to use it as a reference for how tests are written and how it handles the authentication and data mapping.


### FAQ

1. For searchProductsForItinerary, it says "when we send empty payload, the expected response is the entire list of ACTIVE products". How do I handle pagination if my system has thousands of products? Is there a limit?

We have to get access to the entire list of products, so we can create a vector database for AI to match the extracted text with a service. We recommend using a cache to store the products on your end and refresh it periodically.

2. My booking system uses different terms for passenger types (e.g., "CHD" instead of "Child"). Should I handle this mapping in the plugin, or will Ti2 provide a mapping configuration?

You should handle this mapping in the plugin, as it's specific to your system.

3.  How should I handle currency conversion? My system supports multiple currencies, but I don't see currency fields in the response formats.

It's not required to include currency fields in the response, as the Itinerary Assist tool currently doesn't handle pricing related operations.

4. For real-time availability checks in searchAvailabilityForItinerary, what's the expected response time limit? My booking system might need to query multiple suppliers.

The availbility check is always just for one service. And we expect the response time to be less than 30 seconds.

5. Will Ti2 provide a validation suite to verify my plugin's responses match the expected format?

No, we currently rely on you to validate the response format, but we are working on a validation suite that will be available in the future.

6. The plugin.js file shows Jest tests, but are there specific test scenarios I need to cover?

No, we don't have a specific test scenarios, but we recommend you to cover the following:
- Authentication
- Response format for all operations


## Examples

### [searchProductsForItinerary]{@link Plugin#searchProductsForItinerary}

**We need the entire list of ACTIVE products so that we can create vector database for AI to match the extracted text with a service**


#### Example Payload
**Note: when we send empty payload, the expected response is the entire list of ACTIVE products**
```typescript
  {}
```

#### Example Response
**Note: We provided graphql types and queries for Itinerary Product, in hope for a easier way to map your data to our format. However, if you are not familiar with graphql, you don't have to use them, just make sure the response is in the correct format**
```typescript
{
  "products": [
    // Example of an Accommodation product
    {
      "productId": "1",
      "productName": "DoubleTree by Hilton Angel Kings Cross",
      "serviceTypes": [
        "Accommodation"
      ],
      "options": [
        {
          "extras": [],
          "lastUpdateTimestamp": 1586595549,
          "comment": "This is a comment",
          "optionId": "106784",
          "optionName": "Bed and English Breakfast-Executive Room",
          "restrictions": {
            "Adult": {
              "allowed": true,
              "maxAge": "999",
              "minAge": "16"
            },
            "Child": {
              "allowed": true,
              "maxAge": "15",
              "minAge": "2"
            },
            "Double": {
              "allowed": true,
              "maxAdults": "2",
              "maxPax": "2"
            },
            "Infant": {
              "allowed": true,
              "maxAge": "1",
              "minAge": "0"
            },
            "Quad": {
              "allowed": false
            },
            "Single": {
              "allowed": true,
              "maxAdults": "1",
              "maxPax": "1"
            },
            "Triple": {
              "allowed": false
            },
            "Twin": {
              "allowed": false
            },
            "roomTypeRequired": true
          },
          "serviceType": "Accommodation",
          "units": [
            {
              "restrictions": {
                "allowed": true,
                "paxCount": "1"
              },
              "unitId": "Single",
              "unitName": "Single"
            },
            {
              "restrictions": {
                "allowed": false
              },
              "unitId": "Twin",
              "unitName": "Twin"
            },
            {
              "restrictions": {
                "allowed": true,
                "paxCount": "2"
              },
              "unitId": "Double",
              "unitName": "Double"
            },
            {
              "restrictions": {
                "allowed": false
              },
              "unitId": "Quad",
              "unitName": "Quad"
            }
          ]
        }
      ]
    },
    // Example of a Transfers product
    {
      "productId": "6489",
      "productName": "Davids of London Ltd",
      "serviceTypes": [
        "Transfers"
      ],
      "options": [
        {
          "extras": [],
          "lastUpdateTimestamp": 1700750093,
          "comment": "This is a comment",
          "optionId": "LONTRDAVIDSHDWBVC",
          "optionName": "Half-Day Warner Bros Studios (6-Hours)-FIT- V- Class (1-5 Pax)",
          "restrictions": {
            "Adult": {
              "allowed": true,
              "maxAge": "999",
              "minAge": "16"
            },
            "Child": {
              "allowed": true,
              "maxAge": "15",
              "minAge": "5"
            },
            "Double": {
              "allowed": false
            },
            "Infant": {
              "allowed": true,
              "maxAge": "4",
              "minAge": "0"
            },
            "Quad": {
              "allowed": false
            },
            "Single": {
              "allowed": false
            },
            "Triple": {
              "allowed": false
            },
            "Twin": {
              "allowed": false
            },
            "roomTypeRequired": false
          },
          "serviceType": "Transfers",
          "units": [
            {
              "restrictions": {
                "maxAge": "999",
                "minAge": "16"
              },
              "unitId": "Adults",
              "unitName": "Adults"
            },
            {
              "restrictions": {
                "maxAge": "15",
                "minAge": "5"
              },
              "unitId": "Children",
              "unitName": "Children"
            },
            {
              "restrictions": {
                "maxAge": "4",
                "minAge": "0"
              },
              "unitId": "Infants",
              "unitName": "Infants"
            }
          ]
        }
      ]
    }
  ]
}
```


### [searchAvailabilityForItinerary]{@link Plugin#searchAvailabilityForItinerary}

#### Example Payload

```typescript
{
  optionId: 'LONTRDAVIDSHDWBVC',
  startDate: '2025-04-01',
  chargeUnitQuantity: 1,
  paxConfigs: [{ roomType: 'DB', adults: 2 }],
}
```
#### ExampleResponse

```typescript
{
  bookable: true,
  rates: [{
    rateId: '123',
    externalRateText: 'Example rate description'
  }]
}
```



### [addServiceToItinerary]{@link Plugin#addServiceToItinerary}

#### Example Payload
```javascript
{
  quoteName: String,
  rateId: String,           // Optional
  quoteId: String,          // Optional
  shellOnly: Boolean,       // Optional. If true, create/update quote header only and skip service insertion
  optionId: String,         // Required unless shellOnly is true
  startDate: String,        // YYYY-MM-DD, required unless shellOnly is true
  reference: String,        // Optional
  paxConfigs: [{
    roomType: String,       // Optional
    passengers: [{          // Optional
      firstName: String,
      lastName: String,
      passengerType: String,  // 'Adult' | 'Child' | 'Infant'
      age: Number,            // Optional
      dob: String,            // Optional, YYYY-MM-DD
      personId: String        // Optional
    }]
  }],                       // Required unless shellOnly is true
  extras: [{                // Optional
    selectedExtra: {
      id: String
    },
    quantity: Number
  }],
  puInfo: {                 // Optional, pickup information
    time: String,           // Optional
    location: String,       // Optional
    flightDetails: String   // Optional
  },
  doInfo: {                 // Optional, dropoff information
    time: String,           // Optional
    location: String,       // Optional
    flightDetails: String   // Optional
  },
  notes: String,            // Optional
  QB: 'Q',                  // Q for Quote, B for Booking
  customFieldValues: [{     // Optional
    id: String,
    value: String
  }]
}
```

#### Example Response

```typescript
{
  message: 'Booking created successfully',
  booking: {
    id: '123',
    reference: 'ref-123',
    linePrice: '100',
    lineId: 'lineId-123',
  }
}
```

### [searchItineraries]{@link Plugin#searchItineraries}


#### Example Payload

**Note: The payload must include either:**
- purchaseDateStart AND purchaseDateEnd, OR
- travelDateStart AND travelDateEnd, OR
- name, OR
- bookingId

```javascript

{
  purchaseDateStart: String,  // Optional, YYYY-MM-DD
  purchaseDateEnd: String,    // Optional, YYYY-MM-DD
  travelDateStart: String,    // Optional, YYYY-MM-DD
  travelDateEnd: String,      // Optional, YYYY-MM-DD
  name: String,              // Optional
  bookingId: String          // Optional
}
```


#### Example Response
**Note: We provided graphql types and queries for Itinerary Booking, in hope for a easier way to map your data to our format. However, if you are not familiar with graphql, you don't have to use them, just make sure the response is in the correct format**
```javascript
{
  "bookings": [{
      "agentRef": "2356674/1",
      "bookingId": "316559",
      "bookingStatus": "Quotation",
      "enteredDate": "2024-09-12",
      "ref": "ALFI393706",
      "serviceLines": [{
          "optionId": "LONHOSANLONBFBDLX",
          "optionName": "Bed and Full Buffet Breakfast",
          "paxConfigs": [{
              "adults": 1,
              "children": 0,
              "infants": 0,
              "passengers": [{
                  "age": null,
                  "dob": null,
                  "firstName": "Sean",
                  "lastName": "Conta",
                  "passengerType": "Adult",
                  "personId": "628199",
                },
              ],
              "roomType": "DB",
            },
          ],
          "paxList": [{
              "age": null,
              "dob": null,
              "firstName": "Sean",
              "lastName": "Conta",
              "passengerType": "Adult",
              "personId": "628199",
            },
          ],
          "serviceLineId": "745684",
          "startDate": "2025-08-13",
          "status": "OK"
        },
      ],
      "totalPrice": "187795",
      "currency": "USD",
      "travelDate": "2025-08-13",
    },
  ],
}
```

#### Example
```javascript
await searchItineraries({
  payload: {
    purchaseDateStart: '2024-01-01',
    purchaseDateEnd: '2024-12-31',
    name: 'John Doe'
  }
})
```
