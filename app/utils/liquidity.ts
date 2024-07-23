// app/utils/liquidity.ts
import {Decimal} from 'decimal.js';

export function calculateLiquidityDistribution(
    reserveX: number,
    reserveY: number,
    price: number,
    mintXDecimals: number,
    mintYDecimals: number
): { percentX: number; percentY: number } {
    const adjustedX = new Decimal(reserveX).div(Decimal.pow(10, mintXDecimals));
    const adjustedY = new Decimal(reserveY).div(Decimal.pow(10, mintYDecimals));
    const totalValueInY = adjustedX.mul(price).add(adjustedY);
    const percentX = adjustedX.mul(price).div(totalValueInY).mul(100);
    const percentY = new Decimal(100).minus(percentX);
    return {percentX: percentX.toNumber(), percentY: percentY.toNumber()};
}
