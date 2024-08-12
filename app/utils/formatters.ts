import {PublicKey} from "@solana/web3.js";

export const formatPubKey = (pubKeyOrAddress: PublicKey | string): string => {
    const address = typeof pubKeyOrAddress === 'string'
        ? pubKeyOrAddress
        : pubKeyOrAddress.toBase58();

    return `${address.slice(0, 4)}...${address.slice(-4)}`;
};
