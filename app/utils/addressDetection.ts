// app/utils/addressDetection.ts
import { PublicKey } from '@solana/web3.js';
import { getDefaultConnection } from './cachedConnection';

export type AddressType = 'wallet' | 'token' | 'invalid';

interface AddressDetectionResult {
    type: AddressType;
    address: string;
}

/**
 * Detects whether an address is a wallet or token by checking for token accounts
 * Wallets typically have token accounts associated with them
 * Tokens are mint addresses and won't have token accounts
 */
export async function detectAddressType(address: string): Promise<AddressDetectionResult> {
    try {
        const publicKey = new PublicKey(address);

        // First check if it's a valid Solana address
        if (!PublicKey.isOnCurve(publicKey)) {
            return { type: 'invalid', address };
        }

        const connection = getDefaultConnection();

        // Get account info to check what type of account it is
        const accountInfo = await connection.getAccountInfo(publicKey);

        if (!accountInfo) {
            return { type: 'invalid', address };
        }

        // Check if this is a token mint by looking at the account owner
        // Token mints are owned by the Token Program
        const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

        if (accountInfo.owner.toString() === TOKEN_PROGRAM_ID) {
            // This is likely a token mint if the data length matches mint data structure (82 bytes)
            if (accountInfo.data.length === 82) {
                return { type: 'token', address };
            }
        }

        // Check if the account has token accounts (typical for wallets)
        // We'll try to get token accounts by owner
        try {
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                publicKey,
                { programId: new PublicKey(TOKEN_PROGRAM_ID) }
            );

            // If it has token accounts, it's likely a wallet
            if (tokenAccounts.value.length > 0) {
                return { type: 'wallet', address };
            }
        } catch (error) {
            // If we can't get token accounts, it might be a token mint
            console.log('Could not fetch token accounts:', error);
        }

        // Additional check: try to fetch mint info
        // If this succeeds, it's definitely a token
        try {
            const { getMint } = await import('@solana/spl-token');
            await getMint(connection, publicKey);
            return { type: 'token', address };
        } catch (error) {
            // Not a token mint
        }

        // If we have account info but it's not clearly a token or wallet with token accounts,
        // default to wallet (could be a system account, program, etc.)
        return { type: 'wallet', address };

    } catch (error) {
        console.error('Error detecting address type:', error);
        return { type: 'invalid', address };
    }
}
