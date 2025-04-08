// app/utils/memoryCachedConnection.ts
import {
    Connection,
    PublicKey,
} from '@solana/web3.js';

import {config} from '@/app/utils/config';

const CACHE_EXPIRY = 180 * 1000; // 3 minute

interface CachedData<T> {
    data: T;
    timestamp: number;
}

/**
 * Creates a cached proxy around a Connection instance
 */
export function createCachedConnection(
    endpoint: string = config.RPC_ENDPOINT,
    disableRetry: boolean = false
): Connection {
    // Cache storage
    const accountInfoCache = new Map<string, CachedData<any>>();
    const pendingRequests = new Map<string, Promise<any>>();

    // Create the base connection
    const connection = new Connection(endpoint, {
        disableRetryOnRateLimit: disableRetry
    });

    // Handle cached method execution
    const executeCachedMethod = async (
        method: string,
        key: string,
        originalMethod: Function,
        args: any[]
    ) => {
        const cacheKey = `${method}:${key}`;

        // Check cache
        const cached = accountInfoCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
            return cached.data;
        }

        // Check pending requests
        if (pendingRequests.has(cacheKey)) {
            return pendingRequests.get(cacheKey);
        }

        const requestPromise = (async () => {
            try {
                // Call the original method
                const result = await originalMethod.apply(connection, args);

                // Cache the result
                accountInfoCache.set(cacheKey, {
                    data: result,
                    timestamp: Date.now()
                });

                return result;
            } finally {
                // Clean up
                pendingRequests.delete(cacheKey);
            }
        })();

        // Store the pending request
        pendingRequests.set(cacheKey, requestPromise);

        return requestPromise;
    };

    // Create a proxy to intercept all method calls
    return new Proxy(connection, {
        get(target: Connection, prop: string | symbol, receiver: any) {
            // Handle property access
            if (typeof prop !== 'string') {
                return Reflect.get(target, prop, receiver);
            }

            // Only intercept methods, not properties
            const originalMethod = Reflect.get(target, prop, receiver);
            if (typeof originalMethod !== 'function') {
                return originalMethod;
            }

            // Add special handling for getAccountInfo
            if (prop === 'getAccountInfo' || prop === 'getAccountInfoAndContext' || prop === 'getParsedAccountInfo') {
                return async function(publicKey: PublicKey, ...args: any[]) {
                    return executeCachedMethod(
                        prop,
                        publicKey.toString(),
                        originalMethod,
                        [publicKey, ...args]
                    );
                };
            }

            // Add special handling for getProgramAccounts
            if (prop === 'getProgramAccounts') {
                return async function(programId: PublicKey, configOrCommitment?: any) {
                    // Check if this is a withContext call which changes return type
                    const withContext = configOrCommitment &&
                        typeof configOrCommitment === 'object' &&
                        'withContext' in configOrCommitment &&
                        configOrCommitment.withContext === true;

                    // Don't cache withContext calls due to different return type
                    if (withContext) {
                        return originalMethod.apply(target, [programId, configOrCommitment]);
                    }

                    return executeCachedMethod(
                        prop,
                        `${programId.toString()}${JSON.stringify(configOrCommitment)}`,
                        originalMethod,
                        [programId, configOrCommitment]
                    );
                };
            }

            // Add special handling for getMultipleAccountsInfo
            if (prop === 'getMultipleAccountsInfo') {
                return async function(publicKeys: PublicKey[], ...args: any[]) {
                    if (publicKeys.length === 0) {
                        return [];
                    }

                    const keysStr = publicKeys.map(key => key.toString()).sort().join(',');

                    return executeCachedMethod(
                        prop,
                        keysStr,
                        originalMethod,
                        [publicKeys, ...args]
                    );
                };
            }

            // Return the original method for everything else
            return originalMethod;
        }
    });
}

// Singleton instances
let defaultConnectionInstance: Connection | null = null;
let noRetryConnectionInstance: Connection | null = null;

export function getDefaultConnection(): Connection {
    if (!defaultConnectionInstance) {
        defaultConnectionInstance = createCachedConnection(config.RPC_ENDPOINT, false);
    }
    return defaultConnectionInstance;
}

export function getNoRetryConnection(): Connection {
    if (!noRetryConnectionInstance) {
        noRetryConnectionInstance = createCachedConnection(config.RPC_ENDPOINT, true);
    }
    return noRetryConnectionInstance;
}
