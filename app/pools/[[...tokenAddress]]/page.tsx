'use client';

import React, {useEffect, useMemo, useState} from 'react';
import {useParams} from 'next/navigation';
import Image from 'next/image';
import {PublicKey} from '@solana/web3.js';
import {getDefaultConnection} from '@/app/utils/cachedConnection';
import {getTokenMetadata} from '@/app/utils/tokenMetadata';
import {formatCurrency, prettifyNumber} from '@/app/utils/numberFormatting';
import {CompactTrendBars} from "@/app/components/Trend";
import {calculateLiquidityDistribution} from '@/app/utils/liquidity';
import {fetchTokenAssets, TokenAsset} from "@/app/utils/jup";

interface TimeWindowData {
    '30m': number;
    '1h': number;
    '2h': number;
    '4h': number;
    '12h': number;
    '24h': number;
}

type PoolProtocol = 'DLMM' | 'DAMM v2';

interface PoolInfo {
    address: string;
    name: string;
    protocol: PoolProtocol;
    mint_x: string;
    mint_y: string;
    token_x_amount: number;
    token_y_amount: number;
    bin_step: number;
    base_fee_percentage: string;
    liquidity: string;
    fees_24h: number;
    trade_volume_24h: number;
    current_price: number;
    apr: number;
    apy: number;
    fees: TimeWindowData;
    fee_tvl_ratio: TimeWindowData;
    volume: TimeWindowData;
    is_verified: boolean;
}

const EMPTY_WINDOW: TimeWindowData = {'30m': 0, '1h': 0, '2h': 0, '4h': 0, '12h': 0, '24h': 0};

const PROTOCOL_API_BASE: Record<PoolProtocol, string> = {
    'DLMM': 'https://dlmm.datapi.meteora.ag',
    'DAMM v2': 'https://damm-v2.datapi.meteora.ag',
};

const poolAppUrl = (pool: PoolInfo): string =>
    pool.protocol === 'DLMM'
        ? `https://app.meteora.ag/dlmm/${pool.address}`
        : `https://app.meteora.ag/dammv2/${pool.address}`;

// Maps a pool object from the Meteora data APIs (DLMM and DAMM v2 share this shape) to PoolInfo
const mapApiPool = (raw: any, protocol: PoolProtocol): PoolInfo => ({
    address: raw.address,
    name: raw.name,
    protocol,
    mint_x: raw.token_x?.address ?? '',
    mint_y: raw.token_y?.address ?? '',
    token_x_amount: raw.token_x_amount ?? 0,
    token_y_amount: raw.token_y_amount ?? 0,
    bin_step: raw.pool_config?.bin_step ?? 0,
    base_fee_percentage: String(raw.pool_config?.base_fee_pct ?? 0),
    liquidity: String(raw.tvl ?? 0),
    fees_24h: raw.fees?.['24h'] ?? 0,
    trade_volume_24h: raw.volume?.['24h'] ?? 0,
    current_price: raw.current_price ?? 0,
    apr: raw.apr ?? 0,
    apy: raw.apy ?? 0,
    fees: raw.fees ?? EMPTY_WINDOW,
    fee_tvl_ratio: raw.fee_tvl_ratio ?? EMPTY_WINDOW,
    volume: raw.volume ?? EMPTY_WINDOW,
    is_verified: Boolean(raw.token_x?.is_verified && raw.token_y?.is_verified),
});

