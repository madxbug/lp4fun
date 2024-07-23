// app/position/[[...positionPubKeys]]/PositionStatus.tsx
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {fetchAndParseTransactions, fetchTokenPrice} from '@/app/utils/solana';
import {formatDistanceToNow} from "date-fns";
import {PositionLiquidityData, PositionTransaction} from "@/app/types";
import {prettifyNumber} from "@/app/utils/numberFormatting";
import Decimal from "decimal.js";
import {PublicKey} from '@solana/web3.js';

interface PositionStatusProps {
    positionPubKeys: string[];
}

const getEventColor = (operation: string): string => {
    const colors = {
        'AddLiquidity': 'bg-success bg-opacity-20 border-success text-success-content',
        'RemoveLiquidity': 'bg-error bg-opacity-20 border-error text-error-content',
        'Claim Fee': 'bg-warning bg-opacity-20 border-warning text-warning-content',
        'Position Close': 'bg-neutral bg-opacity-20 border-neutral text-neutral-content',
        'Position Create': 'bg-info bg-opacity-20 border-info text-info-content',
    };
    return colors[operation as keyof typeof colors] || 'bg-base-200 border-base-300 text-base-content';
};

const getEventIcon = (operation: string): string => {
    const icons = {
        'AddLiquidity': '➕',
        'RemoveLiquidity': '➖',
        'Claim Fee': '💰',
        'Position Close': '🔒',
        'Position Create': '🆕',
    };
    return icons[operation as keyof typeof icons] || '❓';
};

const getEventDescription = (tx: PositionTransaction): string => {
    switch (tx.operation) {
        case 'AddLiquidity':
        case 'RemoveLiquidity':
        case 'Claim Fee':
            return `${prettifyNumber(tx.tokenXChange)} ${tx.tokenXSymbol} + ${prettifyNumber(tx.tokenYChange)} ${tx.tokenYSymbol}`;
        case 'Position Close':
        case 'Position Create':
            return '';
        default:
            return 'Unknown operation';
    }
};


