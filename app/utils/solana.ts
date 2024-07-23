// app/utils/solana.ts
import {Connection, ParsedTransactionWithMeta, PublicKey} from '@solana/web3.js';
import {AnchorProvider, Program, utils} from "@coral-xyz/anchor";
import DLMM, {IDL, LbClmm, LBCLMM_PROGRAM_IDS} from "@meteora-ag/dlmm";
import {getMint} from "@solana/spl-token";
import {PositionLiquidityData, PositionTransaction, TimeInterval, TokenInfo, TotalLiquidity} from "@/app/types";
import Decimal from "decimal.js";
import {determineIntervalIndex, determineOptimalTimeInterval, getHistoricalPrice} from "@/app/utils/birdeye";

const BASIS_POINT_MAX = 10000;

export function formatTokenBalance(balance: bigint | number | undefined, decimals: number): number {
    if (balance === undefined) {
        return 0;
    }
    return Number(balance) / 10 ** decimals;
}

export async function fetchTokenPrice(tokenX: PublicKey, tokenY: PublicKey): Promise<TokenInfo> {
    const url = `https://price.jup.ag/v6/price?ids=${tokenX}&vsToken=${tokenY}`;
    const response = await fetch(url);
    const data = await response.json();
    const tokenData = data.data[tokenX.toString()];
    return {
        nameX: tokenData.mintSymbol,
        nameY: tokenData.vsTokenSymbol,
        price: tokenData.price,
    };
}

function parseEvent(event: any): Partial<PositionTransaction> {
    const result: Partial<PositionTransaction> = {
        tokenXSymbol: '',
        tokenYSymbol: '',
        activeBin: 0,
    };

    switch (event.name) {
        case 'AddLiquidity':
        case 'RemoveLiquidity':
            const [tokenXAmount, tokenYAmount] = event.data.amounts.map((amount: {
                toNumber: () => number
            }) => amount.toNumber());
            return {
                ...result,
                operation: event.name,
                tokenXChange: tokenXAmount,
                tokenYChange: tokenYAmount,
                activeBin: event.data.activeBinId
            };
        case 'ClaimFee':
            return {
                ...result,
                operation: "Claim Fee",
                tokenXChange: event.data.feeX,
                tokenYChange: event.data.feeY,
            };
        case 'PositionClose':
            return {operation: "Position Close"};
        case 'PositionCreate':
            return {operation: "Position Create"};
        default:
            return {};
    }
}

function parseTransaction(
    program: Program<LbClmm>,
    transaction: ParsedTransactionWithMeta,
    tokenXDigits: number,
    tokenYDigits: number,
    binStep: number,
    currentTotalDeposits: TotalLiquidity,
    currentTotalWithdrawals: TotalLiquidity
): {
    transactions: Omit<PositionTransaction, 'date' | 'signature' | 'tokenXSymbol' | 'tokenYSymbol'>[],
    updatedTotalDeposits: TotalLiquidity,
    updatedTotalWithdrawals: TotalLiquidity
} {
    const results: Omit<PositionTransaction, 'date' | 'signature' | 'tokenXSymbol' | 'tokenYSymbol'>[] = [];
    let totalDeposits = {...currentTotalDeposits};
    let totalWithdrawals = {...currentTotalWithdrawals};

    for (const ix of transaction.meta?.innerInstructions || []) {
        for (const iix of ix.instructions) {
            if (!iix.programId.equals(program.programId) || !("data" in iix)) continue;

            const ixData = utils.bytes.bs58.decode(iix.data);
            const eventData = utils.bytes.base64.encode(ixData.subarray(8));
            let event = program.coder.events.decode(eventData);

            if (!event) continue;

            const parsedEvent = parseEvent(event);
            if (Object.keys(parsedEvent).length > 0) {
                const formattedTokenXChange = formatTokenBalance(parsedEvent.tokenXChange, tokenXDigits) || 0;
                const formattedTokenYChange = formatTokenBalance(parsedEvent.tokenYChange, tokenYDigits) || 0;
                const priceDuringEventTime = getPriceFromBinId(parsedEvent.activeBin || 0, binStep, tokenXDigits, tokenYDigits);

                results.push({
                    operation: parsedEvent.operation || 'Unknown Operation',
                    tokenXChange: formattedTokenXChange,
                    tokenYChange: formattedTokenYChange,
                    activeBin: parsedEvent.activeBin || 0
                });

                const eventValue = new Decimal(formattedTokenXChange).mul(priceDuringEventTime).add(new Decimal(formattedTokenYChange));

                if (parsedEvent.operation === 'AddLiquidity') {
                    totalDeposits = updateTotalLiquidity(totalDeposits, formattedTokenXChange, formattedTokenYChange, priceDuringEventTime, eventValue);
                } else if (parsedEvent.operation === 'RemoveLiquidity') {
                    totalWithdrawals = updateTotalLiquidity(totalWithdrawals, formattedTokenXChange, formattedTokenYChange, priceDuringEventTime, eventValue);
                }
            }
        }
    }

    if (results.length === 0) {
        results.push({
            operation: 'Unknown Operation',
            tokenXChange: 0,
            tokenYChange: 0,
            activeBin: 0
        });
    }

    return {transactions: results, updatedTotalDeposits: totalDeposits, updatedTotalWithdrawals: totalWithdrawals};
}

