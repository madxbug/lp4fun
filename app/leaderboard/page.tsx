// app/leaderboard/page.tsx
'use client';

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {formatDistanceToNow} from 'date-fns';
import {fetchPortfolioTotal} from '@/app/utils/meteoraDataAPI';
import {formatCurrency, prettifyNumber} from '@/app/utils/numberFormatting';
import {formatPubKey} from '@/app/utils/formatters';
import {isValidSolanaAddress} from '@/app/utils/validation';

interface WalletGroup {
    id: string;
    name: string;
    wallets: string[];
}

type SortKey = 'usd' | 'sol';

const num = (v: string | number | null | undefined): number => {
    const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
    return Number.isFinite(n) ? n : 0;
};

const PnlCell: React.FC<{ usd: number; sol: number; positions?: number }> = ({usd, sol, positions}) => (
    <div className={`font-semibold ${usd >= 0 ? 'text-success' : 'text-error'}`}>
        {usd >= 0 ? '+' : '-'}{formatCurrency(Math.abs(usd))}
        <span className="text-[10px] opacity-60 font-normal ml-0.5">USD</span>
        <div className="text-xs opacity-70 font-normal">
            {sol >= 0 ? '+' : ''}{prettifyNumber(sol)} SOL
        </div>
        {positions !== undefined && (
            <div className="text-[10px] opacity-50 font-normal">
                {positions.toLocaleString()} position{positions === 1 ? '' : 's'} closed
            </div>
        )}
    </div>
);

const rankBadge = (rank: number): string => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
};

// Column header that toggles ranking between USD and SOL.
const PnlSortHeader: React.FC<{
    label: string;
    sortKey: SortKey;
    onToggle: () => void;
}> = ({label, sortKey, onToggle}) => (
    <button
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-base-content hover:opacity-70"
        title="Rank by USD or by SOL"
    >
        {label}
        <span className="badge badge-ghost badge-xs uppercase">{sortKey}</span>
        <span className="text-[10px]">▼</span>
    </button>
);

// ==================== Global board ====================

type WindowKey = '1d' | '7d' | '30d' | 'all';

const WINDOWS: { key: WindowKey; label: string }[] = [
    {key: '1d', label: '24h'},
    {key: '7d', label: '7 days'},
    {key: '30d', label: '30 days'},
    {key: 'all', label: 'All-time'},
];

interface GlobalWallet {
    wallet: string;
    pnlUsd: number;
    pnlSol: number;
    positions: number;
}

interface GlobalPayload {
    window: WindowKey;
    updatedAt: number;
    scannedPools: number;
    scannedWallets: number;
    protocol: {
        total_tvl: number;
        volume_24h: number;
        fee_24h: number;
        total_pools: number;
    } | null;
    wallets: GlobalWallet[];
}

