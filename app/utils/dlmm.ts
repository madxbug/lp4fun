// app/utils/dlmm.ts
import {Connection, PublicKey} from "@solana/web3.js";
import {AnchorProvider, Program} from "@coral-xyz/anchor";
import DLMM, {IDL, LbClmm} from "@meteora-ag/dlmm";
import {BalanceInfo, EventInfo, EventType, PositionBalanceInfo, PositionLiquidityData,} from "@/app/types";
import {fetchWithRetry} from "@/app/utils/rateLimitedFetch";
import {blockTime2Date, date2BlockTime, fetchTokenDecimals, formatDecimalTokenBalance} from "@/app/utils/solana";
import Decimal from "decimal.js";
import {getTokenMetadata} from "@/app/utils/tokenMetadata";
import {
    fetchMeteoraPositionMeta,
    fetchPositionOperations,
    MeteoraClaimFee,
    MeteoraDeposit,
    MeteoraWithdraw
} from "@/app/utils/meteoraAPI";
import {fetchTokenUsdPrice} from "@/app/utils/jup";

const BASIS_POINT_MAX = 10000;

export function getPriceFromBinId(binId: number, binStep: number, tokenXDecimal: number, tokenYDecimal: number): Decimal {
    const binStepNum = new Decimal(binStep).div(new Decimal(BASIS_POINT_MAX));
    const base = new Decimal(1).plus(binStepNum);
    return base.pow(binId).mul(Math.pow(10, tokenXDecimal - tokenYDecimal));
}

type MeteoraOp = MeteoraDeposit | MeteoraWithdraw | MeteoraClaimFee;

function processMeteoraOperations(
    operations: MeteoraOp[],
    tokenXMint: PublicKey,
    tokenYMint: PublicKey
): PositionBalanceInfo {
    const balanceInfo = new PositionBalanceInfo([], tokenXMint, tokenYMint);

    const toDec = (v: unknown) =>
        new Decimal(typeof v === "string" ? v : (v ?? 0) as number);

    const isClaimFee = (op: MeteoraOp): op is MeteoraClaimFee =>
        "fee_x_amount" in op || "fee_x_usd_amount" in op;

    operations.sort((a, b) => a.onchain_timestamp - b.onchain_timestamp);

    for (const op of operations) {
        const tokenXAmount = toDec(isClaimFee(op) ? op.fee_x_amount : (op as MeteoraDeposit).token_x_amount);
        const tokenYAmount = toDec(isClaimFee(op) ? op.fee_y_amount : (op as MeteoraDeposit).token_y_amount);

        const usdValue = toDec(isClaimFee(op) ? op.fee_x_usd_amount : (op as MeteoraDeposit).token_x_usd_amount)
            .plus(toDec(isClaimFee(op) ? op.fee_y_usd_amount : (op as MeteoraDeposit).token_y_usd_amount));

        balanceInfo.add(
            new BalanceInfo(tokenXAmount, tokenYAmount, usdValue, op.onchain_timestamp)
        );
    }

    return balanceInfo;
}

async function getCurrentPositionData(
    connection: Connection,
    positionPubKey: string,
    lbPair: PublicKey,
    owner: PublicKey,
    tokenXDecimals: number,
    tokenYDecimals: number,
    tokenXMint: PublicKey,
    tokenYMint: PublicKey
): Promise<{ totalCurrent: BalanceInfo, totalUnclaimedFees: BalanceInfo }> {
    try {
        const dlmm = await fetchWithRetry(() => DLMM.create(connection, lbPair));
        const {userPositions} = await fetchWithRetry(() => dlmm.getPositionsByUserAndLbPair(owner));
        const address = new PublicKey(positionPubKey);
        const positionInfo = userPositions.find(obj => obj.publicKey.equals(address));

        if (positionInfo) {
            const tokenXBalance = formatDecimalTokenBalance(
                Number(positionInfo.positionData.totalXAmount || 0),
                tokenXDecimals
            );
            const tokenYBalance = formatDecimalTokenBalance(
                Number(positionInfo.positionData.totalYAmount || 0),
                tokenYDecimals
            );

            const unclaimedFeesX = formatDecimalTokenBalance(
                Number(positionInfo.positionData.feeX || 0),
                tokenXDecimals
            );
            const unclaimedFeesY = formatDecimalTokenBalance(
                Number(positionInfo.positionData.feeY || 0),
                tokenYDecimals
            );

            const [tokenXUsdPrice, tokenYUsdPrice] = (await Promise.all([
                fetchTokenUsdPrice(tokenXMint),
                fetchTokenUsdPrice(tokenYMint)
            ])).map(price => new Decimal(price));

            const currentUsdValue = tokenXBalance.mul(tokenXUsdPrice).plus(tokenYBalance.mul(tokenYUsdPrice));
            const unclaimedFeesUsdValue = unclaimedFeesX.mul(tokenXUsdPrice).plus(unclaimedFeesY.mul(tokenYUsdPrice));

            const totalCurrent = new BalanceInfo(tokenXBalance, tokenYBalance, currentUsdValue, date2BlockTime());
            const totalUnclaimedFees = new BalanceInfo(unclaimedFeesX, unclaimedFeesY, unclaimedFeesUsdValue, date2BlockTime());

            return {totalCurrent, totalUnclaimedFees};
        }
    } catch (error) {
        console.error(`Error fetching current position data for ${positionPubKey}:`, error);
    }

    return {totalCurrent: BalanceInfo.zero(), totalUnclaimedFees: BalanceInfo.zero()};
}