function updateTotalLiquidity(total: TotalLiquidity, tokenXChange: number, tokenYChange: number, price: Decimal, value: Decimal): TotalLiquidity {
    return {
        tokenX: total.tokenX + tokenXChange,
        tokenY: total.tokenY + tokenYChange,
        price: updateWeightedPrice(total.price, total.totalValue, price, value),
        totalValue: total.totalValue.add(value)
    };
}

function updateWeightedPrice(currentPrice: Decimal, currentTotalValue: Decimal, newPrice: Decimal, newValue: Decimal): Decimal {
    const totalValue = currentTotalValue.add(newValue);
    return currentPrice.mul(currentTotalValue.div(totalValue)).add(newPrice.mul(newValue.div(totalValue)));
}

async function fetchTokenDecimals(connection: Connection, mint: PublicKey): Promise<number> {
    const mintInfo = await getMint(connection, mint);
    return mintInfo.decimals;
}


export async function fetchAndParseTransactions(positionPubKeys: string[]): Promise<{ [key: string]: PositionLiquidityData }> {
    const connection = new Connection("https://nola-trqgof-fast-mainnet.helius-rpc.com");
    const provider = new AnchorProvider(connection, {} as any, AnchorProvider.defaultOptions());
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS["mainnet-beta"], provider);

    const positionsData: { [key: string]: PositionLiquidityData } = {};

    for (const positionPubKey of positionPubKeys) {
        const address = new PublicKey(positionPubKey);
        const {lbPair, owner} = await program.account.positionV2.fetch(address);
        const {activeId, binStep, tokenXMint, tokenYMint} = await program.account.lbPair.fetch(lbPair);

        const tokenXDecimals = await fetchTokenDecimals(connection, tokenXMint);
        const tokenYDecimals = await fetchTokenDecimals(connection, tokenYMint);
        const tokenInfo = await fetchTokenPrice(tokenXMint, tokenYMint);

        interface SignatureInfo {
            signature: string;
            blockTime: number | null;
        }

        let allSignatures: SignatureInfo[] = [];
        let lastSignature: string | undefined;

        const BATCH_SIZE = 1000;

        while (true) {
            const signatureInfos = await connection.getSignaturesForAddress(address, {
                limit: BATCH_SIZE,
                before: lastSignature
            });

            if (signatureInfos.length === 0) break;

            allSignatures = allSignatures.concat(signatureInfos.map(info => ({
                signature: info.signature,
                blockTime: info.blockTime !== undefined ? info.blockTime : null
            })));

            lastSignature = signatureInfos[signatureInfos.length - 1].signature;
        }
        let totalDeposits: TotalLiquidity = {
            tokenX: 0,
            tokenY: 0,
            price: new Decimal(0),
            totalValue: new Decimal(0)
        };
        let totalWithdrawals: TotalLiquidity = {
            tokenX: 0,
            tokenY: 0,
            price: new Decimal(0),
            totalValue: new Decimal(0)
        };

        let allTransactions: PositionTransaction[] = [];

        // Process transactions in batches
        for (let i = allSignatures.length - 1; i >= 0; i -= BATCH_SIZE) {
            const startIndex = Math.max(0, i - BATCH_SIZE + 1);
            const batchSignatures = allSignatures.slice(startIndex, i + 1);
            const transactions = await connection.getParsedTransactions(batchSignatures.map(s => s.signature), {maxSupportedTransactionVersion: 0});

            for (let j = transactions.length - 1; j >= 0; j--) {
                const tx = transactions[j];
                if (tx !== null) {
                    const result = parseTransaction(program, tx, tokenXDecimals, tokenYDecimals, binStep, totalDeposits, totalWithdrawals);

                    const parsedEvents = result.transactions.map(event => ({
                        signature: tx.transaction.signatures[0],
                        date: batchSignatures[j].blockTime ? new Date((batchSignatures[j].blockTime || 0) * 1000) : new Date(),
                        tokenXSymbol: tokenInfo.nameX,
                        tokenYSymbol: tokenInfo.nameY,
                        ...event,
                    })).reverse();

                    allTransactions = parsedEvents.concat(allTransactions);
                    totalDeposits = result.updatedTotalDeposits;
                    totalWithdrawals = result.updatedTotalWithdrawals;
                }
            }
        }

        const dlmm = await DLMM.create(connection, lbPair);
        const {userPositions} = await dlmm.getPositionsByUserAndLbPair(owner);
        const currentPrice = getPriceFromBinId(activeId, binStep, tokenXDecimals, tokenYDecimals);
        const positionInfo = userPositions.find(obj => obj.publicKey.equals(address));
        const tokenX = formatTokenBalance(Number(positionInfo?.positionData.totalXAmount || 0), tokenXDecimals);
        const tokenY = formatTokenBalance(Number(positionInfo?.positionData.totalYAmount || 0), tokenYDecimals);

        let totalCurrent: TotalLiquidity = {
            tokenX: tokenX,
            tokenY: tokenY,
            price: currentPrice,
            totalValue: currentPrice.mul(tokenX).add(tokenY)
        };
        const unclaimedFeesX = formatTokenBalance(Number(positionInfo?.positionData.feeX || 0), tokenXDecimals);
        const unclaimedFeesY = formatTokenBalance(Number(positionInfo?.positionData.feeY || 0), tokenYDecimals);
        let totalUnclaimedFees: TotalLiquidity = {
            tokenX: unclaimedFeesX,
            tokenY: unclaimedFeesY,
            price: currentPrice,
            totalValue: currentPrice.mul(unclaimedFeesX).add(unclaimedFeesY)
        };

        let totalClaimedFees: TotalLiquidity = {
            tokenX: 0,
            tokenY: 0,
            price: new Decimal(0),
            totalValue: new Decimal(0)
        };
        const {claimFeeTransactions, optimalTimeInterval, fromDate, toDate} = processPositionTransactions(allTransactions);
        if (claimFeeTransactions.length > 0 && optimalTimeInterval && fromDate && toDate) {
            const time_from = Math.floor(fromDate.getTime() / 1000);  // FIXME: save blocktime instead of date, and use blocktime directly
            const time_to = Math.floor(toDate.getTime() / 1000);
            const historicalPrices = await getHistoricalPrice(lbPair.toString(), 'pair', optimalTimeInterval, time_from, time_to);
            for (const transaction of claimFeeTransactions) {
                const price = historicalPrices.data.items[transaction.index];
                const value = new Decimal(transaction.tokenXChange).mul(price.value).add(new Decimal(transaction.tokenYChange));

                totalClaimedFees.tokenX += transaction.tokenXChange;
                totalClaimedFees.tokenY += transaction.tokenYChange;
                totalClaimedFees.price = updateWeightedPrice(
                    totalClaimedFees.price,
                    totalClaimedFees.totalValue,
                    new Decimal(price.value),
                    value
                );
                totalClaimedFees.totalValue = totalClaimedFees.totalValue.add(value);
            }
        }

        const startDate = allTransactions.find(tx => tx.operation === 'Position Create')?.date || null;

        positionsData[positionPubKey] = {
            lbPair: lbPair,
            transactions: allTransactions,
            tokenXSymbol: tokenInfo.nameX,
            tokenXMint: tokenXMint,
            tokenYSymbol: tokenInfo.nameY,
            tokenYMint: tokenYMint,
            startDate,
            totalDeposits,
            totalWithdrawals,
            totalUnclaimedFees,
            totalClaimedFees,
            totalCurrent
        };
    }

    return positionsData;
}


