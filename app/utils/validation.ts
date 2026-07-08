// app/utils/validation.ts
import {PublicKey} from '@solana/web3.js';

export const isValidSolanaAddress = async (address: string): Promise<boolean> => {
    try {
        // Base58 syntax check only — PDA addresses (e.g. Token-2022 launchpad mints)
        // are valid but off-curve, so no isOnCurve here.
        new PublicKey(address);
        return true;
    } catch (e) {
        return false;
    }
};