// app/position/[[...positionPubKeys]]/PositionStatus.tsx
import React, {useCallback, useEffect, useMemo, useState, useRef} from 'react';
import {blockTime2Date} from '@/app/utils/solana';
import {formatDistanceToNow} from "date-fns";
import {EventInfo, EventType, PositionLiquidityData, MetricsType} from "@/app/types";
import {prettifyNumber} from "@/app/utils/numberFormatting";
import {getPositionsInfo} from "@/app/utils/dlmm";
import Decimal from "decimal.js";
import {formatPubKey} from "@/app/utils/formatters";
import {getNoRetryConnection} from "@/app/utils/cachedConnection";


type MetricsResult = {
    totalInvested: Decimal;
    currentValue: Decimal;
    totalWithdrawn: Decimal;
    startDate: Date | null;
};

interface MetricsState {
    overall: MetricsResult | null;
    grouped: Record<string, MetricsResult>;
}

interface PositionStatusProps {
    positionPubKeys: string[];
}

const getEventColor = (operation: string | undefined): string => {
    const colors = {
        'addLiquidity': 'bg-success bg-opacity-20 border-success text-success-content',
        'removeLiquidity': 'bg-error bg-opacity-20 border-error text-error-content',
        'claimFee': 'bg-warning bg-opacity-20 border-warning text-warning-content',
        'positionClose': 'bg-neutral bg-opacity-50 border border-neutral text-neutral-content',
        'positionCreate': 'bg-info bg-opacity-20 border-info text-info-content',
    };
    return colors[operation as keyof typeof colors] || 'bg-base-200 border-base-300 text-base-content';
};

const getEventIcon = (operation: string | undefined): string => {
    const icons = {
        'addLiquidity': '➕',
        'removeLiquidity': '➖',
        'claimFee': '💰',
        'positionClose': '🔒',
        'positionCreate': '🆕',
    };
    return icons[operation as keyof typeof icons] || '❓';
};

const getEventDescription = (eventInfo: Partial<EventInfo> | undefined, tokenXSymbol: string, tokenYSymbol: string): string => {
    if (eventInfo === undefined) {
        return 'Unknown operation';
    }
    switch (eventInfo.operation) {
        case EventType.AddLiquidity:
        case EventType.RemoveLiquidity:
        case EventType.ClaimFee:
            return `${prettifyNumber(eventInfo.tokenXChange)} ${tokenXSymbol} + ${prettifyNumber(eventInfo.tokenYChange)} ${tokenYSymbol}`;
        case EventType.PositionClose:
        case EventType.PositionCreate:
            return '';
        default:
            return 'Unknown operation';
    }
};


