// app/utils/cachingUtils.ts
type AsyncFunction<T, Args extends any[]> = (...args: Args) => Promise<T>;

/**
 * Configuration options for the cache wrapper
 */
interface CacheOptions {
    // Return a cache key based on function arguments
    getCacheKey: (...args: any[]) => string;

    // Optional: Check localStorage for cached data (returns null if not found)
    getFromLocalStorage?: (cacheKey: string) => any | null;

    // Optional: Save result to localStorage
    saveToLocalStorage?: (cacheKey: string, value: any) => void;

    // Optional: Custom string key for the pending requests map
    getPendingKey?: (...args: any[]) => string;
}

/**
 * Creates a wrapper around async functions that adds request deduplication
 * and optional localStorage caching
 */
export function createCachedRequestWrapper<T, Args extends any[]>(
    fn: AsyncFunction<T, Args>,
    options: CacheOptions
): AsyncFunction<T, Args> {
    // Map to store pending requests
    const pendingRequests = new Map<string, Promise<T>>();

    return async function(...args: Args): Promise<T> {
        const cacheKey = options.getCacheKey(...args);
        const pendingKey = options.getPendingKey ? options.getPendingKey(...args) : cacheKey;

        // Try to get from localStorage if handler provided
        if (options.getFromLocalStorage) {
            try {
                const cachedValue = options.getFromLocalStorage(cacheKey);
                if (cachedValue !== null) {
                    return cachedValue;
                }
            } catch (err) {
                console.warn(`Error accessing cache for ${cacheKey}:`, err);
            }
        }

        // Check if there's already a pending request
        if (pendingRequests.has(pendingKey)) {
            return pendingRequests.get(pendingKey)!;
        }

        // Create and store the fetch promise
        const fetchPromise = (async () => {
            try {
                // Call the original function
                const result = await fn(...args);

                // Save to localStorage if handler provided
                if (options.saveToLocalStorage && result !== null && result !== undefined) {
                    try {
                        options.saveToLocalStorage(cacheKey, result);
                    } catch (err) {
                        console.warn(`Failed to save to cache for ${cacheKey}:`, err);
                    }
                }

                return result;
            } finally {
                // Clean up the pending request
                pendingRequests.delete(pendingKey);
            }
        })();

        pendingRequests.set(pendingKey, fetchPromise);
        return fetchPromise;
    };
}