// app/utils/validation.ts
import {PublicKey} from '@solana/web3.js';

export const isValidSolanaAddress = async (address: string): Promise<boolean> => {
    try {
        const publicKey = new PublicKey(address);
        return PublicKey.isOnCurve(publicKey);
    } catch (e) {
        return false;
    }
};