const PositionStatus: React.FC<PositionStatusProps> = ({ positionPubKeys }) => {
    const [positionsData, setPositionsData] = useState<{ [key: string]: PositionLiquidityData }>({});
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState<{ [key: string]: boolean }>({});
    const [showOperations, setShowOperations] = useState<{ [key: string]: boolean }>({});
    const [showPositions, setShowPositions] = useState<{ [key: string]: boolean }>({});
    const calculateCallCount = useRef(0);

    const fetchTransactions = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const connection = getNoRetryConnection();
            const newPositionsData = await getPositionsInfo(connection, positionPubKeys);
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


    const calculateMetrics = useCallback((positions: { [key: string]: PositionLiquidityData }) => {
        calculateCallCount.current += 1;
        return Object.values(positions).reduce((acc, position) => {
            const convertedDeposits = position.totalDeposits.getTotalUSDValue();
            const convertedCurrent = position.totalCurrent.getTotalUSDValue().plus(position.totalUnclaimedFees.getTotalUSDValue());
            const convertedWithdrawn = position.totalWithdrawals.getTotalUSDValue().plus(position.totalClaimedFees.getTotalUSDValue());

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
    }, []);

    const groupedPositions = useMemo(() => {
        const sortedPositions = Object.entries(positionsData).sort((a, b) =>
            b[1].lastUpdatedAt.getTime() - a[1].lastUpdatedAt.getTime()
        );

        return sortedPositions.reduce((acc, [pubKey, data]) => {
            const pairKey = `${data.tokenXSymbol}-${data.tokenYSymbol}`;
            if (!acc[pairKey]) {
                acc[pairKey] = {};
            }
            acc[pairKey][pubKey] = data;
            return acc;
        }, {} as { [key: string]: { [key: string]: PositionLiquidityData } });
    }, [positionsData]);

    const getMetricsCalculator = useCallback((
        positionsData: { [key: string]: PositionLiquidityData },
        groupedPositions: { [key: string]: { [key: string]: PositionLiquidityData } },
        isLoading: boolean
    ): MetricsState => {
        if (isLoading || !positionsData || Object.keys(positionsData).length === 0) {
            return { overall: null, grouped: {} };
        }

        return {
            overall: calculateMetrics(positionsData),
            grouped: Object.entries(groupedPositions).reduce((acc, [pairKey, positions]) => {
                acc[pairKey] = calculateMetrics(positions);
                return acc;
            }, {} as Record<string, MetricsResult>)
        };
    }, [calculateMetrics]);

    const allMetrics = useMemo(() =>
            getMetricsCalculator(
                positionsData,
                groupedPositions,
                isLoading
            ),
        [
            positionsData,
            groupedPositions,
            isLoading,
            getMetricsCalculator
        ]
    );


    const renderSummary = (metrics: ReturnType<typeof calculateMetrics>, title: string) => (
        <div className="bg-base-100 rounded-lg p-6 shadow-sm mb-8">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-base-content">{title}</h3>
                {title === "Overall Summary"}
            </div>
            <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Current Value</p>
                    <p className="text-xl font-medium text-success">{prettifyNumber(metrics.currentValue)} USD</p>
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Invested</p>
                    <p className="text-xl font-medium text-info">{prettifyNumber(metrics.totalInvested)} USD</p>
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Total Withdrawn</p>
                    <p className="text-xl font-medium text-warning">{prettifyNumber(metrics.totalWithdrawn)} USD</p>
                </div>
            </div>
            <div className="divider my-4 opacity-10"></div>
            <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                    <p className="text-sm text-base-content/70">Net Profit</p>
                    <p className={`text-xl font-medium ${metrics.currentValue.plus(metrics.totalWithdrawn).minus(metrics.totalInvested).gte(0) ? 'text-success' : 'text-error'}`}>
                        {prettifyNumber(metrics.currentValue.plus(metrics.totalWithdrawn).minus(metrics.totalInvested))} USD
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

    if (isLoading || !positionsData || Object.keys(positionsData).length === 0) {
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

    return (
        <div className="p-4 max-w-6xl mx-auto">
            <h1 className="text-3xl font-bold mb-8 text-base-content">Positions Status</h1>
            {/* Overall Summary */}
            {allMetrics.overall && renderSummary(allMetrics.overall, "Overall Summary")}

            {Object.entries(groupedPositions).map(([pairKey, positions]) => {
                const groupMetrics = allMetrics.grouped[pairKey] || {} as MetricsType;
                return (
                    <div key={pairKey} className="mb-12 border border-base-200 rounded-lg shadow-sm overflow-hidden">
                        {renderSummary(groupMetrics, `${pairKey}`)}

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
                                    {Object.entries(positions).map(([pubKey, positionData]) => {

                                        if (!positionData) return null;
                                        const {
                                            owner,
                                            operations,
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
// Update these calculation functions:
                                        const getTotalInvestment = () => prettifyNumber(totalDeposits.getTotalUSDValue());
                                        const getTotalWithdrawn = () => prettifyNumber(totalWithdrawals.getTotalUSDValue().plus(totalClaimedFees.getTotalUSDValue()));
                                        const getCurrentValue = () => prettifyNumber(totalCurrent.getTotalUSDValue().plus(totalUnclaimedFees.getTotalUSDValue()));
                                        const getNetProfit = () => {
                                            const profit = totalCurrent.getTotalUSDValue()
                                                .plus(totalUnclaimedFees.getTotalUSDValue())
                                                .plus(totalWithdrawals.getTotalUSDValue())
                                                .plus(totalClaimedFees.getTotalUSDValue())
                                                .minus(totalDeposits.getTotalUSDValue());
                                            return prettifyNumber(profit);
                                        };
                                        const getROI = () => {
                                            const invested = totalDeposits.getTotalUSDValue();
                                            if (invested.isZero()) return '0';

                                            const roi = totalCurrent.getTotalUSDValue()
                                                .plus(totalUnclaimedFees.getTotalUSDValue())
                                                .plus(totalWithdrawals.getTotalUSDValue())
                                                .plus(totalClaimedFees.getTotalUSDValue())
                                                .div(invested)
                                                .minus(1)
                                                .mul(100);
                                            return prettifyNumber(roi);
                                        };

                                        return (
                                            <div key={pubKey}
                                                 className="relative p-6 border-b border-base-200 last:border-b-0">
                                                <div
                                                    className="absolute left-0 top-0 bottom-0 w-1 bg-base-300 opacity-50"></div>

                                                <h3 className="text-lg font-semibold mb-6 text-base-content">
                                                    <div
                                                        className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
                                                        <div className="flex items-center space-x-2">
                                                            <span className="text-base-content/70">Position:</span>
                                                            <a
                                                                href={`https://solscan.io/account/${pubKey}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="font-mono hover:underline"
                                                            >
                                                                {formatPubKey(pubKey)}
                                                            </a>
                                                        </div>
                                                        <div
                                                            className="hidden sm:block w-px h-6 bg-base-content/20"></div>
                                                        <div className="flex items-center space-x-2">
                                                            <span className="text-base-content/70">Wallet:</span>
                                                            <a
                                                                href={`https://solscan.io/account/${owner}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="font-mono hover:underline"
                                                            >
                                                                {formatPubKey(owner)}
                                                            </a>
                                                        </div>
                                                    </div>
                                                </h3>
                                                {/* Summary Section */}
                                                <div className="bg-base-100 rounded-lg p-4 shadow-sm mb-4">
                                                    <h4 className="text-base font-medium mb-3 text-base-content">Summary</h4>
                                                    <div className="grid grid-cols-3 gap-4">
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Current
                                                                Value</p>
                                                            <p className="text-xl font-medium text-success">{getCurrentValue()} USD</p>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Invested</p>
                                                            <p className="text-xl font-medium text-info">{getTotalInvestment()} USD</p>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Total
                                                                Withdrawn</p>
                                                            <p className="text-xl font-medium text-warning">{getTotalWithdrawn()} USD</p>
                                                        </div>
                                                    </div>
                                                    <div className="divider my-2 opacity-10"></div>
                                                    <div className="grid grid-cols-3 gap-4">
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-base-content/70">Net Profit</p>
                                                            <p className={`text-xl font-medium ${parseFloat(getNetProfit()) >= 0 ? 'text-success' : 'text-error'}`}>
                                                                {getNetProfit()} USD
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

                                                {showDetails[pubKey] && (
                                                    <div className="overflow-x-auto mb-4">
                                                        <table className="table table-zebra w-full">
                                                            <thead>
                                                            <tr>
                                                                <th>Metric</th>
                                                                <th>Investment</th>
                                                                <th colSpan={2} className="text-center">Profit Taken</th>
                                                                <th colSpan={2} className="text-center">Current Position</th>
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
                                                                <td>USD Value</td>
                                                                <td>${prettifyNumber(totalDeposits.getTotalUSDValue())}</td>
                                                                <td>${prettifyNumber(totalWithdrawals.getTotalUSDValue())}</td>
                                                                <td>${prettifyNumber(totalClaimedFees.getTotalUSDValue())}</td>
                                                                <td>${prettifyNumber(totalUnclaimedFees.getTotalUSDValue())}</td>
                                                                <td>${prettifyNumber(totalCurrent.getTotalUSDValue())}</td>
                                                            </tr>
                                                            <tr>
                                                                <td>Amount {tokenXSymbol}</td>
                                                                <td>{prettifyNumber(totalDeposits.getTotalTokenXBalance())}</td>
                                                                <td>{prettifyNumber(totalWithdrawals.getTotalTokenXBalance())}</td>
                                                                <td>{prettifyNumber(totalClaimedFees.getTotalTokenXBalance())}</td>
                                                                <td>{prettifyNumber(totalUnclaimedFees.getTotalTokenXBalance())}</td>
                                                                <td>{prettifyNumber(totalCurrent.getTotalTokenXBalance())}</td>
                                                            </tr>
                                                            <tr>
                                                                <td>Amount {tokenYSymbol}</td>
                                                                <td>{prettifyNumber(totalDeposits.getTotalTokenYBalance())}</td>
                                                                <td>{prettifyNumber(totalWithdrawals.getTotalTokenYBalance())}</td>
                                                                <td>{prettifyNumber(totalClaimedFees.getTotalTokenYBalance())}</td>
                                                                <td>{prettifyNumber(totalUnclaimedFees.getTotalTokenYBalance())}</td>
                                                                <td>{prettifyNumber(totalCurrent.getTotalTokenYBalance())}</td>
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
                                                            {operations.slice().reverse().map((event, index) => (
                                                                <div key={index}
                                                                     className={`flex items-center p-2 rounded border ${getEventColor(event.operation)}`}>
                                                                    <a href={`https://solscan.io/tx/${event.signature}`}
                                                                       className="text-2xl mr-3"
                                                                       target="_blank"
                                                                       rel="noopener noreferrer">
                                                                        <div>{getEventIcon(event.operation)}</div>
                                                                    </a>
                                                                    <div className="flex-grow">
                                                                        <p className="font-semibold">{event.operation}</p>
                                                                        <p className="text-sm opacity-70">{getEventDescription(event, tokenXSymbol, tokenYSymbol)}</p>
                                                                    </div>
                                                                    <div className="text-xs opacity-50">
                                                                        {formatDistanceToNow(blockTime2Date(event.blockTime), {
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
