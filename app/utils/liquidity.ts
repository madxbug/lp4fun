// app/utils/liquidity.ts
import {Decimal} from 'decimal.js';

// Amounts are UI amounts (already decimal-adjusted), as returned by the Meteora DLMM data API.
export function calculateLiquidityDistribution(
    amountX: number,
    amountY: number,
    price: number
): { percentX: number; percentY: number } {
    const adjustedX = new Decimal(amountX || 0);
    const adjustedY = new Decimal(amountY || 0);
    const totalValueInY = adjustedX.mul(price || 0).add(adjustedY);
    if (totalValueInY.isZero()) {
        return {percentX: 0, percentY: 0};
    }
    const percentX = adjustedX.mul(price || 0).div(totalValueInY).mul(100);
    const percentY = new Decimal(100).minus(percentX);
    return {percentX: percentX.toNumber(), percentY: percentY.toNumber()};
}
