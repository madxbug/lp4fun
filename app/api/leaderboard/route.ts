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

const TOP_POOLS_BY_FEE = 10;
const TOP_POOLS_BY_TVL = 5;
const MAX_OWNERS_PER_POOL = 100;
const MAX_WALLETS = 200;
const SCORE_CONCURRENCY = 10;
const POOL_SCAN_CONCURRENCY = 4;
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
    data: { address: string }[];
}

// Owners of all open positions in a pool. PositionV2 layout: 8-byte discriminator,
// lbPair pubkey at offset 8, owner pubkey at offset 40 — dataSlice keeps the
// response small even for pools with thousands of positions.
async function fetchPoolOwners(pool: string): Promise<string[]> {
    try {
        const res = await fetch(RPC_ENDPOINT, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'getProgramAccounts',
                params: [DLMM_PROGRAM, {
                    encoding: 'base64',
                    filters: [{memcmp: {offset: 8, bytes: pool}}],
                    dataSlice: {offset: 40, length: 32},
                }],
            }),
        });
        const json = await res.json();
        const accounts: { account: { data: [string, string] } }[] = json?.result ?? [];
        const owners = new Set<string>();
        for (const a of accounts) {
            owners.add(new PublicKey(Buffer.from(a.account.data[0], 'base64')).toBase58());
        }
        return Array.from(owners).slice(0, MAX_OWNERS_PER_POOL);
    } catch {
        return [];
    }
}

async function discoverWallets(): Promise<{ wallets: string[]; poolCount: number }> {
    const [byFee, byTvl] = await Promise.all([
        getJson<PoolsResponse>(`${DLMM_API}/pools?page=1&page_size=${TOP_POOLS_BY_FEE}&sort_by=fee_24h:desc`),
        getJson<PoolsResponse>(`${DLMM_API}/pools?page=1&page_size=${TOP_POOLS_BY_TVL}&sort_by=tvl:desc`),
    ]);
    const pools = Array.from(new Set(
        [...(byFee?.data ?? []), ...(byTvl?.data ?? [])].map(p => p.address)
    ));
    const ownerLists = await mapLimit(pools, POOL_SCAN_CONCURRENCY, fetchPoolOwners);
    const wallets = Array.from(new Set(ownerLists.flat())).slice(0, MAX_WALLETS);
    return {wallets, poolCount: pools.length};
}

// ---------- Scoring ----------

interface PortfolioTotalResponse {
    totalPnlUsd: string;
    totalPnlSol: string;
    totalClosedPositions: number;
}

interface PortfolioClosedResponse {
    hasNext: boolean;
    totalPositions: number;
    pools: { pnlUsd: string; pnlSol: string }[];
}

async function scoreAllTime(wallet: string): Promise<ScoredWallet | null> {
    const total = await getJson<PortfolioTotalResponse>(`${DLMM_API}/portfolio/total?user=${wallet}`);
    if (!total) return null;
    return {
        wallet,
        pnlUsd: num(total.totalPnlUsd),
        pnlSol: num(total.totalPnlSol),
        positions: total.totalClosedPositions ?? 0,
    };
}

async function scoreWindow(wallet: string, daysBack: number): Promise<ScoredWallet | null> {
    let pnlUsd = 0, pnlSol = 0, positions = 0;
    for (let page = 1; page <= PORTFOLIO_PAGE_CAP; page++) {
        const res = await getJson<PortfolioClosedResponse>(
            `${DLMM_API}/portfolio?user=${wallet}&days_back=${daysBack}&page=${page}&page_size=100`
        );
        if (!res) return page === 1 ? null : {wallet, pnlUsd, pnlSol, positions};
        for (const pool of res.pools ?? []) {
            pnlUsd += num(pool.pnlUsd);
            pnlSol += num(pool.pnlSol);
        }
        positions = res.totalPositions ?? positions;
        if (!res.hasNext) break;
    }
    return {wallet, pnlUsd, pnlSol, positions};
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
