import {Connection, ParsedTransactionWithMeta, PublicKey} from "@solana/web3.js";
import {AnchorProvider, Program, utils} from "@coral-xyz/anchor";
import DLMM, {IDL, LBCLMM_PROGRAM_IDS} from "@meteora-ag/dlmm";
import {
    BalanceInfo,
    EventInfo,
    EventType,
    HistoricalPriceItem,
    PositionBalanceInfo,
    PositionLiquidityData,
    TokenInfo
} from "@/app/types";
import {fetchTokenPrice} from "@/app/utils/jup";
import {fetchWithRetry} from "@/app/utils/rateLimitedFetch";
import {
    blockTime2Date, date2BlockTime,
    fetchSignaturesForAddress,
    fetchTokenDecimals,
    formatDecimalTokenBalance
} from "@/app/utils/solana";
import {config} from "@/app/utils/config";
import Decimal from "decimal.js";
import {determineIntervalIndex, determineOptimalTimeInterval, getHistoricalPrice} from "@/app/utils/birdeye";
import {getTokenMetadata} from "@/app/utils/tokenMetadata";

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
        const totalCurrent = new BalanceInfo(tokenXBalance, tokenYBalance, currentPrice, date2BlockTime());

        const unclaimedFeesX = formatDecimalTokenBalance(Number(positionInfo?.positionData.feeX || 0), tokenXDecimals);
        const unclaimedFeesY = formatDecimalTokenBalance(Number(positionInfo?.positionData.feeY || 0), tokenYDecimals);
        const totalUnclaimedFees = new BalanceInfo(unclaimedFeesX, unclaimedFeesY, currentPrice, date2BlockTime());

        return {totalCurrent, totalUnclaimedFees};
    }

    return {totalCurrent: BalanceInfo.zero(), totalUnclaimedFees: BalanceInfo.zero()};
}


function calculateBalanceChange(events: Partial<EventInfo>[], binStep: number,
                                tokenXDecimals: number, tokenYDecimals: number,
                                tokenXMint: PublicKey, tokenYMint: PublicKey): {
    totalDeposits: PositionBalanceInfo,
    totalWithdrawals: PositionBalanceInfo,
} {
    const totalDeposits = new PositionBalanceInfo([], tokenXMint, tokenYMint);
    const totalWithdrawals = new PositionBalanceInfo([], tokenXMint, tokenYMint);

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

function getBlockTimesByTokenYMint(positions: [string, PositionLiquidityData][]): { [tokenYMint: string]: number[] } {
    const blockTimesByMint = new Map<string, Set<number>>();

    positions.forEach(([_, position]) => {
        const tokenYMintString = position.tokenYMint.toString();

        if (!blockTimesByMint.has(tokenYMintString)) {
            blockTimesByMint.set(tokenYMintString, new Set<number>());
        }

        const mintBlockTimes = blockTimesByMint.get(tokenYMintString)!;

        position.operations.forEach(operation => {
            if (operation.blockTime) {
                mintBlockTimes.add(operation.blockTime);
            }
        });

        const addBalanceInfoBlockTimes = (balanceInfo: PositionBalanceInfo) => {
            balanceInfo.balances.forEach(balance => {
                mintBlockTimes.add(balance.blockTime);
            });
        };

        addBalanceInfoBlockTimes(position.totalDeposits);
        addBalanceInfoBlockTimes(position.totalWithdrawals);
        addBalanceInfoBlockTimes(position.totalUnclaimedFees);
        addBalanceInfoBlockTimes(position.totalClaimedFees);
        addBalanceInfoBlockTimes(position.totalCurrent);
    });

    const result: { [tokenYMint: string]: number[] } = {};
    blockTimesByMint.forEach((blockTimes, mint) => {
        result[mint] = Array.from(blockTimes).sort((a, b) => a - b);
    });

    return result;
}

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

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
            } = calculateBalanceChange(events, binStep, tokenXDecimals, tokenYDecimals, tokenXMint, tokenYMint);
            const totalClaimedFees = await calculateClaimedFees(positionCreateEvent.lbPair,
                events, tokenInfo, tokenXMint, tokenYMint);
            const mintInfoX = await getTokenMetadata(connection, tokenXMint);
            const mintInfoY = await getTokenMetadata(connection, tokenYMint);
            positionsData[positionPubKey] = {
                owner: positionCreateEvent.owner,
                lbPair: positionCreateEvent.lbPair,
                operations: events,
                tokenXSymbol: mintInfoX?.symbol ?? 'Unknown Token X',
                tokenXMint: tokenXMint,
                tokenYSymbol: mintInfoY?.symbol ?? 'Unknown Token Y',
                tokenYMint: tokenYMint,
                startDate: blockTime2Date(positionCreateEvent.blockTime),
                lastUpdatedAt: blockTime2Date(events[events.length - 1].blockTime),
                totalDeposits,
                totalWithdrawals,
                totalUnclaimedFees: new PositionBalanceInfo([totalUnclaimedFees], tokenXMint, tokenYMint),
                totalClaimedFees,
                totalCurrent: new PositionBalanceInfo([totalCurrent], tokenXMint, tokenYMint)
            };
        } catch (error) {
            console.error(`Error processing position ${positionPubKey}:`, error);
        }
    };

    await Promise.all(Object.entries(sessionEvents).map(([positionPubKey, events]) => processPosition(positionPubKey, events)));

    const nonSolPositions = Object.entries(positionsData).filter(([_, position]) => {
        return !position.tokenXMint.equals(SOL_MINT) &&
            !position.tokenYMint.equals(SOL_MINT);
    });
    await processPositionsWithPrices(nonSolPositions);
    return positionsData;
}

