# Ti2

Ti2 (Tourism Information Interchange) is an open source integration framework, built by and for the tourism community. Ti2's goal is to make integrations in our industry faster and easier to build, while providing a framework for innovation on top of these integrations.

Core functions of Ti2 are currently focused on content, rates, and bookings.

### Why use it ?

Ti2 gives a free, open source solution to building integrations across our industry. In addition, tools can be built on top of Ti2, that add additional value to these integrations - whether for the good of our industry or for profit.

**Become part of the community, start building on Ti2 today!**

## About this Project

### How it Works

Ti2 has a core codebase of standardized industry functions (new, update, cancel, etc.) for bookings, content, and rates - with more to come. Plugins are used to connect to the Ti2 to perform a task (like create a booking). There are two types of plugins: Integration and App.

Integration Plugins are used to connect core systems, like booking/reservation or content management systems, to Ti2. For example, you would use a Integration Plugin to connect Ventrata to Ti2. You would do this to be able to accept bookings from another system (like an OTA) connected to Ti2. *Ti2 allows any Integration Plugin to communicate with each other; therefore, once a Integration Plugin is live, no one ever needs to write a custom integration for that system again.*

App Plugins are value added tools that only speak to Ti2 and other plugins. For example, you might create an App Plugin that sends email notifications every morning with a list of all active bookings for the day. You would retrieve the list of bookings for the day by using a System Plugin.

Ti2 can be deployed on your own servers, or you can connect to a Ti2 instance that another company is hosting.

## Getting Started

You can write your [own plugin]{@tutorial plugin-development} that hooks up to a Ti2 instance or you can run a server that that hosts your [own **Ti2** instance]{@tutorial setup-your-instance} with any plugins (your own or from the plugin library).


## Plugins

Plugins are the connectores to other systems and/or features you intent to use; by default the server will start an API service on port 10010 and the swagger documentation on the path //api-docs, (you can disable wither by passing the startServer param as False or the apiDocs as False.

### Plugin Library

| Methods | FareHarbor | PeekPro| Zaui | Xola |[Ventrata](https://github.com/TourConnect/ti2-ventrata) | [TravelGateX](https://github.com/TourConnect/ti2-travelgate) | [Didgigo](https://github.com/TourConnect/ti2-didgigo) | [TourConnect](https://github.com/TourConnect/ti2-tourconnect) | TourPlan |
| ---- | -------- | ---------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
|**Base**|
|validateToken|&check;|&check;|&check;|&check;|&check;|&check;|&check;|&check;|&check;|
|tokenTemplate|&check;|&check;|&check;|&check;|&check;|&check;|&check;|&check;|&check;|
|**Content**|
|copyMedia||||||||&check;|
|getProfile|||||||&check;|&check;|
|updateProfile||||||||&check;|
|getLocations|||||||&check;|&check;|
|getLocation|||||||&check;|&check;|
|createLocation|||||||&check;|&check;|
|updateLocation|||||||&check;|&check;|
|getProducts|||||||&check;|&check;|
|getProduct|||||||&check;|&check;|
|createProduct|||||||&check;|&check;|
|updateProduct|||||||&check;|&check;|
|**Bookings**|
|searchProducts|&check;|&check;|&check;|&check;|&check;|&check;|
|searchBooking|&check;|&check;|&check;|&check;|&check;|&check;|
|searchAvailability|&check;|&check;|&check;|&check;|&check;|&check;|
|searchQuote|&check;|&check;|&check;|&check;|&check;|&check;|
|createBooking|&check;|&check;|&check;|&check;|&check;|&check;|
|confirmBooking|&check;|&check;|&check;|&check;|&check;|&check;|
|cancelBooking|&check;|&check;|&check;|&check;|&check;|&check;|
|searchProductsForItinerary|||||||||&check;|
|searchAvailabilityForItinerary|||||||||&check;|
|addServiceToItinerary|||||||||&check;|
|getCreateItineraryFields|||||||||&check;|
|searchItineraries|||||||||&check;|
|queryAllotment|||||||||&check;|

### Product catalog refresh contract

`POST /products/{appKey}/{userId}/{hint}/search` returns a canonical object with a
`products` array. Use `cacheOnly: true` to read Ti2's current catalog without
calling the integration; `cacheFound` distinguishes a cache miss from a cached
empty catalog.

A forced request is a full-catalog refresh by default. `fullSyncTrigger` may be
`scheduled`, `manual`, or `organic`; an omitted trigger on a forced request is
treated as manual. Manual refreshes require a non-blank `admissionOverrideReason`.
Scheduled and manual refreshes reject `searchInput`, `optionId`, `productId`,
`productName`, or `lastUpdatedFrom` selectors. An empty `searchInput` or
`searchInput: "*"` represents the full catalog. Scheduler-owned requests may
also carry `fullSyncStartedAt` and `fullSyncAdmissionToken`.

Unscoped forced responses include `catalogRefreshOutcome`, `cacheUpdated`,
`cachePreserved`, and `cachedProductCount`. Consumers that update a downstream
catalog should use these fields instead of assuming that HTTP 200 or the returned
`products.length` means Ti2 replaced its cache. Empty or partial plugin results
can preserve an existing catalog. If a concurrent refresh remains in progress
past the lock wait, Ti2 serves the retained catalog with
`catalogRefreshOutcome: "refresh_in_progress_cache_served"`. This outcome is
non-terminal: background-job `success` means the HTTP call completed, not that
the catalog was written.

The product cache refresh interval defaults to seven days when no TTR is set.
Any explicit `ttlForProducts` or plugin `cacheSettings.bookingsProductSearch.ttr`
value is honored, including `86400` for a one-day interval.

### Optional catalog lifecycle service

Ti2 can notify a catalog lifecycle service when an integration is removed or
reactivated. Set `PYFILEMATCH_URL` to the service base URL to enable these calls;
without it, Ti2 cleans its own credentials and schedules without making an
external catalog request. `PYFILEMATCH_TIMEOUT_MS` controls the request timeout
and defaults to 30 seconds. A save left in `provisioning` blocks deletion until
it is older than `INTEGRATION_PROVISIONING_TIMEOUT_MS` (five minutes by
default); deletion then advances the generation before removing local and
catalog state. Catalog lifecycle consumers must accept newer generations so a
failed activation followed by deletion can move from generation N to N+1.

## Contributing

Contributions are welcome and ecouraged.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement". Don't forget to give the project a star! Thanks again!

- Fork the Project
- Create your Feature Branch (git checkout -b feature/AmazingFeature)
- Commit your Changes (git commit -m 'Add some AmazingFeature')
- Push to the Branch (git push origin feature/AmazingFeature)
- Open a Pull Request

Feel free to check the [Issues Page](https://github.com/TourConnect/ti2/issues).

## License

Distributed under the GPL-3 License. See LICENSE file for more information.

TL;DR Here's what the license entails:

1. Anyone can copy, modify and distribute this software.
2. You have to include the license and copyright notice with each and every distribution.
3. You can use this software privately.
4. You can use this software for commercial purposes.
5. If you dare build your business solely from this code, you risk open-sourcing the whole code base.
6. If you modify it, you have to indicate changes made to the code.
7. Any modifications of this code base MUST be distributed with the same license, GPLv3.
8. This software is provided without warranty.
9. The software author or license can not be held liable for any damages inflicted by the software.
