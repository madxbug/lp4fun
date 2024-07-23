// app/utils/numberFormatting.ts
import {Decimal} from 'decimal.js';
import {BN} from "@coral-xyz/anchor";

export function formatNumber(value: number | string | undefined, decimals: number = 6): string {
    if (typeof value === 'undefined') return 'N/A';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return numValue.toFixed(decimals);
}

export function shortenPublicKey(publicKey: string): string {
    if (!publicKey) return 'N/A';
    return publicKey.length <= 8 ? publicKey : `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

export function prettifyNumber(num: number | string | Decimal | undefined, isPercentage: boolean = false): string {
    if (typeof num === 'undefined') return 'N/A';

    const n = num instanceof Decimal ? num : new Decimal(num);

    if (n.isNaN()) return 'N/A';

    if (n.lessThan(1) && n.greaterThan(0)) return n.toFixed(6);
    if (n.lessThan(100)) return n.toFixed(2);
    if (n.lessThan(1000)) return n.toFixed(1);
    if (n.lessThan(1000000)) return n.toNumber().toLocaleString('en-US', {maximumFractionDigits: 0});
    if (n.lessThan(1000000000)) return n.dividedBy(1000000).toFixed(1) + 'M';
    return n.dividedBy(1000000000).toFixed(1) + 'B';
}

export function formatCurrency(value: number | string | Decimal): string {
    const num = value instanceof Decimal ? value : new Decimal(value);
    return '$' + prettifyNumber(num);
}

export function bnToDate(bn: BN): Date {
    const milliseconds = bn.mul(new BN(1000)).toNumber();
    return new Date(milliseconds);
}
