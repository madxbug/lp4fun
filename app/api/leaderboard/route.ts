// app/api/leaderboard/route.ts
// Global DLMM wallet leaderboard. No Meteora endpoint enumerates wallets, so we
// discover them on-chain: owners of open positions in the top pools (by 24h fees
// and by TVL), then score each via the Meteora data API. Results are cached
// in-memory per window and on the CDN; wallets that fully exited before a scan
// are invisible to discovery (their PnL stays queryable once known).

import {NextRequest, NextResponse} from 'next/server';
import {PublicKey} from '@solana/web3.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DLMM_API = 'https://dlmm.datapi.meteora.ag';
const DLMM_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const RPC_ENDPOINT = process.env.LEADERBOARD_RPC_ENDPOINT ?? 'https://rpc-proxy.segfaultx0.workers.dev';

const TOP_POOLS_BY_FEE = 20;
const TOP_POOLS_BY_RATIO = 20;
const TOP_POOLS_BY_TVL = 5;
const MIN_POOL_FEE_24H_USD = 500;
const BASE_WALLETS_PER_POOL = 5;
const MAX_WALLETS = 300;
const SCORE_CONCURRENCY = 10;
const POOL_SCAN_CONCURRENCY = 8;
const PORTFOLIO_PAGE_CAP = 3;
const RESULT_LIMIT = 100;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type WindowKey = '1d' | '7d' | '30d' | 'all';
const DAYS_BACK: Record<Exclude<WindowKey, 'all'>, number> = {'1d': 1, '7d': 7, '30d': 30};

interface ScoredWallet {
    wallet: string;
    pnlUsd: number;
    pnlSol: number;
    positions: number;
    // Gross capital committed in the window (sum of deposits; churn counts every
    // re-deposit, so high-frequency LPs show inflated denominators).
    deposits: number;
    roiPct: number | null;
}

interface ProtocolMetrics {
    total_tvl: number;
    volume_24h: number;
    fee_24h: number;
    total_pools: number;
}

interface Payload {
    window: WindowKey;
    updatedAt: number;
    scannedPools: number;
    scannedWallets: number;
    protocol: ProtocolMetrics | null;
    wallets: ScoredWallet[];
}

const cache = new Map<WindowKey, { at: number; data: Payload }>();

const num = (v: unknown): number => {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
    return Number.isFinite(n) ? n : 0;
};

async function getJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url, {cache: 'no-store'});
        if (!res.ok) return null;
        return await res.json() as T;
    } catch {
        return null;
    }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}

// ---------- Discovery ----------

interface PoolsResponse {
    data: { address: string; fees?: Record<string, number> }[];
}

// PositionV2 layout (verified against the SDK IDL): 8-byte discriminator,
// lbPair pubkey at offset 8, owner pubkey at offset 40,
// total_claimed_fee_x/y u64s at offsets 7928/7936; account size 8120.
interface GpaSlice {
    pubkey: string;
    account: { data: [string, string] };
}

async function gpaSlice(pool: string, offset: number, length: number): Promise<GpaSlice[]> {
    const res = await fetch(RPC_ENDPOINT, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'getProgramAccounts',
            params: [DLMM_PROGRAM, {
                encoding: 'base64',
                filters: [{dataSize: 8120}, {memcmp: {offset: 8, bytes: pool}}],
                dataSlice: {offset, length},
            }],
        }),
    });
    const json = await res.json();
    return json?.result ?? [];
}

// Per-LP stats for a pool's open positions. claimedY (quote-side lifetime claimed
// fees, raw units) is only comparable within one pool — it's the whale signal used
// to rank that pool's LPs.
async function fetchPoolLpStats(pool: string): Promise<Map<string, number>> {
    try {
        const [ownerSlices, feeSlices] = await Promise.all([
            gpaSlice(pool, 40, 32),
            gpaSlice(pool, 7936, 8),
        ]);
        const feeByPosition = new Map<string, number>();
        for (const s of feeSlices) {
            feeByPosition.set(s.pubkey, Number(Buffer.from(s.account.data[0], 'base64').readBigUInt64LE(0)));
        }
        const claimedYByOwner = new Map<string, number>();
        for (const s of ownerSlices) {
            const owner = new PublicKey(Buffer.from(s.account.data[0], 'base64')).toBase58();
            claimedYByOwner.set(owner, (claimedYByOwner.get(owner) ?? 0) + (feeByPosition.get(s.pubkey) ?? 0));
        }
        return claimedYByOwner;
    } catch {
        return new Map();
    }
}

