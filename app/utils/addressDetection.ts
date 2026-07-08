// app/utils/addressDetection.ts
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint } from '@solana/spl-token';
import { getDefaultConnection } from './cachedConnection';

export type AddressType = 'wallet' | 'token' | 'invalid';

interface AddressDetectionResult {
    type: AddressType;
    address: string;
}

/**
 * Detects whether an address is a token mint or a wallet from its on-chain account.
 * Handles both legacy SPL Token and Token-2022 mints (including extension data).
 */
export async function detectAddressType(address: string): Promise<AddressDetectionResult> {
    let publicKey: PublicKey;
    try {
        publicKey = new PublicKey(address);
    } catch {
        return { type: 'invalid', address };
    }

    try {
        const connection = getDefaultConnection();
        const accountInfo = await connection.getAccountInfo(publicKey);

        if (!accountInfo) {
            // Unfunded wallets have no account yet; PDAs without an account are nothing we can use
            return PublicKey.isOnCurve(publicKey)
                ? { type: 'wallet', address }
                : { type: 'invalid', address };
        }

        if (accountInfo.owner.equals(TOKEN_PROGRAM_ID) || accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
            try {
                // Parses only genuine mints; throws for token accounts and multisigs
                unpackMint(publicKey, accountInfo, accountInfo.owner);
                return { type: 'token', address };
            } catch {
                return { type: 'wallet', address };
            }
        }

        // System accounts, programs, everything else: treat as wallet
        return { type: 'wallet', address };
    } catch (error) {
        console.error('Error detecting address type:', error);
        return { type: 'invalid', address };
    }
}
