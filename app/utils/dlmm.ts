import {Connection, ParsedTransactionWithMeta, PublicKey} from "@solana/web3.js";
import {AnchorProvider, Program, utils} from "@coral-xyz/anchor";
import DLMM, {IDL, LBCLMM_PROGRAM_IDS} from "@meteora-ag/dlmm";
import {BalanceInfo, EventInfo, EventType, PositionLiquidityData, TokenInfo} from "@/app/types";
import {fetchTokenPrice} from "@/app/utils/jup";
import {fetchWithRetry} from "@/app/utils/rateLimitedFetch";
import {
    blockTime2Date,
    fetchSignaturesForAddress,
    fetchTokenDecimals,
    formatDecimalTokenBalance
} from "@/app/utils/solana";
import {config} from "@/app/utils/config";
import Decimal from "decimal.js";
import {determineIntervalIndex, determineOptimalTimeInterval, getHistoricalPrice} from "@/app/utils/birdeye";

const BASIS_POINT_MAX = 10000;

export function getPriceFromBinId(binId: number, binStep: number, tokenXDecimal: number, tokenYDecimal: number): Decimal {
    const binStepNum = new Decimal(binStep).div(new Decimal(BASIS_POINT_MAX));
    const base = new Decimal(1).plus(binStepNum);
    return base.pow(binId).mul(Math.pow(10, tokenXDecimal - tokenYDecimal));
}


function parseEvent(event: any): Partial<EventInfo> {
    const baseEvent = {
        operation: event.name as EventType,
        lbPair: event.data.lbPair,
        position: event.data.position,
        tokenXChange: new Decimal(0),
        tokenYChange: new Decimal(0)
    };
    switch (event.name) {
        case EventType.AddLiquidity:
        case EventType.RemoveLiquidity:
            return {
                ...baseEvent,
                tokenXChange: event.data.amounts[0].toNumber(),
                tokenYChange: event.data.amounts[1].toNumber(),
                activeBin: event.data.activeBinId,
                lbPair: event.data.lbPair,
                position: event.data.position
            };
        case EventType.ClaimFee:
            return {
                ...baseEvent,
                tokenXChange: event.data.feeX,
                tokenYChange: event.data.feeY,
                lbPair: event.data.lbPair,
                position: event.data.position
            };
        case EventType.PositionClose:
            return {
                ...baseEvent,
                position: event.data.position
            };
        case EventType.PositionCreate:
            return {
                ...baseEvent,
                lbPair: event.data.lbPair,
                position: event.data.position,
                owner: event.data.owner
            };
        default:
            return baseEvent;
    }
}

async function fetchSessionEvents(connection: Connection, positionPubKeys: string[]): Promise<{
    [key: string]: Partial<EventInfo>[]
}> {
    const provider = new AnchorProvider(connection, {} as any, AnchorProvider.defaultOptions());
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS["mainnet-beta"], provider);

    const processTransaction = async (transaction: ParsedTransactionWithMeta | null): Promise<Partial<EventInfo>[]> => {
        if (!transaction) return [];
        if (!transaction?.meta?.innerInstructions || transaction.meta.err !== null) return [];

        const events: Partial<EventInfo>[] = [];

        for (const ix of transaction.meta.innerInstructions) {
            for (const iix of ix.instructions) {
                if (!iix.programId.equals(program.programId) || !("data" in iix)) continue;

                const ixData = utils.bytes.bs58.decode(iix.data);
                const eventData = utils.bytes.base64.encode(ixData.subarray(8));
                const event = program.coder.events.decode(eventData);

                if (!event) continue;
                let parsedEvent = parseEvent(event);
                parsedEvent.signature = transaction.transaction.signatures[0];
                parsedEvent.blockTime = transaction.blockTime ?? 0;
                if (parsedEvent.operation && parsedEvent.operation in EventType) {  // Ignore unknown operations
                    events.push(parsedEvent);
                }
            }
        }

        return events;
    };

    const fetchEventsForPosition = async (positionPubKey: string): Promise<Partial<EventInfo>[]> => {
        const address = new PublicKey(positionPubKey);
        const allSignatures = await fetchSignaturesForAddress(address, connection);

        const allEvents: Partial<EventInfo>[] = [];

        for (let i = allSignatures.length - 1; i >= 0; i -= config.MAX_BATCH_SIZE) {
            const startIndex = Math.max(0, i - config.MAX_BATCH_SIZE + 1);
            const batchSignatures = allSignatures.slice(startIndex, i + 1).reverse();

            const transactions = await fetchWithRetry(() =>
                connection.getParsedTransactions(
                    batchSignatures.map(s => s.signature),
                    {maxSupportedTransactionVersion: 0}
                )
            );

            const batchEvents = await Promise.all(
                transactions.map(transaction => processTransaction(transaction))
            );

            allEvents.push(...batchEvents.flat());
        }

        return allEvents;
    };

    const positionsData = await Promise.all(
        positionPubKeys.map(async (positionPubKey) => ({
            [positionPubKey]: await fetchEventsForPosition(positionPubKey)
        }))
    );

    return Object.assign({}, ...positionsData);
}

