import { Connection, PublicKey } from '@solana/web3.js';

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export interface TokenMetadata {
    updateAuthority: string;
    mint: string;
    name: string;
    symbol: string;
    uri: string;
}

class MetadataDecodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MetadataDecodeError";
    }
}

export async function getTokenMetadata(
    connection: Connection,
    tokenAddress: PublicKey,
    maxRetries: number = 5,
    initialDelay: number = 1000
): Promise<TokenMetadata | null> {
    for (let retry = 0; retry < maxRetries; retry++) {
        try {
            const [metadataAddress] = await PublicKey.findProgramAddress(
                [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), tokenAddress.toBuffer()],
                METADATA_PROGRAM_ID
            );

            const accountInfo = await connection.getAccountInfo(metadataAddress, 'confirmed');

            if (accountInfo && accountInfo.data) {
                return decodeCustomMetadata(accountInfo.data);
            } else {
                console.log(`No metadata found for token: ${tokenAddress.toString()}`);
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
