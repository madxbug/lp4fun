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
    if (n.isZero()) return '0';
    const absN = n.abs();

    // Unicode subscript digits
    const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

    // Function to format very small numbers with zero count
    const formatSmallNumber = (num: Decimal): string => {
        if (num.isZero()) return '0';

        let e = num.e;
        let m = num.d.join('').substring(0, 5);  // Up to 5 significant digits

        // Count leading zeros
        let zeroCount = -e - 1;  // Subtract 1 to account for the first significant digit
        zeroCount = Math.max(zeroCount, 0);  // Ensure zeroCount is not negative

        // Convert zero count to subscript
        const subscriptZeros = zeroCount.toString().split('').map(digit => subscripts[parseInt(digit)]).join('');

        // Format the number
        const sign = num.isNegative() ? '-' : '';
        return `${sign}$0.0${subscriptZeros}${m}`;
    };

    // Very small numbers
    if (absN.lessThan('0.000001')) {
        return formatSmallNumber(n);
    }

    // Numbers between 0.000001 and 0.001
    if (absN.lessThan('0.001')) {
        return n.toFixed(6);
    }

    // Numbers between 0.001 and 1
    if (absN.lessThan(1)) {
        return n.toFixed(4);
    }

    // Numbers between 1 and 100
    if (absN.lessThan(100)) {
        return n.toFixed(2);
    }

    // Numbers between 100 and 1,000
    if (absN.lessThan(1000)) {
        return n.toFixed(1);
    }

    // Numbers between 1,000 and 1,000,000
    if (absN.lessThan(1000000)) {
        return n.toNumber().toLocaleString('en-US', {maximumFractionDigits: 0});
    }

    // Numbers between 1,000,000 and 1,000,000,000 (Millions)
    if (absN.lessThan(1000000000)) {
        return (n.dividedBy(1000000).toNumber()).toLocaleString('en-US', {maximumFractionDigits: 1}) + 'M';
    }

    // Numbers 1,000,000,000 and above (Billions)
    return (n.dividedBy(1000000000).toNumber()).toLocaleString('en-US', {maximumFractionDigits: 1}) + 'B';
}

export function formatCurrency(value: number | string | Decimal): string {
    const num = value instanceof Decimal ? value : new Decimal(value);
    return '$' + prettifyNumber(num);
}

export function bnToDate(bn: BN): Date {
    const milliseconds = bn.mul(new BN(1000)).toNumber();
    return new Date(milliseconds);
}