function buildEventsFromMeteoraOps(
    deposits: MeteoraDeposit[],
    withdrawals: MeteoraWithdraw[],
    claimFees: MeteoraClaimFee[],
    lbPair: PublicKey,
    position: PublicKey,
    owner: PublicKey,
    fallbackActiveBin: number
): EventInfo[] {
    const evts: EventInfo[] = [];

    // Deposits → AddLiquidity (amounts positive)
    for (const d of deposits) {
        evts.push({
            operation: EventType.AddLiquidity,
            signature: d.tx_id,
            blockTime: d.onchain_timestamp,
            lbPair,
            position,
            owner,
            tokenXChange: new Decimal(d.token_x_amount ?? 0),
            tokenYChange: new Decimal(d.token_y_amount ?? 0),
            activeBin: (d as any).active_bin_id ?? fallbackActiveBin,
        });
    }

    // Withdraws → RemoveLiquidity (amounts NEGATIVE to reflect outflow)
    for (const w of withdrawals) {
        evts.push({
            operation: EventType.RemoveLiquidity,
            signature: w.tx_id,
            blockTime: w.onchain_timestamp,
            lbPair,
            position,
            owner,
            tokenXChange: new Decimal(w.token_x_amount ?? 0).neg(),
            tokenYChange: new Decimal(w.token_y_amount ?? 0).neg(),
            activeBin: (w as any).active_bin_id ?? fallbackActiveBin,
        });
    }

    // Claim fees → ClaimFee (amounts positive)
    for (const c of claimFees) {
        evts.push({
            operation: EventType.ClaimFee,
            signature: c.tx_id,
            blockTime: c.onchain_timestamp,
            lbPair,
            position,
            owner,
            tokenXChange: new Decimal(c.fee_x_amount ?? 0),
            tokenYChange: new Decimal(c.fee_y_amount ?? 0),
            // claim_fees response usually lacks active_bin_id → fallback
            activeBin: (c as any).active_bin_id ?? fallbackActiveBin,
        });
    }

    // Order chronologically
    evts.sort((a, b) => a.blockTime - b.blockTime);
    return evts;
}

export async function getPositionsInfo(
    connection: Connection,
    positionPubKeys: string[]
): Promise<{ [key: string]: PositionLiquidityData }> {
    const positionsData: { [key: string]: PositionLiquidityData } = {};
    const provider = new AnchorProvider(connection, {} as any, AnchorProvider.defaultOptions());
    const program = new Program<LbClmm>(IDL, provider);

    const processPosition = async (positionPubKey: string) => {
        try {
            const meta = await fetchMeteoraPositionMeta(positionPubKey);
            if (!meta?.pair_address || !meta?.owner) {
                throw new Error(`Missing pair_address or owner for position ${positionPubKey}`);
            }

            const lbPair = new PublicKey(meta.pair_address);
            const owner = new PublicKey(meta.owner);

            const {activeId, binStep, tokenXMint, tokenYMint} = await fetchWithRetry(() =>
                program.account.lbPair.fetch(lbPair)
            );

            const [tokenXDecimals, tokenYDecimals] = await Promise.all([
                fetchTokenDecimals(connection, tokenXMint),
                fetchTokenDecimals(connection, tokenYMint),
            ]);

            const {
                deposits,
                withdrawals,
                claimFees
            } = await fetchPositionOperations(positionPubKey, tokenXDecimals, tokenYDecimals);

            const operations: EventInfo[] = buildEventsFromMeteoraOps(
                deposits,
                withdrawals,
                claimFees,
                lbPair,
                new PublicKey(positionPubKey),
                owner,
                Number(activeId)
            );

            const totalDeposits = processMeteoraOperations(deposits, tokenXMint, tokenYMint);
            const totalWithdrawals = processMeteoraOperations(withdrawals, tokenXMint, tokenYMint);
            const totalClaimedFees = processMeteoraOperations(claimFees, tokenXMint, tokenYMint);

            const {totalCurrent, totalUnclaimedFees} = await getCurrentPositionData(
                connection,
                positionPubKey,
                lbPair,
                owner,
                tokenXDecimals,
                tokenYDecimals,
                tokenXMint,
                tokenYMint
            );

            const [mintInfoX, mintInfoY] = await Promise.all([
                getTokenMetadata(connection, tokenXMint),
                getTokenMetadata(connection, tokenYMint),
            ]);

            const allTimes = [
                ...deposits.map(d => d.onchain_timestamp),
                ...withdrawals.map(w => w.onchain_timestamp),
                ...claimFees.map(c => c.onchain_timestamp),
            ].filter(t => Number.isFinite(t) && t > 0).sort((a, b) => a - b);

            const startDate = allTimes.length ? blockTime2Date(allTimes[0]) : new Date();
            const lastUpdatedAt = allTimes.length ? blockTime2Date(allTimes[allTimes.length - 1]) : new Date();

            positionsData[positionPubKey] = {
                owner,
                lbPair,
                operations,
                tokenXSymbol: mintInfoX?.symbol ?? 'Unknown Token X',
                tokenXMint,
                tokenYSymbol: mintInfoY?.symbol ?? 'Unknown Token Y',
                tokenYMint,
                startDate,
                lastUpdatedAt,
                totalDeposits,
                totalWithdrawals,
                totalUnclaimedFees: new PositionBalanceInfo([totalUnclaimedFees], tokenXMint, tokenYMint),
                totalClaimedFees,
                totalCurrent: new PositionBalanceInfo([totalCurrent], tokenXMint, tokenYMint),
            };
        } catch (error) {
            console.error(`Error processing position ${positionPubKey}:`, error);
        }
    };

    await Promise.all(positionPubKeys.map(processPosition));
    return positionsData;
}