const GlobalBoard: React.FC = () => {
    const [windowKey, setWindowKey] = useState<WindowKey>('1d');
    const [payloads, setPayloads] = useState<Partial<Record<WindowKey, GlobalPayload>>>({});
    const [loadingWindow, setLoadingWindow] = useState<WindowKey | null>(null);
    const [error, setError] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('usd');

    const load = useCallback(async (w: WindowKey) => {
        setLoadingWindow(w);
        setError('');
        try {
            const res = await fetch(`/api/leaderboard?window=${w}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json: GlobalPayload = await res.json();
            setPayloads(prev => ({...prev, [w]: json}));
        } catch {
            setError('Failed to load the global leaderboard. Please try again.');
        } finally {
            setLoadingWindow(null);
        }
    }, []);

    useEffect(() => {
        if (payloads[windowKey] || loadingWindow || error) return;
        load(windowKey);
    }, [windowKey, payloads, loadingWindow, error, load]);

    const selectWindow = (w: WindowKey) => {
        setError('');
        setWindowKey(w);
    };

    const payload = payloads[windowKey];
    const wallets = useMemo(() => {
        if (!payload) return [];
        return [...payload.wallets].sort((a, b) =>
            sortKey === 'usd' ? b.pnlUsd - a.pnlUsd : b.pnlSol - a.pnlSol);
    }, [payload, sortKey]);

    return (
        <>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="join">
                    {WINDOWS.map(w => (
                        <button
                            key={w.key}
                            onClick={() => selectWindow(w.key)}
                            className={`join-item btn btn-sm ${windowKey === w.key ? 'btn-accent' : 'btn-ghost border-base-300'}`}
                        >
                            {w.label}
                        </button>
                    ))}
                </div>
                {payload && (
                    <span className="text-xs text-base-content/50">
                        {payload.scannedWallets} wallets from {payload.scannedPools} top pools
                        · updated {formatDistanceToNow(new Date(payload.updatedAt), {addSuffix: true})}
                    </span>
                )}
            </div>

            {payload?.protocol && (
                <div className="border border-base-300 rounded-lg bg-base-100 p-4 mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <div className="text-xs text-base-content/60 mb-1">Protocol TVL</div>
                            <div className="font-semibold">{formatCurrency(payload.protocol.total_tvl)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-base-content/60 mb-1">24h Volume</div>
                            <div className="font-semibold">{formatCurrency(payload.protocol.volume_24h)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-base-content/60 mb-1">24h Fees</div>
                            <div className="font-semibold">{formatCurrency(payload.protocol.fee_24h)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-base-content/60 mb-1">Pools</div>
                            <div className="font-semibold">{payload.protocol.total_pools.toLocaleString()}</div>
                        </div>
                    </div>
                </div>
            )}

            {loadingWindow ? (
                <div className="flex flex-col items-center justify-center p-12 gap-3">
                    <span className="loading loading-spinner loading-lg"></span>
                    <span className="text-sm text-base-content/60 text-center">
                        Scanning top pools and scoring wallets —<br/>the first load of a window can take up to a minute.
                    </span>
                </div>
            ) : error ? (
                <div className="border border-base-300 rounded-lg bg-base-100 p-8 text-center">
                    <p className="text-error mb-3">{error}</p>
                    <button className="btn btn-sm btn-outline" onClick={() => load(windowKey)}>Retry</button>
                </div>
            ) : !payload || wallets.length === 0 ? (
                <div className="border border-base-300 rounded-lg bg-base-100 p-8 text-center text-base-content/70">
                    No wallets with realized PnL found for this window.
                </div>
            ) : (
                <div className="border border-base-300 rounded-lg bg-base-100 p-4">
                    <div className="overflow-x-auto">
                        <table className="table table-zebra table-sm w-full">
                            <thead>
                            <tr>
                                <th className="w-12">#</th>
                                <th>Wallet</th>
                                <th className="text-right">
                                    <PnlSortHeader label="Realized PnL" sortKey={sortKey}
                                                   onToggle={() => setSortKey(k => k === 'usd' ? 'sol' : 'usd')}/>
                                </th>
                            </tr>
                            </thead>
                            <tbody>
                            {wallets.map((entry, index) => (
                                <tr key={entry.wallet}>
                                    <td className="text-lg">{rankBadge(index + 1)}</td>
                                    <td>
                                        <Link
                                            href={`/wallet/${entry.wallet}`}
                                            className="font-mono text-xs sm:text-sm hover:underline"
                                            title={entry.wallet}
                                        >
                                            <span className="lg:hidden">{formatPubKey(entry.wallet)}</span>
                                            <span className="hidden lg:inline">{entry.wallet}</span>
                                        </Link>
                                    </td>
                                    <td className="text-right whitespace-nowrap">
                                        <PnlCell usd={entry.pnlUsd} sol={entry.pnlSol} positions={entry.positions}/>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="text-xs text-base-content/50 mt-3">
                        Wallets are discovered from open positions in the top DLMM pools by 24h fees and TVL,
                        then ranked by realized PnL (closed positions) from Meteora data. Wallets that fully
                        exited before the last scan are not discovered.
                    </div>
                </div>
            )}
        </>
    );
};

// ==================== My wallets board ====================

interface LeaderboardEntry {
    wallet: string;
    pnlUsd: number;
    pnlSol: number;
    closedPositions: number;
    isManual: boolean;
}

const MANUAL_WALLETS_KEY = 'leaderboardWallets';
const FETCH_CHUNK_SIZE = 8;

const readJson = <T, >(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : fallback;
    } catch {
        return fallback;
    }
};

// Wallets the user has explored: search history entries (possibly comma-separated) and saved groups.
const readTrackedWallets = (): string[] => {
    const wallets: string[] = [];
    for (const item of readJson<(string | WalletGroup)[]>('walletHistory', [])) {
        if (typeof item === 'string') {
            wallets.push(...item.split(',').map(w => w.trim()));
        } else if (item && Array.isArray(item.wallets)) {
            wallets.push(...item.wallets);
        }
    }
    for (const group of readJson<WalletGroup[]>('walletGroups', [])) {
        if (group && Array.isArray(group.wallets)) {
            wallets.push(...group.wallets);
        }
    }
    return wallets;
};

const readManualWallets = (): string[] => readJson<string[]>(MANUAL_WALLETS_KEY, []);

const saveManualWallets = (wallets: string[]) => {
    localStorage.setItem(MANUAL_WALLETS_KEY, JSON.stringify(wallets));
};

const MyBoard: React.FC = () => {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [progress, setProgress] = useState<{ done: number; total: number }>({done: 0, total: 0});
    const [hiddenCount, setHiddenCount] = useState(0);
    const [sortKey, setSortKey] = useState<SortKey>('usd');
    const [addForm, setAddForm] = useState({value: '', error: '', isAdding: false});

    const fetchEntriesFor = useCallback(async (
        wallets: string[],
        manualSet: Set<string>
    ): Promise<{ entries: LeaderboardEntry[]; hidden: number }> => {
        const result: LeaderboardEntry[] = [];
        let hidden = 0;
        setProgress({done: 0, total: wallets.length});

        for (let i = 0; i < wallets.length; i += FETCH_CHUNK_SIZE) {
            const chunk = wallets.slice(i, i + FETCH_CHUNK_SIZE);
            const totals = await Promise.all(chunk.map(w => fetchPortfolioTotal(w)));
            chunk.forEach((wallet, j) => {
                const total = totals[j];
                const isManual = manualSet.has(wallet);
                if (!total) {
                    if (!isManual) hidden++;
                    else result.push({wallet, pnlUsd: 0, pnlSol: 0, closedPositions: 0, isManual});
                    return;
                }
                const entry: LeaderboardEntry = {
                    wallet,
                    pnlUsd: num(total.totalPnlUsd),
                    pnlSol: num(total.totalPnlSol),
                    closedPositions: total.totalClosedPositions ?? 0,
                    isManual,
                };
                // History can contain token mints and wallets that never LP'd — hide those
                // unless the user added them to the board explicitly.
                const hasActivity = entry.closedPositions > 0 || entry.pnlUsd !== 0 || entry.pnlSol !== 0;
                if (hasActivity || isManual) {
                    result.push(entry);
                } else {
                    hidden++;
                }
            });
            setProgress({done: Math.min(i + FETCH_CHUNK_SIZE, wallets.length), total: wallets.length});
        }
        return {entries: result, hidden};
    }, []);

    const loadBoard = useCallback(async () => {
        setIsLoading(true);
        const manual = readManualWallets();
        const manualSet = new Set(manual);
        const seen = new Set<string>();
        const wallets: string[] = [];

        for (const w of [...manual, ...readTrackedWallets()]) {
            if (!w || seen.has(w) || !(await isValidSolanaAddress(w))) continue;
            seen.add(w);
            wallets.push(w);
        }

        const {entries: loaded, hidden} = await fetchEntriesFor(wallets, manualSet);
        setEntries(loaded);
        setHiddenCount(hidden);
        setIsLoading(false);
    }, [fetchEntriesFor]);

    useEffect(() => {
        loadBoard();
    }, [loadBoard]);

    const addWallet = async () => {
        const wallet = addForm.value.trim();
        if (!wallet) return;

        if (!(await isValidSolanaAddress(wallet))) {
            setAddForm(prev => ({...prev, error: 'Invalid Solana address'}));
            return;
        }
        if (entries.some(e => e.wallet === wallet)) {
            setAddForm(prev => ({...prev, error: 'Already on the board'}));
            return;
        }

        setAddForm(prev => ({...prev, isAdding: true, error: ''}));
        const total = await fetchPortfolioTotal(wallet);
        const manual = readManualWallets();
        if (!manual.includes(wallet)) {
            saveManualWallets([...manual, wallet]);
        }
        setEntries(prev => [...prev, {
            wallet,
            pnlUsd: num(total?.totalPnlUsd),
            pnlSol: num(total?.totalPnlSol),
            closedPositions: total?.totalClosedPositions ?? 0,
            isManual: true,
        }]);
        setAddForm({value: '', error: '', isAdding: false});
    };

    const removeWallet = (wallet: string) => {
        saveManualWallets(readManualWallets().filter(w => w !== wallet));
        setEntries(prev => prev.filter(e => e.wallet !== wallet));
    };

    const sorted = useMemo(() =>
            [...entries].sort((a, b) => sortKey === 'usd' ? b.pnlUsd - a.pnlUsd : b.pnlSol - a.pnlSol),
        [entries, sortKey]);

    return (
        <>
            <div className="mb-4 flex items-center gap-2">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        addWallet();
                    }}
                    className="flex gap-2 flex-grow"
                >
                    <input
                        type="text"
                        value={addForm.value}
                        onChange={(e) => setAddForm(prev => ({...prev, value: e.target.value, error: ''}))}
                        placeholder="Add a wallet to the board"
                        className="input input-bordered input-sm flex-grow"
                        autoComplete="off"
                        disabled={addForm.isAdding}
                    />
                    <button type="submit" className="btn btn-accent btn-sm" disabled={addForm.isAdding}>
                        {addForm.isAdding ? <span className="loading loading-spinner loading-xs"></span> : 'Add'}
                    </button>
                </form>
                <button
                    onClick={loadBoard}
                    className="btn btn-ghost btn-sm"
                    disabled={isLoading}
                    title="Refresh PnL data"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24"
                         stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                </button>
            </div>
            {addForm.error && <p className="text-error text-sm -mt-2 mb-2">{addForm.error}</p>}

            {isLoading ? (
                <div className="flex flex-col items-center justify-center p-12 gap-3">
                    <span className="loading loading-spinner loading-lg"></span>
                    {progress.total > 0 && (
                        <span className="text-sm text-base-content/60">
                            Fetching PnL for {progress.done}/{progress.total} wallets…
                        </span>
                    )}
                </div>
            ) : sorted.length === 0 ? (
                <div className="border border-base-300 rounded-lg bg-base-100 p-8 text-center text-base-content/70">
                    <div className="text-lg font-semibold mb-2">No wallets to rank yet</div>
                    <div className="text-sm">
                        Look up wallets from the <Link href="/" className="link">home page</Link> or add one above —
                        they&apos;ll show up here ranked by earnings.
                    </div>
                </div>
            ) : (
                <div className="border border-base-300 rounded-lg bg-base-100 p-4">
                    <div className="overflow-x-auto">
                        <table className="table table-zebra table-sm w-full">
                            <thead>
                            <tr>
                                <th className="w-12">#</th>
                                <th>Wallet</th>
                                <th className="text-right">
                                    <PnlSortHeader label="All-time PnL" sortKey={sortKey}
                                                   onToggle={() => setSortKey(k => k === 'usd' ? 'sol' : 'usd')}/>
                                </th>
                                <th className="w-8"></th>
                            </tr>
                            </thead>
                            <tbody>
                            {sorted.map((entry, index) => (
                                <tr key={entry.wallet}>
                                    <td className="text-lg">{rankBadge(index + 1)}</td>
                                    <td>
                                        <Link
                                            href={`/wallet/${entry.wallet}`}
                                            className="font-mono text-xs sm:text-sm hover:underline"
                                            title={entry.wallet}
                                        >
                                            <span className="lg:hidden">{formatPubKey(entry.wallet)}</span>
                                            <span className="hidden lg:inline">{entry.wallet}</span>
                                        </Link>
                                    </td>
                                    <td className="text-right whitespace-nowrap">
                                        <PnlCell usd={entry.pnlUsd} sol={entry.pnlSol}
                                                 positions={entry.closedPositions}/>
                                    </td>
                                    <td>
                                        {entry.isManual && (
                                            <button
                                                onClick={() => removeWallet(entry.wallet)}
                                                className="btn btn-ghost btn-xs opacity-40 hover:opacity-100 hover:text-error"
                                                title="Remove from board"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="text-xs text-base-content/50 mt-3">
                        PnL sums flows through Meteora DLMM position accounts (deposits, withdrawals, claimed fees).
                        {hiddenCount > 0 && ` ${hiddenCount} address${hiddenCount === 1 ? '' : 'es'} with no DLMM activity hidden.`}
                    </div>
                </div>
            )}
        </>
    );
};

// ==================== Page ====================

type Tab = 'global' | 'mine';

const LeaderboardPage: React.FC = () => {
    const [tab, setTab] = useState<Tab>('global');

    return (
        <div className="w-full max-w-3xl mx-auto p-4 mb-16 self-start">
            <div className="flex items-center justify-between mb-1">
                <h1 className="text-2xl font-bold">🏆 Wallet Leaderboard</h1>
                <Link href="/" className="btn btn-ghost btn-sm">Home</Link>
            </div>
            <p className="text-sm text-base-content/60 mb-4">
                {tab === 'global'
                    ? 'Top-earning wallets discovered across the busiest Meteora DLMM pools.'
                    : 'Wallets you’ve explored, ranked by all-time Meteora DLMM PnL.'}
            </p>

            <div role="tablist" className="tabs tabs-boxed mb-4 w-fit">
                <button
                    role="tab"
                    onClick={() => setTab('global')}
                    className={`tab ${tab === 'global' ? 'tab-active' : ''}`}
                >
                    Global
                </button>
                <button
                    role="tab"
                    onClick={() => setTab('mine')}
                    className={`tab ${tab === 'mine' ? 'tab-active' : ''}`}
                >
                    My wallets
                </button>
            </div>

            {tab === 'global' ? <GlobalBoard/> : <MyBoard/>}
        </div>
    );
};

export default LeaderboardPage;
