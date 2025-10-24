import {PublicKey} from "@solana/web3.js";
import {TokenInfo} from "@/app/types";
import {delay} from "@/app/utils/rateLimitedFetch";
import {config} from "@/app/utils/config";
import {createCachedRequestWrapper} from "@/app/utils/cachingUtils";

const TOKEN_PRICE_CACHE_PREFIX = 'token_price_';
const TOKEN_USD_PRICE_CACHE_PREFIX = 'token_usd_price_';
const TOKEN_ASSETS_CACHE_PREFIX = 'token_assets_';
const PRICE_CACHE_EXPIRY_MS = 60000; // 60 seconds
const ASSETS_CACHE_EXPIRY_MS = 300000; // 5 minutes

interface CachedPrice {
    data: TokenInfo;
    timestamp: number;
}

interface CachedUsdPrice {
    data: number;
    timestamp: number;
}

interface TokenAsset {
    id: string;
    name: string;
    symbol: string;
    icon: string;
    decimals: number;
    twitter?: string;
    website?: string;
    dev: string;
    circSupply: number;
    totalSupply: number;
    tokenProgram: string;
    launchpad?: string;
    firstPool: {
        id: string;
        createdAt: string;
    };
    graduatedPool?: string;
    graduatedAt?: string;
    holderCount: number;
    audit: {
        mintAuthorityDisabled?: boolean;
        freezeAuthorityDisabled: boolean;
        topHoldersPercentage: number;
        devMigrations?: number;
        highSingleOwnership: boolean;
    };
    organicScore: number;
    organicScoreLabel: string;
    isVerified: boolean;
    tags: string[];
    fdv: number;
    mcap: number;
    usdPrice: number;
    priceBlockId: number;
    liquidity: number;
    stats5m?: {
        priceChange: number;
        holderChange: number;
        liquidityChange: number;
        volumeChange: number;
        buyVolume: number;
        sellVolume: number;
        buyOrganicVolume: number;
        sellOrganicVolume: number;
        numBuys: number;
        numSells: number;
        numTraders: number;
        numOrganicBuyers: number;
        numNetBuyers: number;
    };
    stats1h: {
        priceChange: number;
        holderChange: number;
        liquidityChange: number;
        volumeChange: number;
        buyVolume: number;
        sellVolume: number;
        buyOrganicVolume: number;
        sellOrganicVolume: number;
        numBuys: number;
        numSells: number;
        numTraders: number;
        numOrganicBuyers: number;
        numNetBuyers: number;
    };
    stats6h: {
        priceChange: number;
        holderChange: number;
        liquidityChange: number;
        volumeChange: number;
        buyVolume: number;
        sellVolume: number;
        buyOrganicVolume: number;
        sellOrganicVolume: number;
        numBuys: number;
        numSells: number;
        numTraders: number;
        numOrganicBuyers: number;
        numNetBuyers: number;
    };
    stats24h: {
        priceChange: number;
        holderChange: number;
        liquidityChange: number;
        volumeChange: number;
        buyVolume: number;
        sellVolume: number;
        buyOrganicVolume: number;
        sellOrganicVolume: number;
        numBuys: number;
        numSells: number;
        numTraders: number;
        numOrganicBuyers: number;
        numNetBuyers: number;
    };
    ctLikes?: number;
    smartCtLikes?: number;
    updatedAt: string;
}

interface CachedTokenAssets {
    data: TokenAsset[];
    timestamp: number;
}

async function _fetchTokenPrice(
    tokenX: PublicKey,
    tokenY: PublicKey,
    maxRetries = config.MAX_RETRIES,
    initialDelay = config.INITIAL_RETRY_DELAY
): Promise<TokenInfo> {
    const url = `https://lite-api.jup.ag/price/v3?ids=${tokenX},${tokenY}`;

    for (let retries = 0; retries < maxRetries; retries++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status}`);
                continue;
            }

            const text = await response.text();
            let data = JSON.parse(text);

            if (!data || !data[tokenX.toString()]) {
                console.error('Unexpected response format:', data);
                continue;
            }

            const tokenXData = data[tokenX.toString()];
            const tokenYData = data[tokenY.toString()];

            return {
                price: tokenXData.usdPrice / tokenYData.usdPrice,
            };
        } catch (error: unknown) {
            const delayTime = initialDelay * Math.pow(2, retries);
            console.error(`Fetch token price failed. Retry attempt ${retries + 1} after ${delayTime}ms delay. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await delay(delayTime);
        }
    }

    console.error(`Max retries (${maxRetries}) reached. Returning default values.`);
    return { price: -1 };
}

