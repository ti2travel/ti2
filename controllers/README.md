# Bookings Controller Caching and Locking Strategy

The `$bookingsProductSearch` function in `controllers/bookings.js` implements a sophisticated caching and locking strategy to optimize product searches, manage stale data, and prevent redundant operations. This document outlines its core flow and the locking mechanisms involved.

## Core Flow of `$bookingsProductSearch`

1.  **Initialization**:
    *   Retrieves user, application (`appKey`), and token details (including `hint`).
    *   Determines the specific plugin function to call for product search (e.g., `searchProducts` or `searchProductsForItinerary`).
    *   Calculates a `cacheKey` based on `userId`, `hint`, and a static `operationId` ('bookingsProductSearch').
    *   Defines two distinct lock keys derived from this `cacheKey`:
        *   `pluginExecutionLockKey` (resolves to `${cacheKey}:lock`): Used to serialize direct calls to the plugin.
        *   `jobQueueLockKey` (resolves to `${cacheKey}:jobLock`): Used to prevent multiple submissions of background refresh jobs.
    *   Fetches the current cache content (`initialActualCacheContent`) and its `lastUpdated` timestamp.
    *   Determines if the cache is stale (`isStaleByTTR`) based on the Time-To-Refresh (`ttr`) value from the token or plugin settings.
    *   Checks for a `doNotCallPluginForProducts` flag (from token or plugin settings) and whether a `pluginExecutionLockKey` is currently active.

2.  **Request Handling Logic (Simplified Order):**

    *   **Condition 1: `doNotCallPluginForProducts` is true AND NOT `forceRefresh`**:
        *   If this flag is set and the request is not a forced refresh, the system serves data directly from the cache if available.
        *   If the cache is empty, it returns an empty product list.
        *   No plugin calls are made, and no background jobs are queued in this path.

    *   **Condition 2: `forceRefresh` is true**:
        *   The system attempts to fetch fresh data directly from the plugin.
        *   The `fetchFromPluginAndCache` helper function is invoked. This function:
            *   Sets the `pluginExecutionLockKey` before calling the plugin to prevent other concurrent direct calls.
            *   Calls the plugin's product search method.
            *   If the plugin returns valid products, these are saved to the cache (both `cacheKey` for data and `${cacheKey}:lastUpdated` for timestamp).
            *   Drops the `pluginExecutionLockKey` after completion.
        *   The (potentially filtered) results from the plugin are returned to the client.

    *   **Condition 3: Cache Exists AND NOT `forceRefresh`**:
        *   **Sub-condition 3a: Cache is fresh OR `pluginExecutionLockKey` is active**:
            *   If the cache is not stale according to its TTR, or if a direct plugin execution (like a `forceRefresh` or initial population) is already in progress (indicated by an active `pluginExecutionLockKey`), the system serves data from the existing cache.
        *   **Sub-condition 3b: Cache is stale AND no `pluginExecutionLockKey` is active**:
            *   The system checks for an active `jobQueueLockKey`.
            *   If `jobQueueLockKey` IS active: It implies that another request very recently detected the stale cache and has already queued a background refresh job. The current request serves the stale data from the cache without queueing another job.
            *   If `jobQueueLockKey` is NOT active: This request is the first (or among the first) to find the stale cache without an ongoing direct refresh or a recently queued job. It will:
                1.  Set the `jobQueueLockKey` with a short TTL (e.g., 60 seconds).
                2.  Queue a background job using `addJob`. This job will eventually call the plugin to refresh the data and then use `$updateProductSearchCache` to update the cache.
                3.  Serve the stale data from the cache to the current client.

    *   **Condition 4: No Cache Content AND NOT `forceRefresh` AND NOT `doNotCallPluginForProducts`**:
        *   If there's no existing cache content and none of the preceding conditions (like `forceRefresh` or `doNotCallPluginForProducts`) were met, the system needs to populate the cache.
        *   It calls `fetchFromPluginAndCache` (which sets `pluginExecutionLockKey`, calls the plugin, caches results, and drops the lock) to get initial data.
        *   The (potentially filtered) results are returned to the client.

## Locking Mechanisms Explained

The system uses two types of locks, both based on the primary `cacheKey`, to manage concurrency and prevent redundant operations:

1.  **`pluginExecutionLockKey` (derived from `${cacheKey}:lock`)**:
    *   **Purpose**: To prevent multiple simultaneous *direct calls* to the external plugin for the same product search parameters. This is crucial during `forceRefresh` scenarios or when the cache is being populated for the first time by concurrent requests.
    *   **Behavior**:
        *   This lock is set by the `fetchFromPluginAndCache` helper function immediately before it makes an actual call to the plugin's `searchProducts` (or equivalent) method.
        *   It is configured with a TTL (e.g., 120 seconds) to ensure it automatically expires if the process holding the lock crashes or fails to release it.
        *   The lock is explicitly dropped by `fetchFromPluginAndCache` after the plugin call completes (whether successfully or with an error).
        *   Other parts of the main logic (e.g., in Condition 3a) check for the presence of this lock (`hasPluginExecutionLock`). If active, it signals that a direct plugin data fetch is already in progress, prompting the current request to, for example, serve stale data or wait, rather than initiating another direct plugin call.

2.  **`jobQueueLockKey` (derived from `${cacheKey}:jobLock`)**:
    *   **Purpose**: To prevent the submission of multiple identical *background refresh jobs* by nearly simultaneous requests when the cache is found to be stale and no direct plugin execution (covered by `pluginExecutionLockKey`) is active.
    *   **Behavior**:
        *   This lock is checked specifically when the cache is determined to be effectively stale (`isEffectivelyStale`) and no `pluginExecutionLockKey` is currently active (Condition 3b).
        *   If the `jobQueueLockKey` is NOT found in the cache, the current request assumes responsibility for queuing the refresh job. It sets this lock with a short TTL (e.g., 60 seconds) *before* calling `addJob`.
        *   If the `jobQueueLockKey` IS found, it indicates that another request has very recently detected the stale state and has already taken action to queue the refresh job. The current request will then proceed to serve stale data without attempting to queue another job.
        *   This mechanism ensures that even if numerous requests detect stale data at virtually the same moment, only one of them will succeed in setting the `jobQueueLockKey` and thereby be responsible for queueing the single background refresh task.

These two locks work in tandem: `pluginExecutionLockKey` manages contention for direct, immediate plugin interactions, while `jobQueueLockKey` manages contention for initiating background refresh tasks when stale data is being served. This dual-lock strategy helps maintain system performance and avoids overwhelming external plugin services or the background job queue.
