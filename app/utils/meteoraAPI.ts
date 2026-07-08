// app/utils/meteoraApi.ts
import Decimal from "decimal.js";

const DLMM_API_BASE = 'https://dlmm.datapi.meteora.ag';

// Raw event from GET /positions/{address}/historical
// Amounts are already decimal-adjusted (UI amounts), blockTime is in milliseconds.
interface PositionEventRaw {
    signature: string;
    ixIndex: number;
    eventType: 'add' | 'remove' | 'claim_fee' | 'claim_reward' | string;
    positionAddress: string;
    blockTime: number;
    slot: number;
    poolAddress: string;
    userAddress: string;
    tokenX: string;
    tokenY: string;
    amountX: string;
    amountY: string;
    amountXUsd: string;
    amountYUsd: string;
    totalUsd: string;
}

export interface MeteoraDeposit {
    tx_id: string;
    position_address: string;
    pair_address: string;
    active_bin_id?: number;
    token_x_amount: Decimal;
    token_y_amount: Decimal;
    token_x_usd_amount: Decimal;
    token_y_usd_amount: Decimal;
    onchain_timestamp: number;
}

export interface MeteoraWithdraw extends MeteoraDeposit {}

export interface MeteoraClaimFee {
    tx_id: string;
    position_address: string;
    pair_address: string;
    fee_x_amount: Decimal;
    fee_y_amount: Decimal;
    fee_x_usd_amount: Decimal;
    fee_y_usd_amount: Decimal;
    onchain_timestamp: number;
}

export interface MeteoraPositionMeta {
    address: string;
    owner: string;
    pair_address: string;
}

export interface MeteoraPositionData {
    meta: MeteoraPositionMeta | null;
    deposits: MeteoraDeposit[];
    withdrawals: MeteoraWithdraw[];
    claimFees: MeteoraClaimFee[];
}

type NumLike = number | string | undefined | null;
const toDec = (v: NumLike) => new Decimal(v ?? 0);
const ms2s = (ms: number) => Math.floor((ms || 0) / 1000);

export async function fetchPositionData(positionAddress: string): Promise<MeteoraPositionData> {
    const empty: MeteoraPositionData = {meta: null, deposits: [], withdrawals: [], claimFees: []};

    try {
        const res = await fetch(`${DLMM_API_BASE}/positions/${positionAddress}/historical?order_direction=asc`);
        if (!res.ok) return empty;

        const json = await res.json();
        const events: PositionEventRaw[] = Array.isArray(json?.events) ? json.events : [];
        if (events.length === 0) return empty;

        const meta: MeteoraPositionMeta = {
            address: positionAddress,
            owner: events[0].userAddress,
            pair_address: events[0].poolAddress,
        };

        const deposits: MeteoraDeposit[] = [];
        const withdrawals: MeteoraWithdraw[] = [];
        const claimFees: MeteoraClaimFee[] = [];

        for (const e of events) {
            if (e.eventType === 'add' || e.eventType === 'remove') {
                const op: MeteoraDeposit = {
                    tx_id: e.signature,
                    position_address: e.positionAddress,
                    pair_address: e.poolAddress,
                    token_x_amount: toDec(e.amountX),
                    token_y_amount: toDec(e.amountY),
                    token_x_usd_amount: toDec(e.amountXUsd),
                    token_y_usd_amount: toDec(e.amountYUsd),
                    onchain_timestamp: ms2s(e.blockTime),
                };
                (e.eventType === 'add' ? deposits : withdrawals).push(op);
            } else if (e.eventType === 'claim_fee') {
                claimFees.push({
                    tx_id: e.signature,
                    position_address: e.positionAddress,
                    pair_address: e.poolAddress,
                    fee_x_amount: toDec(e.amountX),
                    fee_y_amount: toDec(e.amountY),
                    fee_x_usd_amount: toDec(e.amountXUsd),
                    fee_y_usd_amount: toDec(e.amountYUsd),
                    onchain_timestamp: ms2s(e.blockTime),
                });
            }
        }

        return {meta, deposits, withdrawals, claimFees};
    } catch (error) {
        console.error(`Error fetching position data for ${positionAddress}:`, error);
        return empty;
    }
}