const fetchProtocolPools = async (protocol: PoolProtocol, tokenAddress: string): Promise<PoolInfo[]> => {
    const pools: PoolInfo[] = [];
    const limit = 100;
    let page = 1;

    while (page <= 10) {
        const response = await fetch(
            `${PROTOCOL_API_BASE[protocol]}/pools?query=${tokenAddress}&page=${page}&page_size=${limit}`
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch ${protocol} pools`);
        }
        const data = await response.json();
        const pagePools = Array.isArray(data.data) ? data.data : [];
        if (pagePools.length === 0) break;
        pools.push(...pagePools.map((raw: any) => mapApiPool(raw, protocol)));
        if (pagePools.length < limit || page >= (data.pages ?? page)) break;
        page++;
    }
    return pools;
};

function getDailyYield(pool: PoolInfo): number {
    const liquidity = parseFloat(pool.liquidity);
    return liquidity > 0 ? pool.fees_24h / liquidity : 0;
}

type SortKey = 'name' | 'liquidity' | 'fees_24h' | 'trade_volume_24h' | 'apr' | 'apy' | 'daily_yield';
type SortDirection = 'asc' | 'desc';

const PoolPage: React.FC = () => {
    const params = useParams();
    const [tokenAddress, setTokenAddress] = useState<string>('');
    const [tokenInfo, setTokenInfo] = useState<any>(null);
    const [pools, setPools] = useState<PoolInfo[]>([]);
    const [tokenAssets, setTokenAssets] = useState<Map<string, TokenAsset>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('liquidity');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [hideZeroVolume, setHideZeroVolume] = useState(true);
    const [hideLowLiquidity, setHideLowLiquidity] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [protocolFilter, setProtocolFilter] = useState<'all' | PoolProtocol>('all');

    useEffect(() => {
        if (params.tokenAddress) {
            const address = typeof params.tokenAddress === 'string'
                ? params.tokenAddress
                : params.tokenAddress[0];
            setTokenAddress(decodeURIComponent(address));
        }
    }, [params]);

    useEffect(() => {
        let cancelled = false;

        const fetchAllPools = async () => {
            if (!tokenAddress) return;

            setIsLoading(true);
            setError(null);

            try {
                const connection = getDefaultConnection();
                const tokenPubKey = new PublicKey(tokenAddress);

                const metadata = await getTokenMetadata(connection, tokenPubKey);
                if (cancelled) return;
                setTokenInfo(metadata);

                const [dlmmPools, dammPools] = await Promise.all([
                    fetchProtocolPools('DLMM', tokenAddress),
                    fetchProtocolPools('DAMM v2', tokenAddress).catch(err => {
                        console.error('DAMM v2 pools unavailable:', err);
                        return [] as PoolInfo[];
                    }),
                ]);
                const allPools = [...dlmmPools, ...dammPools];

                if (cancelled) return;
                setPools(allPools);

                // Fetch token assets for all unique tokens in pools
                const uniqueTokens = new Set<string>();
                allPools.forEach(pool => {
                    uniqueTokens.add(pool.mint_x);
                    uniqueTokens.add(pool.mint_y);
                });

                const tokenPublicKeys = Array.from(uniqueTokens).map(addr => new PublicKey(addr));
                const assets = await fetchTokenAssets(tokenPublicKeys);

                if (cancelled) return;

                // Create map for quick lookup
                const assetsMap = new Map<string, TokenAsset>();
                assets.forEach(asset => {
                    assetsMap.set(asset.id, asset);
                });
                setTokenAssets(assetsMap);

            } catch (err) {
                if (!cancelled) {
                    console.error('Error fetching token/pools:', err);
                    setError('Failed to load token information and pools');
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        fetchAllPools();

        return () => {
            cancelled = true;
        };
    }, [tokenAddress]);

    const sortedPools = useMemo(() => {
        let filtered = pools;

        if (protocolFilter !== 'all') {
            filtered = filtered.filter(pool => pool.protocol === protocolFilter);
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            filtered = filtered.filter(pool =>
                pool.name.toLowerCase().includes(query)
            );
        }

        if (hideZeroVolume) {
            filtered = filtered.filter(pool => pool.trade_volume_24h > 0);
        }

        if (hideLowLiquidity) {
            filtered = filtered.filter(pool => parseFloat(pool.liquidity) >= 1000);
        }

        return [...filtered].sort((a, b) => {
            let aVal: number, bVal: number;

            switch (sortKey) {
                case 'name':
                    return sortDirection === 'asc'
                        ? a.name.localeCompare(b.name)
                        : b.name.localeCompare(a.name);
                case 'liquidity':
                    aVal = parseFloat(a.liquidity);
                    bVal = parseFloat(b.liquidity);
                    break;
                case 'fees_24h':
                    aVal = a.fees_24h;
                    bVal = b.fees_24h;
                    break;
                case 'trade_volume_24h':
                    aVal = a.trade_volume_24h;
                    bVal = b.trade_volume_24h;
                    break;
                case 'apr':
                    aVal = a.apr;
                    bVal = b.apr;
                    break;
                case 'apy':
                    aVal = a.apy;
                    bVal = b.apy;
                    break;
                case 'daily_yield':
                    aVal = getDailyYield(a);
                    bVal = getDailyYield(b);
                    break;
                default:
                    return 0;
            }

            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }, [pools, sortKey, sortDirection, hideZeroVolume, hideLowLiquidity, searchQuery, protocolFilter]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDirection('desc');
        }
    };

    const SortIcon: React.FC<{ column: SortKey }> = ({column}) => {
        if (sortKey !== column) {
            return <span className="opacity-30">↕</span>;
        }
        return sortDirection === 'asc' ? <span>↑</span> : <span>↓</span>;
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mx-auto p-4">
                <div className="alert alert-error">
                    <span>{error}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-2 sm:p-4">
            {/* Header */}
            <div className="bg-base-100 rounded-lg p-4 sm:p-6 shadow-sm mb-4 sm:mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        {tokenAssets.get(tokenAddress)?.icon && (
                            <Image
                                src={tokenAssets.get(tokenAddress)!.icon}
                                alt={tokenInfo?.symbol || 'Token'}
                                width={48}
                                height={48}
                                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-base-300"
                                unoptimized
                            />
                        )}

                        <div>
                            <a
                                href={`https://solscan.io/token/${tokenAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xl sm:text-3xl font-bold text-base-content hover:text-primary transition-colors"
                            >
                                {tokenInfo?.name || 'Token'} ({tokenInfo?.symbol || 'UNKNOWN'})
                            </a>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                        <div className="join">
                            {(['all', 'DLMM', 'DAMM v2'] as const).map(p => (
                                <button
                                    key={p}
                                    className={`join-item btn btn-xs sm:btn-sm ${protocolFilter === p ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setProtocolFilter(p)}
                                >
                                    {p === 'all' ? 'All' : p}
                                </button>
                            ))}
                        </div>
                        <label className="label cursor-pointer gap-2">
                            <input
                                type="checkbox"
                                className="toggle toggle-success toggle-xs sm:toggle-sm"
                                checked={hideZeroVolume}
                                onChange={(e) => setHideZeroVolume(e.target.checked)}
                            />
                            <span className="label-text text-xs sm:text-sm whitespace-nowrap">Hide 0-volume</span>
                        </label>

                        <label className="label cursor-pointer gap-2">
                            <input
                                type="checkbox"
                                className="toggle toggle-success toggle-xs sm:toggle-sm"
                                checked={hideLowLiquidity}
                                onChange={(e) => setHideLowLiquidity(e.target.checked)}
                            />
                            <span className="label-text text-xs sm:text-sm whitespace-nowrap">Hide low-liquidity</span>
                        </label>
                    </div>
                </div>
            </div>

            {/* Token Asset Data - Table View */}
            {tokenAssets.get(tokenAddress) && (() => {
                const asset = tokenAssets.get(tokenAddress)!;
                interface Timeframe {
                    label: string;
                    mobileLabel: string;
                    stats: NonNullable<typeof asset.stats5m>;
                }

                const rawTimeframes = [
                    { label: "5m", mobileLabel: "5 Minutes", stats: asset.stats5m },
                    { label: "1h", mobileLabel: "1 Hour", stats: asset.stats1h },
                    { label: "6h", mobileLabel: "6 Hours", stats: asset.stats6h },
                    { label: "24h", mobileLabel: "24 Hours", stats: asset.stats24h },
                ];

                // Filter out undefined stats and assert type
                const timeframes: Timeframe[] = rawTimeframes.filter(
                    (t): t is Timeframe => t.stats !== undefined
                );

                const SignPct = ({ v }: { v?: number }) => {
                    const val = v ?? 0;
                    const cls = val >= 0 ? "text-success" : "text-error";
                    const s = `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;
                    return <span className={`font-bold ${cls}`}>{s}</span>;
                };

                const BuySell = ({ buy, sell, className = "" }: { buy?: number; sell?: number; className?: string }) => (
                    <div className={`font-bold text-xs ${className}`}>
                        <span className="text-success">{formatCurrency(buy ?? 0)}</span>
                        <span className="mx-1 text-base-content/40">/</span>
                        <span className="text-error">{formatCurrency(sell ?? 0)}</span>
                    </div>
                );

                return (
                    <div className="bg-base-100 rounded-lg shadow-sm p-3 sm:p-4 mb-4">
                        {/* Top Row: Price, Liquidity, MCap (FDV), Holders, Organic Score */}
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 mb-4 pb-3 border-b border-base-300">
                            <div>
                                <div className="text-xs text-base-content/50 mb-1">Price</div>
                                <div className="font-bold text-base sm:text-lg">${prettifyNumber(asset.usdPrice)}</div>
                            </div>
                            <div>
                                <div className="text-xs text-base-content/50 mb-1">Liquidity</div>
                                <div className="font-bold text-base sm:text-lg">{formatCurrency(asset.liquidity)}</div>
                            </div>
                            <div>
                                <div className="text-xs text-base-content/50 mb-1">MCap (FDV)</div>
                                <div className="font-bold text-base sm:text-lg">
                                    {formatCurrency(asset.mcap)}{" "}
                                    <span className="text-xs text-base-content/50">({formatCurrency(asset.fdv)})</span>
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-base-content/50 mb-1">Holders</div>
                                <div className="font-bold text-base sm:text-lg">{asset.holderCount.toLocaleString()}</div>
                            </div>
                            <div>
                                <div className="text-xs text-base-content/50 mb-1">Organic</div>
                                <div className="font-bold text-base sm:text-lg flex items-center gap-1">
                                    {prettifyNumber(asset.organicScore)}
                                    <span
                                        className={`badge badge-xs ${
                                            asset.organicScoreLabel === "high"
                                                ? "badge-success"
                                                : asset.organicScoreLabel === "medium"
                                                    ? "badge-warning"
                                                    : "badge-error"
                                        }`}
                                    >
              {asset.organicScoreLabel}
            </span>
                                </div>
                            </div>
                        </div>

                        {/* Stats Table - Desktop */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="table table-sm w-full">
                                <thead>
                                <tr className="text-xs">
                                    <th className="font-bold">Time</th>
                                    <th className="font-bold text-right">Price</th>
                                    <th className="font-bold text-right">Holders</th>
                                    <th className="font-bold text-right">Liq</th>
                                    <th className="font-bold text-right">Vol</th>
                                    <th className="font-bold text-right">Buy / Sell</th>
                                    <th className="font-bold text-right">Organic Buy / Sell</th>
                                </tr>
                                </thead>
                                <tbody>
                                {timeframes.map(({ label, stats }) => (
                                    <tr key={label} className="text-xs hover:bg-base-200">
                                        <td className="font-bold">{label}</td>
                                        <td className="text-right"><SignPct v={stats.priceChange} /></td>
                                        <td className="text-right"><SignPct v={stats.holderChange} /></td>
                                        <td className="text-right"><SignPct v={stats.liquidityChange} /></td>
                                        <td className="text-right"><SignPct v={stats.volumeChange} /></td>
                                        <td className="text-right">
                                            <BuySell buy={stats.buyVolume} sell={stats.sellVolume} />
                                        </td>
                                        <td className="text-right">
                                            <BuySell buy={stats.buyOrganicVolume} sell={stats.sellOrganicVolume} />
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Stats Cards - Mobile */}
                        <div className="md:hidden space-y-3">
                            {timeframes.map(({ mobileLabel, stats, label }) => (
                                <div key={label} className="bg-base-200 rounded-lg p-3">
                                    <div className="font-bold text-sm mb-2">{mobileLabel}</div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div>
                                            <span className="text-base-content/60">Price:</span>{" "}
                                            <span className="ml-1"><SignPct v={stats.priceChange} /></span>
                                        </div>
                                        <div>
                                            <span className="text-base-content/60">Holders:</span>{" "}
                                            <span className="ml-1"><SignPct v={stats.holderChange} /></span>
                                        </div>
                                        <div>
                                            <span className="text-base-content/60">Liq:</span>{" "}
                                            <span className="ml-1"><SignPct v={stats.liquidityChange} /></span>
                                        </div>
                                        <div>
                                            <span className="text-base-content/60">Vol:</span>{" "}
                                            <span className="ml-1"><SignPct v={stats.volumeChange} /></span>
                                        </div>

                                        <div className="col-span-2">
                                            <div className="text-base-content/60 mb-1">Buy / Sell:</div>
                                            <BuySell buy={stats.buyVolume} sell={stats.sellVolume} className="text-sm" />
                                        </div>

                                        <div className="col-span-2">
                                            <div className="text-base-content/60 mb-1">Organic Buy / Sell:</div>
                                            <BuySell buy={stats.buyOrganicVolume} sell={stats.sellOrganicVolume} className="text-sm" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })()}

            {pools.length === 0 ? (
                <div className="bg-base-100 rounded-lg p-8 text-center">
                    <p className="text-base-content/70">No Meteora pools found for this token</p>
                    <a
                        href="https://app.meteora.ag/dlmm"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary mt-4"
                    >
                        Create a Pool on Meteora
                    </a>
                </div>
            ) : (
                <>
                    {/* Desktop Table View */}
                    <div className="hidden lg:block overflow-x-auto bg-base-100 rounded-lg shadow-sm">
                        <table className="table table-zebra w-full text-sm">
                            <thead>
                            <tr className="bg-base-200">
                                <th className="hover:bg-base-300 transition-colors">
                                    <input
                                        type="text"
                                        placeholder="Search..."
                                        className="input input-bordered input-xs w-full"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </th>
                                <th
                                    className="cursor-pointer hover:bg-base-300 transition-colors text-right"
                                    onClick={() => handleSort('liquidity')}
                                >
                                    Liquidity <SortIcon column="liquidity"/>
                                </th>
                                <th className="text-center">Liquidity Distribution</th>
                                <th
                                    className="cursor-pointer hover:bg-base-300 transition-colors text-right"
                                    onClick={() => handleSort('trade_volume_24h')}
                                >
                                    24h Volume <SortIcon column="trade_volume_24h"/>
                                </th>
                                <th
                                    className="cursor-pointer hover:bg-base-300 transition-colors text-right"
                                    onClick={() => handleSort('fees_24h')}
                                >
                                    24h Fees <SortIcon column="fees_24h"/>
                                </th>
                                <th className="text-center">Fee Yield Trend</th>
                                <th
                                    className="cursor-pointer hover:bg-base-300 transition-colors text-right"
                                    onClick={() => handleSort('daily_yield')}
                                >
                                    Daily Yield <SortIcon column="daily_yield"/>
                                </th>
                            </tr>
                            </thead>
                            <tbody>
                            {sortedPools.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-8">
                                        <div className="text-base-content/70">
                                            No pools match {searchQuery}
                                        </div>
                                        <button
                                            className="btn btn-sm btn-ghost mt-2"
                                            onClick={() => setSearchQuery('')}
                                        >
                                            Clear filter
                                        </button>
                                    </td>
                                </tr>
                            ) : (
                                sortedPools.map((pool) => {
                                    const assetX = tokenAssets.get(pool.mint_x);
                                    const assetY = tokenAssets.get(pool.mint_y);

                                    const {percentX, percentY} = calculateLiquidityDistribution(
                                        pool.token_x_amount,
                                        pool.token_y_amount,
                                        pool.current_price
                                    );

                                    const tokens = pool.name.split('-').map(t => t.trim());
                                    const tokenX = tokens[0] || 'X';
                                    const tokenY = tokens[1] || 'Y';

                                    const maxTokenLength = Math.max(tokenX.length, tokenY.length);
                                    const minWidth = Math.max(180, maxTokenLength * 20 + 60);

                                    return (
                                        <tr key={pool.address} className="hover:bg-base-200/50 transition-colors">
                                            <td>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex -space-x-2">
                                                        {assetX?.icon && (
                                                            <Image
                                                                src={assetX.icon}
                                                                alt={tokenX}
                                                                width={24}
                                                                height={24}
                                                                className="w-6 h-6 rounded-full border-2 border-base-100"
                                                                unoptimized
                                                            />
                                                        )}
                                                        {assetY?.icon && (
                                                            <Image
                                                                src={assetY.icon}
                                                                alt={tokenY}
                                                                width={24}
                                                                height={24}
                                                                className="w-6 h-6 rounded-full border-2 border-base-100"
                                                                unoptimized
                                                            />
                                                        )}
                                                    </div>

                                                    <div className="flex-1">
                                                        <a
                                                            href={poolAppUrl(pool)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="font-semibold hover:text-primary transition-colors flex items-center gap-2"
                                                        >
                                                            {pool.name}
                                                            {pool.is_verified && (
                                                                <svg
                                                                    xmlns="http://www.w3.org/2000/svg"
                                                                    viewBox="0 0 24 24"
                                                                    fill="currentColor"
                                                                    className="w-4 h-4 text-success"
                                                                >
                                                                    <path fillRule="evenodd"
                                                                          d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                                                                          clipRule="evenodd"/>
                                                                </svg>
                                                            )}
                                                        </a>
                                                        <div className="text-xs text-base-content/60 mt-1">
                                                            {pool.protocol === 'DLMM' ? `Bin: ${pool.bin_step} | ` : ''}Fee: {pool.base_fee_percentage}%
                                                            {pool.protocol !== 'DLMM' && (
                                                                <span className="badge badge-ghost badge-xs ml-1">DAMM v2</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="text-right font-medium">
                                                {formatCurrency(pool.liquidity)}
                                            </td>
                                            <td className="px-2">
                                                <div
                                                    className="relative h-5 bg-base-200 rounded-full overflow-hidden"
                                                    style={{minWidth: `${minWidth}px`}}
                                                >
                                                    <div
                                                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-yellow-200 to-red-600 transition-all duration-500 ease-out"
                                                        style={{width: `${percentX}%`}}
                                                    />
                                                    <div
                                                        className="absolute inset-y-0 right-0 bg-gradient-to-l from-emerald-50 to-emerald-300 transition-all duration-500 ease-out"
                                                        style={{width: `${percentY}%`}}
                                                    />
                                                    <div
                                                        className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700 whitespace-nowrap px-2">
                                                        {tokenX} {prettifyNumber(percentX)}%
                                                        / {tokenY} {prettifyNumber(percentY)}%
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="text-right font-medium">
                                                {formatCurrency(pool.trade_volume_24h)}
                                            </td>
                                            <td className="text-right font-medium">
                                                {formatCurrency(pool.fees_24h)}
                                            </td>
                                            <td className="text-center">
                                                <CompactTrendBars data={pool.fee_tvl_ratio}/>
                                            </td>
                                            <td className="text-right">
                                                <span className="font-semibold text-info">
                                                    {prettifyNumber(getDailyYield(pool) * 100)}%
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden space-y-3">
                        {/* Search Bar for Mobile */}
                        <div className="bg-base-100 rounded-lg p-3 shadow-sm">
                            <input
                                type="text"
                                placeholder="Search pools..."
                                className="input input-bordered input-sm w-full"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {sortedPools.length === 0 ? (
                            <div className="bg-base-100 rounded-lg p-8 text-center">
                                <div className="text-base-content/70">
                                    No pools match {searchQuery}
                                </div>
                                <button
                                    className="btn btn-sm btn-ghost mt-2"
                                    onClick={() => setSearchQuery('')}
                                >
                                    Clear filter
                                </button>
                            </div>
                        ) : (
                            sortedPools.map((pool) => {
                                const assetX = tokenAssets.get(pool.mint_x);
                                const assetY = tokenAssets.get(pool.mint_y);

                                const {percentX, percentY} = calculateLiquidityDistribution(
                                    pool.token_x_amount,
                                    pool.token_y_amount,
                                    pool.current_price
                                );

                                const tokens = pool.name.split('-').map(t => t.trim());
                                const tokenX = tokens[0] || 'X';
                                const tokenY = tokens[1] || 'Y';

                                return (
                                    <div key={pool.address} className="bg-base-100 rounded-lg shadow-sm p-4">
                                        {/* Pool Header */}
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="flex -space-x-2">
                                                {assetX?.icon && (
                                                    <Image
                                                        src={assetX.icon}
                                                        alt={tokenX}
                                                        width={32}
                                                        height={32}
                                                        className="w-8 h-8 rounded-full border-2 border-base-100"
                                                        unoptimized
                                                    />
                                                )}
                                                {assetY?.icon && (
                                                    <Image
                                                        src={assetY.icon}
                                                        alt={tokenY}
                                                        width={32}
                                                        height={32}
                                                        className="w-8 h-8 rounded-full border-2 border-base-100"
                                                        unoptimized
                                                    />
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <a
                                                    href={poolAppUrl(pool)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-bold text-base hover:text-primary transition-colors flex items-center gap-2"
                                                >
                                                    {pool.name}
                                                    {pool.is_verified && (
                                                        <svg
                                                            xmlns="http://www.w3.org/2000/svg"
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            className="w-4 h-4 text-success"
                                                        >
                                                            <path fillRule="evenodd"
                                                                  d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                                                                  clipRule="evenodd"/>
                                                        </svg>
                                                    )}
                                                </a>
                                                <div className="text-xs text-base-content/60">
                                                    {pool.protocol === 'DLMM' ? `Bin: ${pool.bin_step} | ` : ''}Fee: {pool.base_fee_percentage}%
                                                            {pool.protocol !== 'DLMM' && (
                                                                <span className="badge badge-ghost badge-xs ml-1">DAMM v2</span>
                                                            )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Liquidity Distribution */}
                                        <div className="mb-3">
                                            <div className="text-xs text-base-content/60 mb-1">Distribution</div>
                                            <div className="relative h-6 bg-base-200 rounded-full overflow-hidden">
                                                <div
                                                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-yellow-200 to-red-600 transition-all"
                                                    style={{width: `${percentX}%`}}
                                                />
                                                <div
                                                    className="absolute inset-y-0 right-0 bg-gradient-to-l from-emerald-50 to-emerald-300 transition-all"
                                                    style={{width: `${percentY}%`}}
                                                />
                                                <div
                                                    className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
                                                    {tokenX} {prettifyNumber(percentX)}%
                                                    / {tokenY} {prettifyNumber(percentY)}%
                                                </div>
                                            </div>
                                        </div>

                                        {/* Stats Grid */}
                                        <div className="grid grid-cols-2 gap-3 mb-3">
                                            <div>
                                                <div className="text-xs text-base-content/60">Liquidity</div>
                                                <div
                                                    className="font-bold text-sm">{formatCurrency(pool.liquidity)}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-base-content/60">24h Volume</div>
                                                <div
                                                    className="font-bold text-sm">{formatCurrency(pool.trade_volume_24h)}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-base-content/60">24h Fees</div>
                                                <div className="font-bold text-sm">{formatCurrency(pool.fees_24h)}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-base-content/60">Daily Yield</div>
                                                <div className="font-bold text-sm text-info">
                                                    {prettifyNumber(getDailyYield(pool) * 100)}%
                                                </div>
                                            </div>
                                        </div>

                                        {/* Trend */}
                                        <div>
                                            <div className="text-xs text-base-content/60 mb-1">Fee Yield Trend</div>
                                            <CompactTrendBars data={pool.fee_tvl_ratio}/>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default PoolPage;
