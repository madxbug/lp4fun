import {Connection, PublicKey} from '@solana/web3.js';
import {createCachedRequestWrapper} from "@/app/utils/cachingUtils";

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const CACHE_KEY_PREFIX = 'token_metadata_';

export interface TokenMetadata {
    updateAuthority: string;
    mint: string;
    name: string;
    symbol: string;
    uri: string;
}

async function _getTokenMetadata(
    connection: Connection,
    tokenAddress: PublicKey,
    maxRetries: number = 5,
    initialDelay: number = 1000
): Promise<TokenMetadata | null> {
    const tokenAddressStr = tokenAddress.toString();

    for (let retry = 0; retry < maxRetries; retry++) {
        try {
            const [metadataAddress] = PublicKey.findProgramAddressSync(
                [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), tokenAddress.toBuffer()],
                METADATA_PROGRAM_ID
            );

            const accountInfo = await connection.getAccountInfo(metadataAddress, 'confirmed');

            if (accountInfo && accountInfo.data) {
                return decodeCustomMetadata(accountInfo.data);
            } else {
                console.log(`No metadata found for token: ${tokenAddressStr}`);
                return null;
            }
        } catch (e) {
            console.error(`Error fetching token metadata: ${e}`);
            console.error((e as Error).stack);
        }

        const delayTime = initialDelay * Math.pow(2, retry);
        console.log(`Get token metadata failed. Retry attempt ${retry + 1} after ${delayTime}ms delay.`);
        await new Promise(resolve => setTimeout(resolve, delayTime));
    }

    console.log(`Failed to get token metadata after ${maxRetries} attempts.`);
    return null;
}

export const getTokenMetadata = createCachedRequestWrapper(_getTokenMetadata, {
    getCacheKey: (_, tokenAddress) =>
        `${CACHE_KEY_PREFIX}${tokenAddress.toString()}`,

    getFromLocalStorage: (cacheKey) => {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            return JSON.parse(cachedData) as TokenMetadata;
        }
        return null;
    },

    saveToLocalStorage: (cacheKey, metadata) => {
        if (metadata) {
            localStorage.setItem(cacheKey, JSON.stringify(metadata));
        }
    },

    getPendingKey: (_, tokenAddress) => tokenAddress.toString()
});

function decodeCustomMetadata(data: Buffer): TokenMetadata {
    if (data[0] !== 4) {
        throw new Error("Invalid metadata version");
    }

    const updateAuthority = new PublicKey(data.subarray(1, 33)).toString();
    const mint = new PublicKey(data.subarray(33, 65)).toString();

    let offset = 65;
    const nameLength = data.readUInt32LE(offset);
    offset += 4;
    const name = data.subarray(offset, offset + nameLength).toString('utf-8').replace(/\0/g, '');
    offset += nameLength;

    const symbolLength = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data.subarray(offset, offset + symbolLength).toString('utf-8').replace(/\0/g, '');
    offset += symbolLength;

    const uriLength = data.readUInt32LE(offset);
    offset += 4;
    const uri = data.subarray(offset, offset + uriLength).toString('utf-8').replace(/\0/g, '');

    return { updateAuthority, mint, name, symbol, uri };
}
