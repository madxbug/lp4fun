// app/types/index.ts

import Decimal from "decimal.js";
import {PublicKey} from "@solana/web3.js";

export interface PositionData {
    lastUpdatedAt: Date;
    totalXAmount: number;
    totalYAmount: number;
    feeX: number;
    feeY: number;
    publicKey: string;
    lowerBinId: number;
    upperBinId: number;
    claimedFeeXAmount: string;
    claimedFeeYAmount: string;
    claimedFeeX: number;
    claimedFeeY: number;
}

export interface PoolData {
    lbPairPositionsData: PositionData[];
    nameX: string;
    nameY: string;
    price: number;
    activeBin: number;
    tokenXDecimal: number;
    tokenYDecimal: number;
}


export interface TokenInfo {
    nameX: string;
    nameY: string;
    price: number;
}

export interface PoolInfo {
    name: string;
    current_price: number;
    liquidity: string;
    fees_24h: number;
    apr: number;
    apy: number;
    bin_step: number;
    base_fee_percentage: string;
    max_fee_percentage: string;
    protocol_fee_percentage: string;
    trade_volume_24h: number;
    cumulative_trade_volume: string;
    cumulative_fee_volume: string;
    tokenXDecimal: number;
    tokenYDecimal: number;
    liquidityDistribution: LiquidityDistribution;
}

export interface LiquidityDistribution {
    percentX: number;
    percentY: number;
}

export interface TotalLiquidity {
    tokenX: number;
    tokenY: number;
    price: Decimal;
    totalValue: Decimal;
}

export interface HistoricalPriceItem {
    address: string;
    unixTime: number;
    value: number;
}

export interface HistoricalPriceData {
    data: {
        items: HistoricalPriceItem[];
    };
    success: boolean;
}

export type TimeInterval =
    | '1m' | '3m' | '5m' | '15m' | '30m'
    | '1H' | '2H' | '4H' | '6H' | '8H' | '12H'
    | '1D' | '3D' | '1W' | '1M';

export type AddressType = 'pair' | 'token';

export enum EventType {
    AddLiquidity = 'AddLiquidity',
    RemoveLiquidity = 'RemoveLiquidity',
    ClaimFee = 'ClaimFee',
    PositionClose = 'PositionClose',
    PositionCreate = 'PositionCreate'
}

export interface EventInfo {
    operation: EventType;
    signature: string;
    blockTime: number;
    lbPair: PublicKey;
    position: PublicKey;
    owner: PublicKey;
    tokenXChange: Decimal;
    tokenYChange: Decimal;
    activeBin: number;
}

export class BalanceInfo {
    tokenXBalance: Decimal;
    tokenYBalance: Decimal;
    exchangeRate: Decimal;
    totalValueInTokenY: Decimal;

    constructor(tokenXBalance: Decimal, tokenYBalance: Decimal, exchangeRate: Decimal, totalValueInTokenY?: Decimal) {
        this.tokenXBalance = tokenXBalance;
        this.tokenYBalance = tokenYBalance;
        this.exchangeRate = exchangeRate;
        if (totalValueInTokenY == undefined) {
            this.totalValueInTokenY = this.exchangeRate.mul(this.tokenXBalance).add(this.tokenYBalance);
        } else {
            this.totalValueInTokenY = totalValueInTokenY;
        }
    }

    static zero(): BalanceInfo {
        return new BalanceInfo(new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0));
    }
}

export interface PositionLiquidityData {
    owner: PublicKey
    lbPair: PublicKey;
    operations: Partial<EventInfo>[];
    tokenXSymbol: string;
    tokenXMint: PublicKey;
    tokenYSymbol: string;
    tokenYMint: PublicKey;
    startDate: Date;
    lastUpdatedAt: Date;
    totalDeposits: BalanceInfo;
    totalWithdrawals: BalanceInfo;
    totalUnclaimedFees: BalanceInfo;
    totalClaimedFees: BalanceInfo;
    totalCurrent: BalanceInfo;
}

export interface WalletData {
    wallet: string;
    dataMap: Map<string, PoolData>;
}