async function getOpenPositionLiveData(
    connection: Connection,
    positionPubKey: string,
    lbPair: PublicKey,
    owner: PublicKey,
    activeId: number,
    binStep: number,
    tokenXDecimals: number,
    tokenYDecimals: number
): Promise<{ totalCurrent: BalanceInfo, totalUnclaimedFees: BalanceInfo }> {
    const dlmm = await fetchWithRetry(() => DLMM.create(connection, lbPair));
    const {userPositions} = await fetchWithRetry(() => dlmm.getPositionsByUserAndLbPair(owner));
    const address = new PublicKey(positionPubKey);
    const positionInfo = userPositions.find(obj => obj.publicKey.equals(address));

    if (positionInfo) {
        const currentPrice = getPriceFromBinId(activeId, binStep, tokenXDecimals, tokenYDecimals);

        const tokenXBalance = formatDecimalTokenBalance(Number(positionInfo?.positionData.totalXAmount || 0), tokenXDecimals);
        const tokenYBalance = formatDecimalTokenBalance(Number(positionInfo?.positionData.totalYAmount || 0), tokenYDecimals);
        const totalCurrent = new BalanceInfo(tokenXBalance, tokenYBalance, currentPrice,);

        const unclaimedFeesX = formatDecimalTokenBalance(Number(positionInfo?.positionData.feeX || 0), tokenXDecimals);
        const unclaimedFeesY = formatDecimalTokenBalance(Number(positionInfo?.positionData.feeY || 0), tokenYDecimals);
        const totalUnclaimedFees = new BalanceInfo(unclaimedFeesX, unclaimedFeesY, currentPrice);

        return {totalCurrent, totalUnclaimedFees};
    }

    return {totalCurrent: BalanceInfo.zero(), totalUnclaimedFees: BalanceInfo.zero()};
}

function calculateWeightedPrice(
    currentPrice: Decimal,
    currentValue: Decimal,
    newPrice: Decimal,
    addedValue: Decimal
): Decimal {
    if (addedValue.isZero()) {
        return currentPrice;
    }
    const totalValue = currentValue.plus(addedValue);

    const currentWeight = currentValue.div(totalValue);
    const newWeight = addedValue.div(totalValue);

    return currentPrice.mul(currentWeight).plus(newPrice.mul(newWeight));
}

function calculateBalanceChange(events: Partial<EventInfo>[], binStep: number, tokenXDecimals: number, tokenYDecimals: number): {
    totalDeposits: BalanceInfo,
    totalWithdrawals: BalanceInfo,
} {
    const totalDeposits = BalanceInfo.zero();
    const totalWithdrawals = BalanceInfo.zero();

    for (const event of events) {
        switch (event.operation) {
            case EventType.AddLiquidity:
                updateBalance(totalDeposits, event, binStep, tokenXDecimals, tokenYDecimals);
                break;
            case EventType.RemoveLiquidity:
                updateBalance(totalWithdrawals, event, binStep, tokenXDecimals, tokenYDecimals);
                break;
        }
    }
    return {totalDeposits, totalWithdrawals};
}

