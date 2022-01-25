module.exports = {
  leftSide: {
    name: 'TourConnect',
    entityImage:
      'https://s3.amazonaws.com/tourconnect_staging/images/images/536830b6ed19afa44a000002/profile?1501741129917',
  },
  rightSide: {
    name: 'Didgigo',
  },
  fieldSets: {
    profile: {
      caption: 'Company Details',
      mappingType: 'fields',
      leftSide: {
        entityType: 'Profile',
        entityName: 'Luxury Island Suites',
        entity: 'Profile',
        fields: [
          {
            id: 'name',
            title: 'Company Name',
            content: 'Luxury Island Suites',
          },
          {
            id: 'address',
            title: 'Address',
            content: {
              country: 'Australia',
              state: 'QLD',
              city: 'Arlie Beach',
              postalCode: '4802',
              address1: '30 Golden Orchad Drive',
              address2: null,
              gps: {
                lat: '1.3644202',
                lng: '103.9915308',
              },
            },
          },
          {
            id: 'description',
            title: 'Description',
            content:
              'Luxury Island Suites stands as the stylish, forward thinking leader of island hospitality. With over 60 years of experience, LIS continues to be synonymous with luxury because of our innovative approach to products, amenities and service. We help make traveling easier with our smart design, innovative restaurant concepts, authentic hospitality and commitment to the global community.',
          },
          {
            id: 'website',
            title: 'Website',
            content: 'www.luxuryislandsuites.com.au',
          },
          {
            id: 'telephone',
            title: 'Telephone Number',
            content: '1800 700 600',
          },
        ],
      },
      rightSide: {
        entityType: 'Public Profile',
        entityName: 'Luxury Suites of Australia',
        fields: [
          {
            id: 'name',
            title: 'Company Name',
            content: 'Luxury Suites of Australia',
          },
          {
            id: 'address',
            title: 'Address',
            content: '',
          },
          {
            id: 'description',
            title: 'Welcome Paragraph',
            content:
              'Actually try-hard vape marfa wayfarers. Woke live-edge dreamcatcher copper mug selvage kinfolk pork belly normcore tumeric ennui crucifix squid four loko. Pitchfork ugh cray, blog succulents blue bottle small batch fixie scenester sustainable. Cred fingerstache art party pop-up coloring book ugh. Woke raclette kombucha narwhal kickstarter, meh ugh roof party banjo meggings copper mug. Ugh air plant tattooed pitchfork cold-pressed, hashtag mumblecore gentrify tumeric succulents knausgaard lumbersexual. Hexagon shaman mixtape cornhole plaid cliche whatever celiac kickstarter distillery microdosing.',
          },
        ],
      },
      mappings: [],
    },
    locations: {
      caption: 'Properties / Locations',
      mappingType: 'locations',
      leftSide: {
        entity: 'Locations',
        entityName: 'Location',
        entityType: 'Locations',
        locations: [
          {
            locationId: '5368655d97417de435000001',
            locationName: 'Arlie Beach Luxury Island Suites',
            description:
              "Luxury Island Suites in Airlie Beach offers a pampering vacation experience that is truly unique among Airlie Beach hotels. Situated on a cliff rising above the sea, all of Island's suites enjoy full panoramic views.",
            media: {
              images: [
                {
                  url:
                    'https://s3.amazonaws.com/tourconnect_staging/7624471190451/d6fd2cc1-dc54-11e8-b9ed-eb2f0d66c310',
                },
                {
                  url:
                    'https://s3.amazonaws.com/tourconnect_staging/5035112190451/b428be21-dc55-11e8-b85e-59746f3f59b6',
                },
              ],
            },
            location: {
              country: 'Australia',
              state: 'QLD',
              city: 'Arlie Beach',
              postalCode: '4802',
              address1: '30 Golden Orchad Drive',
              address2: null,
              gps: {
                lat: '1.3644202',
                lng: '103.9915308',
              },
            },
          },
          {
            locationId: '5f2d3bdea7ea49524000001',
            locationName: 'Isla Mujeres Island Suites',
            description:
              'Relax into island time in the comfort and easy elegance of Orcas Island’s premier specialty lodging. Water view suites are located in the heart of Eastsound Village, just steps away from shops & galleries, world-renowned dining, beach strolling, outdoor adventures and more. Eastsound Suites are a popular alternative accommodation to hotels, motels or B&B’s. Much more special!',
            media: {
              images: [
                {
                  url:
                    'https://s3.amazonaws.com/tourconnect_staging/5035112190451/b428be21-dc55-11e8-b85e-59746f3f59b6',
                },
              ],
            },
            location: {
              country: 'Mexico',
              state: 'Quintana Roo',
              city: 'Isla Mujeres',
              postalCode: '00',
              address1: 'tbc',
            },
          },
        ],
      },
      rightSide: {
        entity: 'Products',
        entityName: 'Product',
        entityType: 'Product',
        locations: [
          {
            locationId: '332233',
            locationName: 'Hilton',
            description:
              'Hampton Inn by Hilton Cancun Cumbres is a modern business hotel that is located in a recently developed area of Cancun. The hotel is just steps away from various shops, supermarkets and malls, and also offers easy access to the highway which takes you to the downtown area and airport.',
            media: {
              images: [
                {
                  url:
                    'https://cdn.bestday.net/_lib/vimages/Cancun/Hotels/hotel-hampton-inn-hilton-cancun-cumbres/fachada_g.jpg',
                },
              ],
            },
            location: {
              country: 'Mexico',
              state: 'Quintana Roo',
              city: 'Cancun',
              postalcode: '7500',
              address1: 'SM 310 MZ 01 L-4-02',
              address2: 'Blvd. Luis Donaldo Colosio',
            },
          },
          {
            locationId: '332234',
            locationName: 'Hilton Lagoon',
            description:
              'Simple rooms in an unpretentious hotel featuring lagoon views, a restaurant/bar & an outdoor pool.',
            media: {
              images: [
                {
                  url:
                    'http://www.iceportal.com/data/2813-55900-f7541089_XXLejpg/Mexico/Cancun/Hotel/Grand-Royal-Lagoon/Photo/Grand-Royal-Lagoon-Cancun-Exterior-view-Exterior.jpg',
                },
              ],
            },
            location: {
              country: 'Mexico',
              state: 'Quintana Roo',
              city: 'Cancun',
              postalCode: '77500',
              address1: 'Blvd. Kukulcan Km 7.5, Punta Cancun, Zona Hotelera',
            },
          },
        ],
      },
      mappings: [],
    },
    products: {
      caption: 'Products',
      mappingType: 'products',
      leftSide: {
        entity: 'Products',
        entityName: 'Location/Product',
        entityType: 'Products',
        products: [
          {
            locationId: '5368655d97417de435000001',
            locationName: 'Arlie Beach Luxury Island Suites',
            productId: '536868d097417d07e0000003',
            productName: 'King Suite',
            description:
              'There’s plenty of room for work and play in our Executive King Suite with its comfortable, modern design. Its elegant, modern design features a media hub for all your gadgets, plenty of space to get work done, and plush furnishings to ensure your comfort all the while.',
            media: {
              images: [
                {
                  url:
                    'https://static.mgmresorts.com/content/dam/MGM/mgm-grand/hotel/mgm-grand/graphic-elements/mgm-grand-hotel-rooms-details-bedroom-bed-close-up-@2x.jpg.image.744.418.high.jpg',
                },
                {
                  url:
                    'https://static.mgmresorts.com/content/dam/MGM/mgm-grand/hotel/mgm-grand/executive-king-suite/architecture/mgm_grand_room_executive_king_suite.png.image.1488.836.high.jpg',
                },
              ],
            },
          },
          {
            locationId: '5368655d97417de435000001',
            locationName: 'Arlie Beach Luxury Island Suites',
            productId: '5368698c97417de435000013',
            productName: 'Master King Suite',
            description:
              "Knausgaard hell of bitters 90's pickled tote bag narwhal farm-to-table paleo lyft taxidermy man braid meditation vinyl glossier. Live-edge tousled disrupt, pug meh keffiyeh venmo tofu organic occupy swag chicharrones ethical humblebrag. Dreamcatcher keytar biodiesel, banjo cronut vaporware marfa heirloom. Meh coloring book chartreuse, synth taiyaki etsy kinfolk succulents raclette lomo humblebrag lo-fi taxidermy edison bulb slow-carb. Neutra occupy thundercats sustainable fingerstache hot chicken next level forage. Godard coloring book iceland photo booth waistcoat next level 3 wolf moon, vice mumblecore wolf poutine paleo four dollar toast seitan authentic.",
            media: {
              images: [
                {
                  url:
                    'https://photos.hotelbeds.com/giata/bigger/45/457081/457081a_hb_ro_002.jpg',
                },
                {
                  url:
                    'https://photos.hotelbeds.com/giata/bigger/45/457081/457081a_hb_ro_016.jpg',
                },
              ],
            },
          },
          {
            locationId: '5368655d97417de435000001',
            locationName: 'Arlie Beach Luxury Island Suites',
            productId: '55b189b682c2b00300c9dd41',
            productName: '1 Bedroom Apartment/Suite',
          },
          {
            locationId: '5368655d97417de435000001',
            locationName: 'Arlie Beach Luxury Island Suites',
            productId: '536867a697417de43500000f',
            productName: 'King Deluxe Guest Room',
          },
          {
            locationId: '5f2d3bdea7ea49524000001',
            locationName: 'Isla Mujeres Island Suites',
            productId: ':5407d059707f0fe2900001f1',
            productName: 'Deluxe Island Suite',
          },
          {
            locationId: '5f2d3bdea7ea49524000001',
            locationName: 'Isla Mujeres Island Suites',
            productId: '5407cc9d707f0fe2900000cc',
            productName: 'Island Suite',
          },
          {
            locationId: '5f2d3bdea7ea49524000001',
            locationName: 'Isla Mujeres Island Suites',
            productId: '55b5b51a8f58920300a115cc',
            productName: 'Garden Sunset Suite',
          },
        ],
      },
      rightSide: {
        entity: 'Options',
        entityType: 'Options',
        entityName: 'Products/Options',
        products: [
          {
            locationId: '332233',
            locationName: 'Hilton Beach',
            productId: '009992',
            productName: 'Queen Suite',
          },
          {
            locationId: '332234',
            locationName: 'Hilton Lagoon',
            productId: '009993',
            productName: 'King Suite',
          },
        ],
      },
      mappings: [
        {
          leftSide: {
            locationId: '5368655d97417de435000001',
            productId: '536868d097417d07e0000003',
          },
          action: 'left',
        },
        {
          rightSide: {
            locationId: '332233',
            productId: '009992',
          },
          action: 'right',
        },
        {
          leftSide: {
            locationId: '5368655d97417de435000001',
            productId: '5368698c97417de435000013',
          },
          rightSide: {
            locationId: '332234',
            productId: '009993',
          },
          action: 'left',
        },
        {
          leftSide: {
            locationId: '5368655d97417de435000001',
            productId: '55b189b682c2b00300c9dd41',
          },
          action: 'ignore',
        },
      ],
    },
  },
};