const PositionStatus: React.FC<PositionStatusProps> = ({ positionPubKeys }) => {
    const [positionsData, setPositionsData] = useState<{ [key: string]: PositionLiquidityData }>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isPriceLoading, setIsPriceLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState<{ [key: string]: boolean }>({});
    const [showOperations, setShowOperations] = useState<{ [key: string]: boolean }>({});
    const [showPositions, setShowPositions] = useState<{ [key: string]: boolean }>({});
    const [selectedCurrency, setSelectedCurrency] = useState('SOL');
    const [tokenPrices, setTokenPrices] = useState<{ [key: string]: { [key: string]: number } }>({});

    const fetchTransactions = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const newPositionsData = await fetchAndParseTransactions(positionPubKeys);
            setPositionsData(newPositionsData);
        } catch (err) {
            setError('Failed to fetch transactions. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    }, [positionPubKeys]);

    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

    const availableCurrencies = useMemo(() => {
        const baseTokens: Record<string, PublicKey> = {
            'SOL': new PublicKey('So11111111111111111111111111111111111111112'),
            'USDC': new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        };
        const additionalTokens = Object.values(positionsData).reduce((acc, position) => {
            acc[position.tokenXSymbol] = new PublicKey(position.tokenXMint);
            acc[position.tokenYSymbol] = new PublicKey(position.tokenYMint);
            return acc;
        }, {} as Record<string, PublicKey>);
        return {...baseTokens, ...additionalTokens};
    }, [positionsData]);

    const fetchAllTokenPrices = useCallback(async () => {
        setIsPriceLoading(true);
        const currencies = Object.keys(availableCurrencies);
        const newPrices: { [key: string]: { [key: string]: number } } = {};

        for (let i = 0; i < currencies.length; i++) {
            for (let j = 0; j < currencies.length; j++) {
                if (i !== j) {
                    const fromCurrency = currencies[i];
                    const toCurrency = currencies[j];
                    try {
                        const tokenInfo = await fetchTokenPrice(availableCurrencies[fromCurrency], availableCurrencies[toCurrency]);
                        if (!newPrices[fromCurrency]) newPrices[fromCurrency] = {};
                        newPrices[fromCurrency][toCurrency] = tokenInfo.price;
                    } catch (error) {
                        console.error(`Failed to fetch price for ${fromCurrency} to ${toCurrency}:`, error);
                        // Instead of skipping, we'll set a default value or retry
                        if (!newPrices[fromCurrency]) newPrices[fromCurrency] = {};
                        newPrices[fromCurrency][toCurrency] = 1; // Default to 1:1 rate if fetch fails
                    }
                }
            }
        }

        setTokenPrices(newPrices);
        setIsPriceLoading(false);
    }, [availableCurrencies]);

    useEffect(() => {
        if (Object.keys(positionsData).length > 0) {
            fetchAllTokenPrices();
        }
    }, [positionsData, fetchAllTokenPrices]);

    useEffect(() => {
        // Set up an interval to refresh prices every 5 minutes
        const intervalId = setInterval(fetchAllTokenPrices, 5 * 60 * 1000);
        return () => clearInterval(intervalId);
    }, [fetchAllTokenPrices]);

    const convertValue = useCallback((value: Decimal, fromCurrency: string, toCurrency: string): Decimal => {
        if (fromCurrency === toCurrency) return value;
        const rate = tokenPrices[fromCurrency]?.[toCurrency];
        if (rate === undefined) {
            console.warn(`No conversion rate found for ${fromCurrency} to ${toCurrency}`);
            return value; // Return original value if no conversion rate is available
        }
        return value.mul(new Decimal(rate));
    }, [tokenPrices]);

    const calculateMetrics = useCallback((positions: { [key: string]: PositionLiquidityData }, currency?: string) => {
        return Object.values(positions).reduce((acc, position) => {
            const convertedDeposits = currency
                ? convertValue(position.totalDeposits.totalValue, position.tokenYSymbol, currency)
                : position.totalDeposits.totalValue;
            const convertedCurrent = currency
                ? convertValue(
                    position.totalCurrent.totalValue.plus(position.totalUnclaimedFees.totalValue),
                    position.tokenYSymbol,
                    currency
                )
                : position.totalCurrent.totalValue.plus(position.totalUnclaimedFees.totalValue);
            const convertedWithdrawn = currency
                ? convertValue(
                    position.totalWithdrawals.totalValue.plus(position.totalClaimedFees.totalValue),
                    position.tokenYSymbol,
                    currency
                )
                : position.totalWithdrawals.totalValue.plus(position.totalClaimedFees.totalValue);

            acc.totalInvested = acc.totalInvested.plus(convertedDeposits);
            acc.currentValue = acc.currentValue.plus(convertedCurrent);
            acc.totalWithdrawn = acc.totalWithdrawn.plus(convertedWithdrawn);
            acc.startDate = position.startDate && (!acc.startDate || position.startDate < acc.startDate)
                ? position.startDate
                : acc.startDate;
            return acc;
        }, {
            totalInvested: new Decimal(0),
            currentValue: new Decimal(0),
            totalWithdrawn: new Decimal(0),
            startDate: null as Date | null
        });
    }, [convertValue]);

    const renderSummary = (metrics: ReturnType<typeof calculateMetrics>, title: string, currency: string) => (
        <div className="bg-base-100 rounded-lg p-6 shadow-sm mb-8">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-base-content">{title}</h3>
                {title === "Overall Summary" && (
                    <select
                        className="select select-bordered select-sm"
                        value={selectedCurrency}
                        onChange={(e) => setSelectedCurrency(e.target.value)}
                    >
                        {Object.keys(availableCurrencies).map(currencySymbol => (
                            <option key={currencySymbol} value={currencySymbol}>
                                {currencySymbol}
                            </option>
                        ))}
                    </select>
                )}
            </div>
            <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Current Value</p>
                    <p className="text-xl font-medium text-success">{prettifyNumber(metrics.currentValue)} {currency}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Invested</p>
                    <p className="text-xl font-medium text-info">{prettifyNumber(metrics.totalInvested)} {currency}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Total Withdrawn</p>
                    <p className="text-xl font-medium text-warning">{prettifyNumber(metrics.totalWithdrawn)} {currency}</p>
                </div>
            </div>
            <div className="divider my-4 opacity-10"></div>
            <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Net Profit</p>
                    <p className={`text-xl font-medium ${metrics.currentValue.plus(metrics.totalWithdrawn).minus(metrics.totalInvested).gte(0) ? 'text-success' : 'text-error'}`}>
                        {prettifyNumber(metrics.currentValue.plus(metrics.totalWithdrawn).minus(metrics.totalInvested))} {currency}
                    </p>
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">ROI</p>
                    <p className={`text-xl font-medium ${metrics.currentValue.plus(metrics.totalWithdrawn).minus(metrics.totalInvested).div(metrics.totalInvested).mul(100).gte(0) ? 'text-success' : 'text-error'}`}>
                        {prettifyNumber(metrics.currentValue.plus(metrics.totalWithdrawn).minus(metrics.totalInvested).div(metrics.totalInvested).mul(100))}%
                    </p>
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Active Since</p>
                    <p className="text-xl font-medium">
                        {metrics.startDate
                            ? formatDistanceToNow(metrics.startDate, { addSuffix: false, includeSeconds: true })
                            : 'N/A'}
                    </p>
                </div>
            </div>
        </div>
    );

    if (isLoading || isPriceLoading) {
        return <div className="flex justify-center items-center h-screen">
            <span className="loading loading-spinner loading-lg"></span>
        </div>;
    }

    if (error) {
        return (
            <div>
                Error: {error}
                <button onClick={fetchTransactions}>Retry</button>
            </div>
        );
    }

    // Group positions by token pair
    const groupedPositions: {
        [key: string]: { [key: string]: PositionLiquidityData }
    } = Object.entries(positionsData).reduce((acc, [pubKey, data]) => {
        const pairKey = `${data.tokenXSymbol}-${data.tokenYSymbol}`;
        if (!acc[pairKey]) {
            acc[pairKey] = {};
        }
        acc[pairKey][pubKey] = data;
        return acc;
    }, {} as { [key: string]: { [key: string]: PositionLiquidityData } });

    return (
        <div className="p-4 max-w-6xl mx-auto">
            <h1 className="text-3xl font-bold mb-8 text-base-content">Positions Status</h1>
            {/* Overall Summary */}
            {renderSummary(calculateMetrics(positionsData, selectedCurrency), "Overall Summary", selectedCurrency)}

            {Object.entries(groupedPositions).map(([pairKey, positions]) => {
                const groupMetrics = calculateMetrics(positions);
                const [tokenXSymbol, tokenYSymbol] = pairKey.split('-');
                return (
                    <div key={pairKey} className="mb-12 border border-base-200 rounded-lg shadow-sm overflow-hidden">
                        {renderSummary(groupMetrics, `${pairKey}`, tokenYSymbol)}

                        <div className="bg-base-100 px-6">
                            <div className="flex justify-between items-center mb-6">
                                <button
                                    className="btn btn-sm btn-outline"
                                    onClick={() => setShowPositions(prev => ({...prev, [pairKey]: !prev[pairKey]}))}
                                >
                                    {showPositions[pairKey] ? 'Hide Positions' : 'Show Positions'}
                                </button>
                            </div>


                            {/* Individual Positions (Hidden by default) */}
                            {showPositions[pairKey] && (
                                <div className="bg-base-100 border-t border-base-200">
                                    {Object.entries(positions).map(([pubKey, positionData], index) => {

                                        if (!positionData) return null;
                                        const {
                                            transactions,
                                            tokenXSymbol,
                                            tokenYSymbol,
                                            startDate,
                                            totalDeposits,
                                            totalWithdrawals,
                                            totalUnclaimedFees,
                                            totalClaimedFees,
                                            totalCurrent
                                        } = positionData;

                                        const getDaysActive = () => {
                                            if (!startDate) return 'N/A';
                                            return formatDistanceToNow(startDate, {
                                                addSuffix: false,
                                                includeSeconds: true
                                            });
                                        };
                                        const getTotalInvestment = () => prettifyNumber(totalDeposits.totalValue);
                                        const getTotalWithdrawn = () => prettifyNumber(totalWithdrawals.totalValue.plus(totalClaimedFees.totalValue));
                                        const getCurrentValue = () => prettifyNumber(totalCurrent.totalValue.plus(totalUnclaimedFees.totalValue));
                                        const getNetProfit = () => {
                                            const profit = totalCurrent.totalValue.plus(totalUnclaimedFees.totalValue)
                                                .plus(totalWithdrawals.totalValue)
                                                .plus(totalClaimedFees.totalValue)
                                                .minus(totalDeposits.totalValue);
                                            return prettifyNumber(profit);
                                        };
                                        const getROI = () => {
                                            const roi = totalCurrent.totalValue.plus(totalUnclaimedFees.totalValue)
                                                .plus(totalWithdrawals.totalValue)
                                                .plus(totalClaimedFees.totalValue)
                                                .div(totalDeposits.totalValue)
                                                .minus(1)
                                                .mul(100);
                                            return prettifyNumber(roi);
                                        };

                                        return (
                                            <div key={pubKey}
                                                 className="relative p-6 border-b border-base-200 last:border-b-0">
                                                <div
                                                    className="absolute left-0 top-0 bottom-0 w-1 bg-base-300 opacity-50"></div>

                                                <h3 className="text-lg font-semibold mb-4 text-base-content">Position: {pubKey}</h3>

                                                {/* Summary Section */}
                                                <div className="bg-base-100 rounded-lg p-4 shadow-sm mb-4">
                                                    <h4 className="text-base font-medium mb-3 text-base-content">Summary</h4>
                                                    <div className="grid grid-cols-3 gap-4">
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Current
                                                                Value</p>
                                                            <p className="text-xl font-medium text-success">{getCurrentValue()} {tokenYSymbol}</p>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Invested</p>
                                                            <p className="text-xl font-medium text-info">{getTotalInvestment()} {tokenYSymbol}</p>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Total
                                                                Withdrawn</p>
                                                            <p className="text-xl font-medium text-warning">{getTotalWithdrawn()} {tokenYSymbol}</p>
                                                        </div>
                                                    </div>
                                                    <div className="divider my-2 opacity-10"></div>
                                                    <div className="grid grid-cols-3 gap-4">
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Net Profit</p>
                                                            <p className={`text-xl font-medium ${parseFloat(getNetProfit()) >= 0 ? 'text-success' : 'text-error'}`}>
                                                                {getNetProfit()} {tokenYSymbol}
                                                            </p>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">ROI</p>
                                                            <p className={`text-xl font-medium ${parseFloat(getROI()) >= 0 ? 'text-success' : 'text-error'}`}>
                                                                {getROI()}%
                                                            </p>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Active for</p>
                                                            <p className="text-xl font-medium">{getDaysActive()}</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Toggles */}
                                                <div className="flex space-x-4 mb-4">
                                                    <div className="form-control">
                                                        <label className="cursor-pointer label">
                                                            <span className="label-text mr-2">Show Details</span>
                                                            <input
                                                                type="checkbox"
                                                                className="toggle toggle-primary toggle-sm"
                                                                checked={showDetails[pubKey] || false}
                                                                onChange={() => setShowDetails(prev => ({
                                                                    ...prev,
                                                                    [pubKey]: !prev[pubKey]
                                                                }))}
                                                            />
                                                        </label>
                                                    </div>
                                                    <div className="form-control">
                                                        <label className="cursor-pointer label">
                                                            <span className="label-text mr-2">Show Operations</span>
                                                            <input
                                                                type="checkbox"
                                                                className="toggle toggle-secondary toggle-sm"
                                                                checked={showOperations[pubKey] || false}
                                                                onChange={() => setShowOperations(prev => ({
                                                                    ...prev,
                                                                    [pubKey]: !prev[pubKey]
                                                                }))}
                                                            />
                                                        </label>
                                                    </div>
                                                </div>

                                                {/* Detailed Table (Hidden by default) */}
                                                {showDetails[pubKey] && (
                                                    <div className="overflow-x-auto mb-4">
                                                        <table className="table table-zebra w-full">
                                                            <thead>
                                                            <tr>
                                                                <th>Metric</th>
                                                                <th>Investment</th>
                                                                <th colSpan={2} className="text-center">Profit Taken
                                                                </th>
                                                                <th colSpan={2} className="text-center">Current
                                                                    Position
                                                                </th>
                                                            </tr>
                                                            <tr>
                                                                <th></th>
                                                                <th>Deposits</th>
                                                                <th>Withdrawals</th>
                                                                <th>Claimed Fees</th>
                                                                <th>Unclaimed Fees</th>
                                                                <th>Current Value</th>
                                                            </tr>
                                                            </thead>
                                                            <tbody>
                                                            <tr>
                                                                <td>Price ({tokenYSymbol} per {tokenXSymbol})</td>
                                                                <td>{prettifyNumber(totalDeposits.price)}</td>
                                                                <td>{prettifyNumber(totalWithdrawals.price)}</td>
                                                                <td>{prettifyNumber(totalClaimedFees.price)}</td>
                                                                <td>{prettifyNumber(totalUnclaimedFees.price)}</td>
                                                                <td>{prettifyNumber(totalCurrent.price)}</td>
                                                            </tr>
                                                            <tr>
                                                                <td>Amount {tokenXSymbol}</td>
                                                                <td>{prettifyNumber(totalDeposits.tokenX)}</td>
                                                                <td>{prettifyNumber(totalWithdrawals.tokenX)}</td>
                                                                <td>{prettifyNumber(totalClaimedFees.tokenX)}</td>
                                                                <td>{prettifyNumber(totalUnclaimedFees.tokenX)}</td>
                                                                <td>{prettifyNumber(totalCurrent.tokenX)}</td>
                                                            </tr>
                                                            <tr>
                                                                <td>Amount {tokenYSymbol}</td>
                                                                <td>{prettifyNumber(totalDeposits.tokenY)}</td>
                                                                <td>{prettifyNumber(totalWithdrawals.tokenY)}</td>
                                                                <td>{prettifyNumber(totalClaimedFees.tokenY)}</td>
                                                                <td>{prettifyNumber(totalUnclaimedFees.tokenY)}</td>
                                                                <td>{prettifyNumber(totalCurrent.tokenY)}</td>
                                                            </tr>
                                                            <tr>
                                                                <td>Value in {tokenYSymbol}</td>
                                                                <td>{prettifyNumber(totalDeposits.totalValue)}</td>
                                                                <td>{prettifyNumber(totalWithdrawals.totalValue)}</td>
                                                                <td>{prettifyNumber(totalClaimedFees.totalValue)}</td>
                                                                <td>{prettifyNumber(totalUnclaimedFees.totalValue)}</td>
                                                                <td>{prettifyNumber(totalCurrent.totalValue)}</td>
                                                            </tr>
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}

                                                {/* Position Operations (Hidden by default) */}
                                                {showOperations[pubKey] && (
                                                    <div className="mb-4">
                                                        <h3 className="text-base font-semibold mb-3 text-base-content">Position
                                                            Operations</h3>
                                                        <div className="space-y-2">
                                                            {transactions.map((tx, index) => (
                                                                <div key={index}
                                                                     className={`flex items-center p-2 rounded border ${getEventColor(tx.operation)}`}>
                                                                    <a href={`https://solscan.io/tx/${tx.signature}`}
                                                                       className="text-2xl mr-3">
                                                                        <div>{getEventIcon(tx.operation)}</div>
                                                                    </a>
                                                                    <div className="flex-grow">
                                                                        <p className="font-semibold">{tx.operation}</p>
                                                                        <p className="text-sm opacity-70">{getEventDescription(tx)}</p>
                                                                    </div>
                                                                    <div className="text-xs opacity-50">
                                                                        {formatDistanceToNow(new Date(tx.date), {
                                                                            addSuffix: true,
                                                                            includeSeconds: true
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default PositionStatus;
