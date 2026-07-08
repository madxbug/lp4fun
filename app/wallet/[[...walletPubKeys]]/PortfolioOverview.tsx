// app/wallet/[[...walletPubKeys]]/PortfolioOverview.tsx
'use client';

import React, {useEffect, useState} from 'react';
import Image from 'next/image';
import {formatDistanceToNow} from 'date-fns';
import {
    fetchLimitOrderSummary,
    fetchPortfolioClosed,
    fetchPortfolioTotal,
    LimitOrderSummary,
    PortfolioClosedPool,
    PortfolioOpen,
    PortfolioTotals,
} from '@/app/utils/meteoraDataAPI';
import {formatCurrency, prettifyNumber} from '@/app/utils/numberFormatting';

interface PortfolioOverviewProps {
    wallet: string;
    portfolio: PortfolioOpen | null;
}

const CLOSED_PAGE_SIZE = 10;
const CLOSED_DAYS_BACK = 365;

const num = (v: string | number | null | undefined): number => {
    const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
    return Number.isFinite(n) ? n : 0;
};

const PnlValue: React.FC<{ usd: number; sol?: number; pct?: number }> = ({usd, sol, pct}) => (
    <div className={`font-semibold ${usd >= 0 ? 'text-success' : 'text-error'}`}>
        {usd >= 0 ? '+' : '-'}{formatCurrency(Math.abs(usd))}
        {pct !== undefined && Number.isFinite(pct) && (
            <span className="text-xs opacity-70"> ({(pct * 100).toFixed(2)}%)</span>
        )}
        {sol !== undefined && (
            <div className="text-xs opacity-70 font-normal">{sol >= 0 ? '+' : ''}{prettifyNumber(sol)} SOL</div>
        )}
    </div>
);

