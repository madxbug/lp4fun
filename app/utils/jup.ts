import {PublicKey} from "@solana/web3.js";
import {TokenInfo} from "@/app/types";
import {delay} from "@/app/utils/rateLimitedFetch";
import {config} from "@/app/utils/config";

export async function fetchTokenPrice(tokenX: PublicKey, tokenY: PublicKey, maxRetries = config.MAX_RETRIES, initialDelay = config.INITIAL_RETRY_DELAY): Promise<TokenInfo> {
    const url = `https://price.jup.ag/v6/price?ids=${tokenX}&vsToken=${tokenY}`;

    for (let retries = 0; retries < maxRetries; retries++) {
        try {
            const response = await fetch(url);

            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status}`);
                continue;
            }

            const text = await response.text();
            let data = JSON.parse(text);

            if (!data.data || !data.data[tokenX.toString()]) {
                console.error('Unexpected response format:', data);
                continue;
            }

            const tokenData = data.data[tokenX.toString()];
            return {
                nameX: tokenData.mintSymbol,
                nameY: tokenData.vsTokenSymbol,
                price: tokenData.price,
            };
        } catch (error: unknown) {
            const delayTime = initialDelay * Math.pow(2, retries);
            console.error(`Fetch token price failed. Retry attempt ${retries + 1} after ${delayTime}ms delay. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await delay(delayTime);
        }
    }
    console.error(`Max retries (${maxRetries}) reached. Returning default values.`);
    return {
        nameX: 'N/A',
        nameY: 'N/A',
        price: -1,
    };
}