export function getPriceFromBinId(binId: number, binStep: number, tokenXDecimal: number, tokenYDecimal: number): Decimal {
    const binStepNum = new Decimal(binStep).div(new Decimal(BASIS_POINT_MAX));
    const base = new Decimal(1).add(binStepNum);
    return base.pow(binId).mul(Math.pow(10, tokenXDecimal - tokenYDecimal));
}

function processPositionTransactions(transactions: PositionTransaction[]): {
    claimFeeTransactions: (PositionTransaction & { index: number })[],
    optimalTimeInterval: TimeInterval | null,
    fromDate: Date | null,
    toDate: Date | null
} {
    const claimFeeTransactions = transactions
        .filter(tx => tx.operation === "Claim Fee")
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (claimFeeTransactions.length === 0) {
        return {
            claimFeeTransactions: [],
            optimalTimeInterval: null,
            fromDate: null,
            toDate: null
        };
    }

    const fromDate = claimFeeTransactions[0].date;
    const toDate = claimFeeTransactions[claimFeeTransactions.length - 1].date;

    const optimalTimeInterval = determineOptimalTimeInterval(fromDate, toDate);

    const indexedClaimFeeTransactions = claimFeeTransactions.map(transaction => ({
        ...transaction,
        index: determineIntervalIndex(fromDate, optimalTimeInterval, transaction.date)
    }));

    return {
        claimFeeTransactions: indexedClaimFeeTransactions,
        optimalTimeInterval,
        fromDate,
        toDate
    };
}