const PortfolioOverview: React.FC<PortfolioOverviewProps> = ({wallet, portfolio}) => {
    const [totals, setTotals] = useState<PortfolioTotals | null>(null);
    const [limitOrders, setLimitOrders] = useState<LimitOrderSummary | null>(null);
    const [closedPools, setClosedPools] = useState<PortfolioClosedPool[]>([]);
    const [closedCount, setClosedCount] = useState(0);
    const [closedPage, setClosedPage] = useState(1);
    const [hasMoreClosed, setHasMoreClosed] = useState(false);
    const [showClosed, setShowClosed] = useState(false);
    const [isLoadingClosed, setIsLoadingClosed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [total, orders] = await Promise.all([
                fetchPortfolioTotal(wallet),
                fetchLimitOrderSummary(wallet),
            ]);
            if (cancelled) return;
            setTotals(total);
            setLimitOrders(orders);
        })();
        return () => {
            cancelled = true;
        };
    }, [wallet]);

    const loadClosed = async (page: number) => {
        setIsLoadingClosed(true);
        const res = await fetchPortfolioClosed(wallet, CLOSED_DAYS_BACK, page, CLOSED_PAGE_SIZE);
        if (res) {
            setClosedPools(prev => page === 1 ? res.pools : [...prev, ...res.pools]);
            setClosedCount(res.totalPositions);
            setHasMoreClosed(res.hasNext);
            setClosedPage(page);
        }
        setIsLoadingClosed(false);
    };

    const toggleClosed = () => {
        const next = !showClosed;
        setShowClosed(next);
        if (next && closedPools.length === 0) {
            loadClosed(1);
        }
    };

    const openTotals = portfolio?.total ?? null;
    const hasLimitOrders = (limitOrders?.open_orders ?? 0) + (limitOrders?.closed_orders ?? 0) > 0;

    return (
        <div className="mb-4">
            {/* Portfolio summary */}
            <div className="border border-base-300 rounded-lg bg-base-100 p-4 mb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <div className="text-xs text-base-content/60 mb-1">Open Value</div>
                        <div className="font-semibold">
                            {formatCurrency(num(openTotals?.balances))}
                            <div className="text-xs opacity-70 font-normal">
                                {prettifyNumber(num(openTotals?.balancesSol))} SOL
                                · {portfolio?.totalPositions ?? 0} position{(portfolio?.totalPositions ?? 0) === 1 ? '' : 's'}
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-base-content/60 mb-1">Unclaimed Fees</div>
                        <div className="font-semibold">
                            {formatCurrency(num(openTotals?.unclaimedFees))}
                            <div className="text-xs opacity-70 font-normal">
                                {prettifyNumber(num(openTotals?.unclaimedFeesSol))} SOL
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-base-content/60 mb-1">Open Positions PnL</div>
                        <PnlValue
                            usd={num(openTotals?.pnl)}
                            sol={num(openTotals?.pnlSol)}
                            pct={num(openTotals?.pnlPctChange)}
                        />
                    </div>
                    <div>
                        <div className="text-xs text-base-content/60 mb-1">All-time PnL</div>
                        {totals ? (
                            <>
                                <PnlValue
                                    usd={num(totals.totalPnlUsd)}
                                    sol={num(totals.totalPnlSol)}
                                    pct={num(totals.totalPnlPctChange)}
                                />
                                <div className="text-xs opacity-50 mt-1">
                                    {totals.totalClosedPositions.toLocaleString()} closed positions
                                </div>
                            </>
                        ) : (
                            <span className="loading loading-dots loading-xs"></span>
                        )}
                    </div>
                </div>
            </div>

            {/* Limit orders summary */}
            {hasLimitOrders && limitOrders && (
                <div className="border border-base-300 rounded-lg bg-base-100 p-4 mb-4">
                    <div className="text-sm font-semibold mb-3">Limit Orders</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <div className="text-xs text-base-content/60 mb-1">Open / Closed</div>
                            <div className="font-semibold">
                                {limitOrders.open_orders.toLocaleString()} / {limitOrders.closed_orders.toLocaleString()}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-base-content/60 mb-1">Open Order Value</div>
                            <div className="font-semibold">{formatCurrency(num(limitOrders.total_current_value_usd))}</div>
                        </div>
                        <div>
                            <div className="text-xs text-base-content/60 mb-1">Bonus Earned</div>
                            <div className="font-semibold">{formatCurrency(num(limitOrders.total_bonus_usd))}</div>
                        </div>
                        <div>
                            <div className="text-xs text-base-content/60 mb-1">Realized PnL</div>
                            <PnlValue usd={num(limitOrders.realized_pnl_usd)} sol={num(limitOrders.realized_pnl_sol)}/>
                        </div>
                    </div>
                </div>
            )}

            {/* Closed positions history */}
            <div className="border border-base-300 rounded-lg bg-base-100 p-4">
                <button className="btn btn-sm btn-outline" onClick={toggleClosed}>
                    {showClosed ? 'Hide' : 'Show'} Closed Positions History
                    {closedCount > 0 && ` (${closedCount.toLocaleString()})`}
                </button>

                {showClosed && (
                    <div className="mt-4">
                        {isLoadingClosed && closedPools.length === 0 ? (
                            <div className="flex justify-center p-4">
                                <span className="loading loading-spinner loading-md"></span>
                            </div>
                        ) : closedPools.length === 0 ? (
                            <div className="text-sm text-base-content/60 italic">
                                No closed positions in the last {CLOSED_DAYS_BACK} days.
                            </div>
                        ) : (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="table table-zebra table-sm w-full text-xs">
                                        <thead>
                                        <tr>
                                            <th>Pool</th>
                                            <th className="text-right">Deposited</th>
                                            <th className="text-right">Withdrawn</th>
                                            <th className="text-right">Fees Earned</th>
                                            <th className="text-right">PnL</th>
                                            <th className="text-right">Last Closed</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {closedPools.map((pool) => (
                                            <tr key={pool.poolAddress}>
                                                <td>
                                                    <a
                                                        href={`https://app.meteora.ag/dlmm/${pool.poolAddress}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-2 hover:underline whitespace-nowrap"
                                                    >
                                                        <span className="flex -space-x-1">
                                                            {pool.tokenXIcon && (
                                                                <Image src={pool.tokenXIcon} alt={pool.tokenX} width={16}
                                                                       height={16}
                                                                       className="w-4 h-4 rounded-full" unoptimized/>
                                                            )}
                                                            {pool.tokenYIcon && (
                                                                <Image src={pool.tokenYIcon} alt={pool.tokenY} width={16}
                                                                       height={16}
                                                                       className="w-4 h-4 rounded-full" unoptimized/>
                                                            )}
                                                        </span>
                                                        <span className="font-medium">{pool.tokenX}-{pool.tokenY}</span>
                                                        <span className="opacity-50">bin {pool.binStep}</span>
                                                    </a>
                                                </td>
                                                <td className="text-right whitespace-nowrap">{formatCurrency(num(pool.totalDeposit))}</td>
                                                <td className="text-right whitespace-nowrap">{formatCurrency(num(pool.totalWithdrawal))}</td>
                                                <td className="text-right whitespace-nowrap">{formatCurrency(num(pool.totalFee))}</td>
                                                <td className="text-right whitespace-nowrap">
                                                    <PnlValue usd={num(pool.pnlUsd)} sol={num(pool.pnlSol)}
                                                              pct={num(pool.pnlPctChange)}/>
                                                </td>
                                                <td className="text-right whitespace-nowrap opacity-70">
                                                    {pool.lastClosedAt
                                                        ? formatDistanceToNow(new Date(pool.lastClosedAt * 1000), {addSuffix: true})
                                                        : 'N/A'}
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>
                                {hasMoreClosed && (
                                    <div className="flex justify-center mt-3">
                                        <button
                                            className="btn btn-sm btn-ghost"
                                            onClick={() => loadClosed(closedPage + 1)}
                                            disabled={isLoadingClosed}
                                        >
                                            {isLoadingClosed
                                                ? <span className="loading loading-spinner loading-xs"></span>
                                                : 'Load more'}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PortfolioOverview;