function updateBalanceWithEvent(balance: PositionBalanceInfo, event: Partial<EventInfo>, price: Decimal): void {
    const tokenXChange = new Decimal(event.tokenXChange || 0);
    const tokenYChange = new Decimal(event.tokenYChange || 0);
    balance.add(new BalanceInfo(tokenXChange, tokenYChange, price, event.blockTime || 0))
}

function updateBalance(balance: PositionBalanceInfo, event: Partial<EventInfo>, binStep: number, tokenXDecimals: number, tokenYDecimals: number): void {
    if (event.tokenXChange === undefined || event.tokenYChange === undefined || event.activeBin === undefined) {
        console.error('Invalid event data:', event);
        return;
    }

    const newExchangeRate = getPriceFromBinId(event.activeBin, binStep, tokenXDecimals, tokenYDecimals);
    updateBalanceWithEvent(balance, event, newExchangeRate);
}

async function calculateClaimedFees(lbPair: PublicKey, events: Partial<EventInfo>[],
                                    tokenInfo: TokenInfo,
                                    tokenXMint: PublicKey, tokenYMint: PublicKey): Promise<PositionBalanceInfo> {
    const totalClaimedFees = new PositionBalanceInfo([], tokenXMint, tokenYMint);
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

async function updateBalancesWithHistoricalPrices(blockTimesByMint: { [tokenYMint: string]: number[] },
                                                  tokenInfo: TokenInfo) {
    const results: { [tokenYMint: string]: { blockTime: number, price: Decimal }[] } = {};

    for (const [mint, blockTimes] of Object.entries(blockTimesByMint)) {
        if (blockTimes.length === 0) continue;

        const fromBlockTime = blockTimes[0];
        const toBlockTime = blockTimes[blockTimes.length - 1];
        const optimalTimeInterval = determineOptimalTimeInterval(fromBlockTime, toBlockTime);

        const indexedBlockTimes = blockTimes.map(blockTime => ({
            blockTime,
            index: determineIntervalIndex(fromBlockTime, optimalTimeInterval, blockTime)
        }));

        try {
            const historicalPricesYinUSD = await getHistoricalPrice(
                mint,
                'token',
                optimalTimeInterval,
                fromBlockTime,
                toBlockTime
            );
            const historicalPricesSOL = await getHistoricalPrice(
                'So11111111111111111111111111111111111111112',
                'token',
                optimalTimeInterval,
                fromBlockTime,
                toBlockTime
            );

            const SOLPriceMap = new Map<number, number>(
                historicalPricesSOL.data.items.map((item: HistoricalPriceItem) => [item.unixTime, item.value])
            );

            const historicalPricesYinSOL: HistoricalPriceItem[] = historicalPricesYinUSD.data.items.map((item: HistoricalPriceItem) => {
                const SOLPrice = SOLPriceMap.get(item.unixTime);

                if (SOLPrice !== undefined) {
                    return {
                        ...item,
                        value: item.value/SOLPrice
                    };
                }
                return item;
            });

            const maxAvailableIndex = historicalPricesYinSOL.length - 1;
            const pricesForMint: { blockTime: number, price: Decimal }[] = [];

            for (const indexed of indexedBlockTimes) {
                const priceIndex = Math.min(indexed.index, maxAvailableIndex);
                const price = historicalPricesYinSOL[priceIndex];

                if (price) {
                    pricesForMint.push({
                        blockTime: indexed.blockTime,
                        price: new Decimal(price.value)
                    });
                }
            }

            results[mint] = pricesForMint;

        } catch (error) {
            console.error(`Error fetching historical prices for mint ${mint}:`, error);
            console.info('Using current JUP price:', tokenInfo.price);

            // Fallback: use current price for all block times
            results[mint] = blockTimes.map(blockTime => ({
                blockTime,
                price: new Decimal(tokenInfo.price)
            }));
        }
    }

    return results;
}

async function processPositionsWithPrices(positions: [string, PositionLiquidityData][]) {
    const blockTimesByMint = getBlockTimesByTokenYMint(positions);

    for (const [tokenYMintStr, blockTimes] of Object.entries(blockTimesByMint)) {
        const samplePosition = positions.find(([_, pos]) => pos.tokenYMint.toString() === tokenYMintStr)?.[1];
        if (!samplePosition) {
            console.error(`No position found for mint ${tokenYMintStr}`);
            continue;
        }

        const tokenInfo = await fetchTokenPrice(samplePosition.tokenXMint, samplePosition.tokenYMint);

        const pricesByMint = await updateBalancesWithHistoricalPrices(
            { [tokenYMintStr]: blockTimes },
            tokenInfo
        );

        for (const { blockTime, price } of pricesByMint[tokenYMintStr]) {
            const matchingPositions = positions.filter(([_, pos]) =>
                pos.tokenYMint.toString() === tokenYMintStr
            );

            for (const [_, pos] of matchingPositions) {
                const balances = [
                    pos.totalDeposits,
                    pos.totalWithdrawals,
                    pos.totalUnclaimedFees,
                    pos.totalClaimedFees,
                    pos.totalCurrent
                ];

                balances.forEach(balanceInfo => {
                    const matchingBalances = balanceInfo.balances.filter(
                        b => b.blockTime === blockTime
                    );
                    matchingBalances.forEach(b => b.setTokenYSOLPrice(price));
                });
            }
        }
    }
}
