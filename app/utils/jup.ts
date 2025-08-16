import {PublicKey} from "@solana/web3.js";
import {TokenInfo} from "@/app/types";
import {delay} from "@/app/utils/rateLimitedFetch";
import {config} from "@/app/utils/config";
import {createCachedRequestWrapper} from "@/app/utils/cachingUtils";

const TOKEN_PRICE_CACHE_PREFIX = 'token_price_';
const PRICE_CACHE_EXPIRY_MS = 60000; // 60 seconds

interface CachedPrice {
    data: TokenInfo;
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
                price: tokenXData.price/tokenYData.price,
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