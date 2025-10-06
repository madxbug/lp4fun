// app/utils/meteoraApi.ts
import Decimal from "decimal.js";

interface MeteoraDepositRaw {
    tx_id: string;
    position_address: string;
    pair_address: string;
    active_bin_id: number;
    token_x_amount: number | string;
    token_y_amount: number | string;
    token_x_usd_amount: number | string;
    token_y_usd_amount: number | string;
    price: number | string;
    onchain_timestamp: number;
}

interface MeteoraWithdrawRaw extends MeteoraDepositRaw {}

interface MeteoraClaimFeeRaw {
    tx_id: string;
    position_address: string;
    pair_address: string;
    fee_x_amount: number | string;
    fee_y_amount: number | string;
    fee_x_usd_amount: number | string;
    fee_y_usd_amount: number | string;
    onchain_timestamp: number;
}

export interface MeteoraDeposit {
    tx_id: string;
    position_address: string;
    pair_address: string;
    active_bin_id: number;
    token_x_amount: Decimal;
    token_y_amount: Decimal;
    token_x_usd_amount: Decimal;
    token_y_usd_amount: Decimal;
    price: Decimal;
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

type NumLike = number | string | undefined | null;
const toDec = (v: NumLike) => new Decimal(v ?? 0);
const scale = (v: NumLike, decimals: number) => toDec(v).div(Decimal.pow(10, decimals));

const normalizeDeposit = (
    r: MeteoraDepositRaw,
    tokenXDecimals: number,
    tokenYDecimals: number
): MeteoraDeposit => ({
    tx_id: r.tx_id,
    position_address: r.position_address,
    pair_address: r.pair_address,
    active_bin_id: r.active_bin_id,
    token_x_amount: scale(r.token_x_amount, tokenXDecimals),
    token_y_amount: scale(r.token_y_amount, tokenYDecimals),
    token_x_usd_amount: toDec(r.token_x_usd_amount),
    token_y_usd_amount: toDec(r.token_y_usd_amount),
    price: toDec(r.price),
    onchain_timestamp: r.onchain_timestamp,
});

const normalizeWithdraw = normalizeDeposit;

const normalizeClaimFee = (
    r: MeteoraClaimFeeRaw,
    tokenXDecimals: number,
    tokenYDecimals: number
): MeteoraClaimFee => ({
    tx_id: r.tx_id,
    position_address: r.position_address,
    pair_address: r.pair_address,
    fee_x_amount: scale(r.fee_x_amount, tokenXDecimals),
    fee_y_amount: scale(r.fee_y_amount, tokenYDecimals),
    fee_x_usd_amount: toDec(r.fee_x_usd_amount),
    fee_y_usd_amount: toDec(r.fee_y_usd_amount),
    onchain_timestamp: r.onchain_timestamp,
});

export async function fetchPositionOperations(
    positionAddress: string,
    tokenXDecimals: number,
    tokenYDecimals: number
): Promise<{
    deposits: MeteoraDeposit[];
    withdrawals: MeteoraWithdraw[];
    claimFees: MeteoraClaimFee[];
}> {
    const base = `https://dlmm-api.meteora.ag/position/${positionAddress}`;

    try {
        const [depRes, witRes, feeRes] = await Promise.all([
            fetch(`${base}/deposits`),
            fetch(`${base}/withdraws`),
            fetch(`${base}/claim_fees`)
        ]);

        const parseArray = async <T>(res: Response): Promise<T[]> => {
            if (!res.ok) return [];
            const json = await res.json();
            return Array.isArray(json) ? (json as T[]) : [];
        };

        const [depRaw, witRaw, feeRaw] = await Promise.all([
            parseArray<MeteoraDepositRaw>(depRes),
            parseArray<MeteoraWithdrawRaw>(witRes),
            parseArray<MeteoraClaimFeeRaw>(feeRes),
        ]);

        const deposits = depRaw.map(r => normalizeDeposit(r, tokenXDecimals, tokenYDecimals));
        const withdrawals = witRaw.map(r => normalizeWithdraw(r, tokenXDecimals, tokenYDecimals));
        const claimFees = feeRaw.map(r => normalizeClaimFee(r, tokenXDecimals, tokenYDecimals));

        return { deposits, withdrawals, claimFees };
    } catch (error) {
        console.error(`Error fetching operations for ${positionAddress}:`, error);
        return { deposits: [], withdrawals: [], claimFees: [] };
    }
}

export interface MeteoraPositionMeta {
    address: string;
    owner: string;
    pair_address: string;
    daily_fee_yield?: number;
    fee_apr_24h?: number;
    fee_apy_24h?: number;
    total_fee_usd_claimed?: number;
    total_fee_x_claimed?: number;
    total_fee_y_claimed?: number;
    total_reward_usd_claimed?: number;
    total_reward_x_claimed?: number;
    total_reward_y_claimed?: number;
}


export async function fetchMeteoraPositionMeta(positionAddress: string): Promise<MeteoraPositionMeta | null> {
    try {
        const res = await fetch(`https://dlmm-api.meteora.ag/position/${positionAddress}`);

        if (!res.ok) return null;

        const json = await res.json();

        return json as MeteoraPositionMeta;
    } catch (err) {
        console.error(`Error fetching position ${positionAddress}:`, err);
        return null;
    }
}
