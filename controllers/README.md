# Bookings Controller Caching and Locking Strategy

The `$bookingsProductSearch` function in `controllers/bookings.js` implements a caching and locking strategy to optimize product searches, manage stale data, and prevent redundant plugin calls. This document outlines its core flow.

## Core Flow of `$bookingsProductSearch`

1.  **Initialization**:
    *   Retrieves user, application (`appKey`), and token details (including `hint`).
    *   Determines the specific plugin function to call for product search (e.g., `searchProducts` or `searchProductsForItinerary`).
    *   Injects the integration's configured `productSearchOmitServiceCodes` into the plugin payload so every caller for that token omits the same service codes. When the setting is empty, the request body is unchanged.
    *   Calculates a `cacheKey` based on `userId`, `hint`, and a static `operationId` (`bookingsProductSearch`). Changing the omit setting does not change the key; clear that integration's product-search cache and resync.
    *   Defines a lock key derived from this `cacheKey`:
        *   `pluginExecutionLockKey` (resolves to `${cacheKey}:lock`): Used to serialize direct calls to the plugin.
        *   `${pluginExecutionLockKey}:outcome`: Short-lived refresh metadata used by concurrent waiters.
    *   Fetches the current cache content (`initialActualCacheContent`) and its `lastUpdated` timestamp.
    *   Determines if the cache is stale (`isStaleByTTR`) based on the Time-To-Refresh (`ttr`) value from the token or plugin settings.
    *   Checks for a `doNotCallPluginForProducts` flag (from token or plugin settings) and whether a `pluginExecutionLockKey` is currently active.

2.  **Request Handling Logic (Simplified Order):**

    *   **Condition 1: `cacheOnly` is true**:
        *   Returns the current cache without calling the plugin. `cacheFound` distinguishes a cache miss from an intentionally cached empty catalog.

    *   **Condition 2: `doNotCallPluginForProducts` is true AND NOT `forceRefresh`**:
        *   If this flag is set and the request is not a forced refresh, the system serves data directly from the cache if available.
        *   If the cache is empty, it returns an empty product list.
        *   No plugin calls are made in this path.

    *   **Condition 3: `forceRefresh` is true**:
        *   This is the catalog refresh owner. The system fetches fresh data from the plugin.
        *   Ti2 rejects the request unless the host declared `weeklyProductCatalogSync: true` for the plugin. Manual audit reasons may override timing admission, but not catalog-completeness eligibility.
        *   Unless `fullSyncTrigger: organic` is explicit, a force refresh is a scheduled or manual full-catalog request and rejects `searchInput`, `optionId`, `productId`, `productName`, and `lastUpdatedFrom` selectors. `searchInput: "*"` is unscoped.
        *   The `fetchFromPluginAndCache` helper function is invoked. This function:
            *   Sets the `pluginExecutionLockKey` before calling the plugin to prevent other concurrent direct calls.
            *   Calls the plugin's product search method.
            *   If the plugin returns valid products, these are saved to the cache (both `cacheKey` for data and `${cacheKey}:lastUpdated` for timestamp).
            *   If the plugin returns empty or partial products and a non-empty cache already exists, the existing cache is kept and returned.
            *   Concurrent waiters return the same effective catalog and refresh outcome. If the wait expires while the leader is still active, the waiter returns the retained cache with `refresh_in_progress_cache_served`.
            *   Drops the `pluginExecutionLockKey` after completion.
        *   The response includes `catalogRefreshOutcome`, `cacheUpdated`, `cachePreserved`, and `cachedProductCount`. `catalogRefreshOutcome` is authoritative; background-job `success` only means the HTTP request completed and does not prove a terminal catalog write.

    *   **Condition 4: Cache Exists AND NOT `forceRefresh`**:
        *   Organic search never starts a catalog refresh.
        *   If the cache is fresh, or a plugin fetch is already running, serve the cache.
        *   If the cache is stale, serve it while the scheduler separately owns the next `forceRefresh` catalog sync.

    *   **Condition 5: No Cache Content AND NOT `forceRefresh` AND NOT `doNotCallPluginForProducts`**:
        *   Cache miss still fetches from the plugin so search can return products.
        *   It calls `fetchFromPluginAndCache` (which sets `pluginExecutionLockKey`, calls the plugin, caches results, and drops the lock) to get initial data.
        *   The (potentially filtered) results are returned to the client.

## Locking Mechanisms Explained

1.  **`pluginExecutionLockKey` (derived from `${cacheKey}:lock`)**:
    *   **Purpose**: To prevent multiple simultaneous *direct calls* to the external plugin for the same product search parameters. This is used during `forceRefresh` and first-time cache population.
    *   **Behavior**:
        *   This lock is set by the `fetchFromPluginAndCache` helper function immediately before it makes an actual call to the plugin's `searchProducts` (or equivalent) method.
        *   It is configured with a TTL (e.g., 120 seconds) to ensure it automatically expires if the process holding the lock crashes or fails to release it.
        *   The lock is explicitly dropped by `fetchFromPluginAndCache` after the plugin call completes (whether successfully or with an error).
        *   Other parts of the main logic (e.g., in Condition 3) check for the presence of this lock (`hasPluginExecutionLock`). If active, it signals that a direct plugin data fetch is already in progress, prompting the current request to serve cache rather than initiating another direct plugin call.