export async function getPositionsInfo(connection: Connection,
                                       positionPubKeys: string[]): Promise<{ [key: string]: PositionLiquidityData }> {
    const positionsData: { [key: string]: PositionLiquidityData } = {};

    const provider = new AnchorProvider(connection, {} as any, AnchorProvider.defaultOptions());
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS["mainnet-beta"], provider);
    const sessionEvents = await fetchSessionEvents(connection, positionPubKeys);

    const processPosition = async (positionPubKey: string, events: Partial<EventInfo>[]) => {
        const positionCreateEvent = events.find(event => event.operation === EventType.PositionCreate);
        if (!positionCreateEvent || !positionCreateEvent.lbPair || !positionCreateEvent.owner) {
            console.error("Wasn't able to find position Create event in position:", positionPubKey);
            return;
        }
        try {
            const {activeId, binStep, tokenXMint, tokenYMint} = await fetchWithRetry(() =>
                program.account.lbPair.fetch(positionCreateEvent.lbPair as PublicKey)
            );

            const [tokenXDecimals, tokenYDecimals] = await Promise.all([
                fetchTokenDecimals(connection, tokenXMint),
                fetchTokenDecimals(connection, tokenYMint)
            ]);

            events.forEach(event => {
                event.tokenXChange = formatDecimalTokenBalance(Number(event.tokenXChange), tokenXDecimals);
                event.tokenYChange = formatDecimalTokenBalance(Number(event.tokenYChange), tokenYDecimals);
            });

            const tokenInfo = await fetchTokenPrice(tokenXMint, tokenYMint);

            const positionCloseEvent = events.find(event => event.operation === EventType.PositionClose);

            let totalCurrent = BalanceInfo.zero();
            let totalUnclaimedFees = BalanceInfo.zero();

            // position is still open, fetch position live data
            if (!positionCloseEvent) {
                ({totalCurrent, totalUnclaimedFees} = await getOpenPositionLiveData(
                    connection,
                    positionPubKey,
                    positionCreateEvent.lbPair,
                    positionCreateEvent.owner,
                    activeId,
                    binStep,
                    tokenXDecimals,
                    tokenYDecimals
                ));
            }

            const {
                totalDeposits,
                totalWithdrawals
            } = calculateBalanceChange(events, binStep, tokenXDecimals, tokenYDecimals);

            const totalClaimedFees = await calculateClaimedFees(positionCreateEvent.lbPair, events, tokenInfo);

            positionsData[positionPubKey] = {
                owner: positionCreateEvent.owner,
                lbPair: positionCreateEvent.lbPair,
                operations: events,
                tokenXSymbol: tokenInfo.nameX,
                tokenXMint: tokenXMint,
                tokenYSymbol: tokenInfo.nameY,
                tokenYMint: tokenYMint,
                startDate: blockTime2Date(positionCreateEvent.blockTime),
                lastUpdatedAt: blockTime2Date(events[events.length - 1].blockTime),
                totalDeposits,
                totalWithdrawals,
                totalUnclaimedFees,
                totalClaimedFees,
                totalCurrent
            };
        } catch (error) {
            console.error(`Error processing position ${positionPubKey}:`, error);
        }
    };

    await Promise.all(Object.entries(sessionEvents).map(([positionPubKey, events]) => processPosition(positionPubKey, events)));

    return positionsData;
}

function updateBalanceWithEvent(balance: BalanceInfo, event: Partial<EventInfo>, price: Decimal): void {
    const tokenXChange = new Decimal(event.tokenXChange || 0);
    const tokenYChange = new Decimal(event.tokenYChange || 0);
    const valueChange = price.mul(tokenXChange).add(tokenYChange);

    balance.tokenXBalance = balance.tokenXBalance.add(tokenXChange);
    balance.tokenYBalance = balance.tokenYBalance.add(tokenYChange);
    balance.exchangeRate = calculateWeightedPrice(balance.exchangeRate, balance.totalValueInTokenY, price, valueChange);
    balance.totalValueInTokenY = balance.totalValueInTokenY.add(valueChange);
}

function updateBalance(balance: BalanceInfo, event: Partial<EventInfo>, binStep: number, tokenXDecimals: number, tokenYDecimals: number): void {
    if (event.tokenXChange === undefined || event.tokenYChange === undefined || event.activeBin === undefined) {
        console.error('Invalid event data:', event);
        return;
    }

    const newExchangeRate = getPriceFromBinId(event.activeBin, binStep, tokenXDecimals, tokenYDecimals);
    updateBalanceWithEvent(balance, event, newExchangeRate);
}

async function calculateClaimedFees(lbPair: PublicKey, events: Partial<EventInfo>[], tokenInfo: TokenInfo): Promise<BalanceInfo> {
    const totalClaimedFees = BalanceInfo.zero();
    const claimFeeEvents = events.filter(tx => tx.operation === EventType.ClaimFee);
    if (claimFeeEvents.length === 0) {
        return totalClaimedFees;
    }

    const fromBlockTime = claimFeeEvents[0].blockTime || 0;
    const toBlockTime = claimFeeEvents[claimFeeEvents.length - 1].blockTime || 0;
    const optimalTimeInterval = determineOptimalTimeInterval(fromBlockTime, toBlockTime);

    const indexedClaimFeeTransactions = claimFeeEvents.map(event => ({
        ...event,
        index: determineIntervalIndex(fromBlockTime, optimalTimeInterval, event.blockTime || 0)
    }));

    try {
        const historicalPrices = await getHistoricalPrice(lbPair.toString(), 'pair', optimalTimeInterval, fromBlockTime, toBlockTime);
        const maxAvailableIndex = historicalPrices.data.items.length - 1;

        for (const event of indexedClaimFeeTransactions) {
            const priceIndex = Math.min(event.index, maxAvailableIndex);
            const price = historicalPrices.data.items[priceIndex];
            if (price) {
                updateBalanceWithEvent(totalClaimedFees, event, new Decimal(price.value));
            }
        }
    } catch (error) {
        console.error('Error fetching historical prices:', error);
        console.info('Using current JUP price:', tokenInfo.price);
        // TODO here it is possible to use TWAP based on previous events with activeBin and tokenInfo.price as latest price
        for (const event of claimFeeEvents) {
            updateBalanceWithEvent(totalClaimedFees, event, new Decimal(tokenInfo.price));
        }
    }

    return totalClaimedFees;
}
