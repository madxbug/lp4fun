// app/utils/solana.ts
import {Connection, PublicKey} from "@solana/web3.js";
import {getMint} from "@solana/spl-token";
import {fetchWithRetry} from "@/app/utils/rateLimitedFetch";
import {config} from "@/app/utils/config";
import Decimal from "decimal.js";


export const formatTokenBalance = (balance: bigint | number | undefined, decimals: number): number =>
    balance === undefined ? 0 : Number(balance) / 10 ** decimals;

export const formatDecimalTokenBalance = (balance: bigint | number | undefined, decimals: number): Decimal =>
    new Decimal(formatTokenBalance(balance, decimals));

export const fetchTokenDecimals = async (connection: Connection, mint: PublicKey): Promise<number> => {
    const mintInfo = await fetchWithRetry(() => getMint(connection, mint));
    return mintInfo.decimals;
};

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