// Three pool buckets: biggest absolute fee earners, most concentrated earners
// (high fee/TVL with a real-fee floor — a small pool can pay one LP more than a
// crowded top pool pays each of its thousand), and the largest pools by TVL.
async function discoverWallets(): Promise<{ wallets: string[]; poolCount: number }> {
    const feeFloor = encodeURIComponent(`fee_24h>${MIN_POOL_FEE_24H_USD}`);
    const [byFee, byRatio, byTvl] = await Promise.all([
        getJson<PoolsResponse>(`${DLMM_API}/pools?page=1&page_size=${TOP_POOLS_BY_FEE}&sort_by=fee_24h:desc`),
        getJson<PoolsResponse>(`${DLMM_API}/pools?page=1&page_size=${TOP_POOLS_BY_RATIO}&sort_by=fee_tvl_ratio_24h:desc&filter_by=${feeFloor}`),
        getJson<PoolsResponse>(`${DLMM_API}/pools?page=1&page_size=${TOP_POOLS_BY_TVL}&sort_by=tvl:desc`),
    ]);
    const poolFees = new Map<string, number>();
    for (const p of [...(byFee?.data ?? []), ...(byRatio?.data ?? []), ...(byTvl?.data ?? [])]) {
        if (!poolFees.has(p.address)) poolFees.set(p.address, num(p.fees?.['24h']));
    }
    const pools = Array.from(poolFees.keys());
    const poolStats = await mapLimit(pools, POOL_SCAN_CONCURRENCY, fetchPoolLpStats);

    // Each LP's estimated take of its pool's 24h fees = pool fees × the LP's share
    // of lifetime claimed fees in that pool (even split when nobody has claimed yet).
    // Every pool contributes its top claimers so whales inside crowded pools are
    // kept; the rest of the budget goes to the globally best estimated shares,
    // which favors concentrated pools where one LP takes most of the fees.
    const selected = new Set<string>();
    const candidates: { wallet: string; estimatedShare: number }[] = [];
    pools.forEach((pool, i) => {
        const stats = poolStats[i];
        if (stats.size === 0) return;
        const poolFee = poolFees.get(pool) ?? 0;
        const totalClaimed = Array.from(stats.values()).reduce((a, v) => a + v, 0);
        const owners = Array.from(stats.entries())
            .map(([wallet, claimed]) => ({
                wallet,
                estimatedShare: poolFee * (totalClaimed > 0 ? claimed / totalClaimed : 1 / stats.size),
            }))
            .sort((a, b) => b.estimatedShare - a.estimatedShare);
        owners.slice(0, BASE_WALLETS_PER_POOL).forEach(o => selected.add(o.wallet));
        candidates.push(...owners);
    });
    candidates.sort((a, b) => b.estimatedShare - a.estimatedShare);
    for (const c of candidates) {
        if (selected.size >= MAX_WALLETS) break;
        selected.add(c.wallet);
    }
    return {wallets: Array.from(selected).slice(0, MAX_WALLETS), poolCount: pools.length};
}

// ---------- Scoring ----------

interface PortfolioTotalResponse {
    totalPnlUsd: string;
    totalPnlSol: string;
    totalPnlPctChange: string;
    totalClosedPositions: number;
}

interface PortfolioClosedResponse {
    hasNext: boolean;
    totalPositions: number;
    pools: { pnlUsd: string; pnlSol: string; totalDeposit: string }[];
}

async function scoreAllTime(wallet: string): Promise<ScoredWallet | null> {
    const total = await getJson<PortfolioTotalResponse>(`${DLMM_API}/portfolio/total?user=${wallet}`);
    if (!total) return null;
    const pnlUsd = num(total.totalPnlUsd);
    // totalPnlPctChange is already in percent units (verified: pnl/deposits*100),
    // so all-time deposits are derived rather than summed.
    const roiPct = num(total.totalPnlPctChange);
    return {
        wallet,
        pnlUsd,
        pnlSol: num(total.totalPnlSol),
        positions: total.totalClosedPositions ?? 0,
        deposits: roiPct !== 0 ? Math.abs(pnlUsd / (roiPct / 100)) : 0,
        roiPct: roiPct !== 0 ? roiPct : null,
    };
}

async function scoreWindow(wallet: string, daysBack: number): Promise<ScoredWallet | null> {
    let pnlUsd = 0, pnlSol = 0, positions = 0, deposits = 0;
    const result = (): ScoredWallet => ({
        wallet, pnlUsd, pnlSol, positions, deposits,
        roiPct: deposits > 0 ? (pnlUsd / deposits) * 100 : null,
    });
    for (let page = 1; page <= PORTFOLIO_PAGE_CAP; page++) {
        const res = await getJson<PortfolioClosedResponse>(
            `${DLMM_API}/portfolio?user=${wallet}&days_back=${daysBack}&page=${page}&page_size=100`
        );
        if (!res) return page === 1 ? null : result();
        for (const pool of res.pools ?? []) {
            pnlUsd += num(pool.pnlUsd);
            pnlSol += num(pool.pnlSol);
            deposits += num(pool.totalDeposit);
        }
        positions = res.totalPositions ?? positions;
        if (!res.hasNext) break;
    }
    return result();
}

// ---------- Handler ----------

async function buildPayload(window: WindowKey): Promise<Payload> {
    const [{wallets, poolCount}, protocol] = await Promise.all([
        discoverWallets(),
        getJson<ProtocolMetrics>(`${DLMM_API}/stats/protocol_metrics`),
    ]);

    const scored = await mapLimit(wallets, SCORE_CONCURRENCY, w =>
        window === 'all' ? scoreAllTime(w) : scoreWindow(w, DAYS_BACK[window])
    );

    const ranked = scored
        .filter((s): s is ScoredWallet => s !== null && (s.pnlUsd !== 0 || s.pnlSol !== 0))
        .sort((a, b) => b.pnlUsd - a.pnlUsd)
        .slice(0, RESULT_LIMIT);

    return {
        window,
        updatedAt: Date.now(),
        scannedPools: poolCount,
        scannedWallets: wallets.length,
        protocol: protocol ?? null,
        wallets: ranked,
    };
}

export async function GET(request: NextRequest) {
    const windowParam = request.nextUrl.searchParams.get('window') ?? 'all';
    if (!['1d', '7d', '30d', 'all'].includes(windowParam)) {
        return NextResponse.json({error: 'window must be one of 1d, 7d, 30d, all'}, {status: 400});
    }
    const window = windowParam as WindowKey;
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';

    const cached = cache.get(window);
    if (cached && !forceRefresh && Date.now() - cached.at < CACHE_TTL_MS) {
        return NextResponse.json(cached.data, {
            headers: {'Cache-Control': 's-maxage=21600, stale-while-revalidate=86400'},
        });
    }

    const data = await buildPayload(window);
    cache.set(window, {at: Date.now(), data});
    return NextResponse.json(data, {
        headers: {'Cache-Control': 's-maxage=21600, stale-while-revalidate=86400'},
    });
}
