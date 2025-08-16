// app/utils/solana.ts
import {Connection, PublicKey} from "@solana/web3.js";
import {getMint} from "@solana/spl-token";
import {fetchWithRetry} from "@/app/utils/rateLimitedFetch";
import {config} from "@/app/utils/config";
import Decimal from "decimal.js";
import {createCachedRequestWrapper} from "@/app/utils/cachingUtils";


export const formatTokenBalance = (balance: bigint | number | undefined, decimals: number): number =>
    balance === undefined ? 0 : Number(balance) / 10 ** decimals;

export const formatDecimalTokenBalance = (balance: bigint | number | undefined, decimals: number): Decimal =>
    new Decimal(formatTokenBalance(balance, decimals));

const TOKEN_DECIMALS_CACHE_PREFIX = 'token_decimals_';

async function _fetchTokenDecimals(
    connection: Connection,
    mint: PublicKey
): Promise<number> {
    const mintAccountInfo = await connection.getAccountInfo(mint);

    if (!mintAccountInfo) {
        throw new Error('Mint account not found');
    }

    // Determine the token program based on the account owner
    const tokenProgram = mintAccountInfo.owner;

    const mintInfo = await fetchWithRetry(() =>
        getMint(
            connection,
            mint,
            undefined,
            tokenProgram
        )
    );

    return mintInfo.decimals;
}

export const fetchTokenDecimals = createCachedRequestWrapper(_fetchTokenDecimals, {
    getCacheKey: (_, mint) =>
        `${TOKEN_DECIMALS_CACHE_PREFIX}${mint.toString()}`,

    getFromLocalStorage: (cacheKey) => {
        const cachedValue = localStorage.getItem(cacheKey);
        if (cachedValue !== null) {
            return parseInt(cachedValue, 10);
        }
        return null;
    },

    saveToLocalStorage: (cacheKey, decimals) => {
        localStorage.setItem(cacheKey, decimals.toString());
    },

    getPendingKey: (_, mint) => mint.toString()
});


export async function fetchSignaturesForAddress(address: PublicKey, connection: Connection): Promise<{
    signature: string;
    blockTime: number | null
}[]> {
    let allSignatures = [];
    let lastSignature: string | undefined;

    while (true) {
        const signatureInfos = await fetchWithRetry(() =>
            connection.getSignaturesForAddress(address, {limit: config.MAX_BATCH_SIZE, before: lastSignature})
        );

        if (signatureInfos.length === 0) break;

        allSignatures.push(...signatureInfos.map(info => ({
            signature: info.signature,
            blockTime: info.blockTime ?? null
        })));

        lastSignature = signatureInfos[signatureInfos.length - 1].signature;
    }

    return allSignatures;
}

export function blockTime2Date(blockTime: number | undefined): Date {
    return new Date((blockTime || 0) * 1000)
}

export function date2BlockTime(date: Date = new Date()): number {
    return Math.floor(date.getTime() / 1000);
}