async function _fetchTokenUsdPrice(
    token: PublicKey,
    maxRetries = config.MAX_RETRIES,
    initialDelay = config.INITIAL_RETRY_DELAY
): Promise<number> {
    const url = `https://lite-api.jup.ag/price/v3?ids=${token}`;

    for (let retries = 0; retries < maxRetries; retries++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status}`);
                continue;
            }

            const text = await response.text();
            let data = JSON.parse(text);

            if (!data || !data[token.toString()]) {
                console.error('Unexpected response format:', data);
                continue;
            }

            const tokenData = data[token.toString()];
            return tokenData.usdPrice;
        } catch (error: unknown) {
            const delayTime = initialDelay * Math.pow(2, retries);
            console.error(`Fetch token USD price failed. Retry attempt ${retries + 1} after ${delayTime}ms delay. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await delay(delayTime);
        }
    }

    console.error(`Max retries (${maxRetries}) reached. Returning -1.`);
    return -1;
}

async function _fetchTokenAssets(
    tokenAddresses: PublicKey[],
    maxRetries = config.MAX_RETRIES,
    initialDelay = config.INITIAL_RETRY_DELAY
): Promise<TokenAsset[]> {
    // Convert PublicKeys to comma-separated string
    const query = tokenAddresses.map(addr => addr.toString()).join(',');
    const url = `https://datapi.jup.ag/v1/assets/search?query=${query}`;

    for (let retries = 0; retries < maxRetries; retries++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status}`);
                continue;
            }

            const data = await response.json();

            // API returns array of token assets
            if (!Array.isArray(data)) {
                console.error('Unexpected response format:', data);
                continue;
            }

            return data as TokenAsset[];
        } catch (error: unknown) {
            const delayTime = initialDelay * Math.pow(2, retries);
            console.error(`Fetch token assets failed. Retry attempt ${retries + 1} after ${delayTime}ms delay. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await delay(delayTime);
        }
    }

    console.error(`Max retries (${maxRetries}) reached. Returning empty array.`);
    return [];
}

export const fetchTokenPrice = createCachedRequestWrapper(_fetchTokenPrice, {
    getCacheKey: (tokenX, tokenY) =>
        `${TOKEN_PRICE_CACHE_PREFIX}${tokenX.toString()}_${tokenY.toString()}`,

    getFromLocalStorage: (cacheKey) => {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            const parsedData = JSON.parse(cachedData) as CachedPrice;
            if (Date.now() - parsedData.timestamp < PRICE_CACHE_EXPIRY_MS) {
                return parsedData.data;
            }
        }
        return null;
    },

    saveToLocalStorage: (cacheKey, result) => {
        localStorage.setItem(cacheKey, JSON.stringify({
            data: result,
            timestamp: Date.now()
        }));
    },

    getPendingKey: (tokenX, tokenY) => `${tokenX.toString()}_${tokenY.toString()}`
});

export const fetchTokenUsdPrice = createCachedRequestWrapper(_fetchTokenUsdPrice, {
    getCacheKey: (token) =>
        `${TOKEN_USD_PRICE_CACHE_PREFIX}${token.toString()}`,

    getFromLocalStorage: (cacheKey) => {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            const parsedData = JSON.parse(cachedData) as CachedUsdPrice;
            if (Date.now() - parsedData.timestamp < PRICE_CACHE_EXPIRY_MS) {
                return parsedData.data;
            }
        }
        return null;
    },

    saveToLocalStorage: (cacheKey, result) => {
        localStorage.setItem(cacheKey, JSON.stringify({
            data: result,
            timestamp: Date.now()
        }));
    },

    getPendingKey: (token) => token.toString()
});

export const fetchTokenAssets = createCachedRequestWrapper(_fetchTokenAssets, {
    getCacheKey: (tokenAddresses: PublicKey[]) => {
        // Create cache key from sorted addresses to ensure consistency
        const sortedAddresses = tokenAddresses
            .map((addr: PublicKey) => addr.toString())
            .sort()
            .join('_');
        return `${TOKEN_ASSETS_CACHE_PREFIX}${sortedAddresses}`;
    },

    getFromLocalStorage: (cacheKey: string) => {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            const parsedData = JSON.parse(cachedData) as CachedTokenAssets;
            if (Date.now() - parsedData.timestamp < ASSETS_CACHE_EXPIRY_MS) {
                return parsedData.data;
            }
        }
        return null;
    },

    saveToLocalStorage: (cacheKey: string, result: TokenAsset[]) => {
        localStorage.setItem(cacheKey, JSON.stringify({
            data: result,
            timestamp: Date.now()
        }));
    },

    getPendingKey: (tokenAddresses: PublicKey[]) => {
        return tokenAddresses
            .map((addr: PublicKey) => addr.toString())
            .sort()
            .join('_');
    }
});

// Export the TokenAsset type for use in other modules
export type { TokenAsset };