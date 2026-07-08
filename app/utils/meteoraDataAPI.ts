// app/utils/meteoraDataAPI.ts
// Typed fetchers for the Meteora data APIs (portfolio, PnL, OHLCV, limit orders, DAMM v2).
// All numeric aggregate fields arrive as strings; consumers parse as needed.

export const DLMM_DATA_API = 'https://dlmm.datapi.meteora.ag';
export const DAMM_V2_DATA_API = 'https://damm-v2.datapi.meteora.ag';

const MAX_PAGES = 10;

async function getJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`Meteora data API ${res.status} for ${url}`);
            return null;
        }
        return await res.json() as T;
    } catch (error) {
        console.error(`Meteora data API request failed for ${url}:`, error);
        return null;
    }
}

// ---------- Portfolio: totals ----------

export interface PortfolioTotals {
    totalPnlUsd: string;
    totalPnlSol: string;
    totalPnlPctChange: string;
    totalPnlSolPctChange: string;
    totalClosedPositions: number;
}

export function fetchPortfolioTotal(user: string): Promise<PortfolioTotals | null> {
    return getJson<PortfolioTotals>(`${DLMM_DATA_API}/portfolio/total?user=${user}`);
}

// ---------- Portfolio: open positions ----------

export interface PortfolioOpenPool {
    poolAddress: string;
    binStep: number;
    baseFee: number;
    collectFeeMode: number;
    tokenX: string;
    tokenY: string;
    tokenXMint: string;
    tokenYMint: string;
    tokenXIcon: string;
    tokenYIcon: string;
    poolPrice: string;
    balances: string;
    balancesSol: string;
    unclaimedFees: string;
    unclaimedFeesSol: string;
    pnl: string;
    pnlPctChange: string;
    pnlSol: string;
    pnlSolPctChange: string;
    feePerTvl24h: string;
    totalDeposit: string;
    totalDepositSol: string;
    openPositionCount: number;
    outOfRange: boolean;
    listPositions: string[];
    positionsOutOfRange: string[];
}

export interface PortfolioOpenTotals {
    totalPositions: number;
    balances: string;
    balancesSol: string;
    unclaimedFees: string;
    unclaimedFeesSol: string;
    pnl: string;
    pnlSol: string;
    pnlPctChange: string;
    pnlSolPctChange: string;
}

interface PortfolioOpenResponse {
    page: number;
    pageSize: number;
    hasNext: boolean;
    totalCount: number;
    totalPositions: number;
    total: PortfolioOpenTotals | null;
    solPrice: string | null;
    pools: PortfolioOpenPool[];
}

export interface PortfolioOpen {
    pools: PortfolioOpenPool[];
    total: PortfolioOpenTotals | null;
    solPrice: string | null;
    totalPositions: number;
}

export async function fetchPortfolioOpen(user: string): Promise<PortfolioOpen | null> {
    const pools: PortfolioOpenPool[] = [];
    let total: PortfolioOpenTotals | null = null;
    let solPrice: string | null = null;
    let totalPositions = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await getJson<PortfolioOpenResponse>(
            `${DLMM_DATA_API}/portfolio/open?user=${user}&page=${page}&page_size=50`
        );
        if (!res) return page === 1 ? null : {pools, total, solPrice, totalPositions};
        pools.push(...(res.pools ?? []));
        total = res.total ?? total;
        solPrice = res.solPrice ?? solPrice;
        totalPositions = res.totalPositions ?? totalPositions;
        if (!res.hasNext) break;
    }
    return {pools, total, solPrice, totalPositions};
}

// ---------- Portfolio: closed positions ----------

export interface PortfolioClosedPool {
    poolAddress: string;
    binStep: string;
    baseFee: string;
    collectFeeMode: number;
    tokenX: string;
    tokenY: string;
    tokenXMint: string;
    tokenYMint: string;
    tokenXIcon: string;
    tokenYIcon: string;
    lastClosedAt: number;
    totalDeposit: string;
    totalDepositSol: string;
    totalWithdrawal: string;
    totalWithdrawalSol: string;
    totalFee: string;
    totalFeeSol: string;
    pnlUsd: string;
    pnlSol: string;
    pnlPctChange: string;
    pnlSolPctChange: string;
    totalDepositTokenX: string;
    totalDepositTokenY: string;
    totalWithdrawalTokenX: string;
    totalWithdrawalTokenY: string;
    totalFeeTokenX: string;
    totalFeeTokenY: string;
}

interface PortfolioClosedResponse {
    page: number;
    pageSize: number;
    hasNext: boolean;
    totalCount: number;
    totalPositions: number;
    pools: PortfolioClosedPool[];
}

export interface PortfolioClosed {
    pools: PortfolioClosedPool[];
    totalCount: number;
    totalPositions: number;
    hasNext: boolean;
}

export async function fetchPortfolioClosed(
    user: string,
    daysBack: number = 120,
    page: number = 1,
    pageSize: number = 20
): Promise<PortfolioClosed | null> {
    const res = await getJson<PortfolioClosedResponse>(
        `${DLMM_DATA_API}/portfolio?user=${user}&days_back=${daysBack}&page=${page}&page_size=${pageSize}`
    );
    if (!res) return null;
    return {
        pools: res.pools ?? [],
        totalCount: res.totalCount ?? 0,
        totalPositions: res.totalPositions ?? 0,
        hasNext: res.hasNext ?? false,
    };
}

// ---------- Position PnL ----------

export interface TokenPairWithTotal {
    tokenX: { amount: string; usd: string; amountSol: string };
    tokenY: { amount: string; usd: string; amountSol: string };
    total: { usd: string; sol: string };
}

export interface PositionPnl {
    positionAddress: string;
    minPrice: string;
    maxPrice: string;
    lowerBinId: number;
    upperBinId: number;
    poolActiveBinId: number | null;
    poolActivePrice: string | null;
    isOutOfRange: boolean | null;
    isClosed: boolean;
    createdAt: number | null;
    closedAt: number | null;
    feePerTvl24h: string;
    pnlUsd: string;
    pnlSol: number | string | null;
    pnlPctChange: string;
    pnlSolPctChange: number | string | null;
    allTimeDeposits: TokenPairWithTotal;
    allTimeWithdrawals: TokenPairWithTotal;
    allTimeFees: TokenPairWithTotal;
}

interface PositionPnlResponse {
    totalCount: number;
    page: number;
    pageSize: number;
    hasNext: boolean;
    positions: PositionPnl[];
    tokenX: string | null;
    tokenY: string | null;
    solPrice: string | null;
}

export async function fetchPositionsPnl(
    poolAddress: string,
    user: string,
    status: 'open' | 'closed' | 'all' = 'all'
): Promise<PositionPnl[]> {
    const positions: PositionPnl[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await getJson<PositionPnlResponse>(
            `${DLMM_DATA_API}/positions/${poolAddress}/pnl?user=${user}&status=${status}&page=${page}&page_size=100`
        );
        if (!res) break;
        positions.push(...(res.positions ?? []));
        if (!res.hasNext) break;
    }
    return positions;
}

// ---------- OHLCV ----------

export type OhlcvTimeframe = '5m' | '30m' | '1h' | '2h' | '4h' | '12h' | '24h';

export interface OhlcvCandle {
    timestamp: number;
    timestamp_str: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface OhlcvResponse {
    start_time: number;
    end_time: number;
    timeframe: string | null;
    data: OhlcvCandle[];
}

export async function fetchPoolOhlcv(
    poolAddress: string,
    timeframe: OhlcvTimeframe = '4h',
    startTime?: number
): Promise<OhlcvCandle[]> {
    const params = new URLSearchParams({timeframe});
    if (startTime) params.set('start_time', String(startTime));
    const res = await getJson<OhlcvResponse>(`${DLMM_DATA_API}/pools/${poolAddress}/ohlcv?${params}`);
    return res?.data ?? [];
}

// ---------- Limit orders ----------

export interface LimitOrderSummary {
    open_orders: number;
    closed_orders: number;
    total_deposit_usd: string;
    total_deposit_sol: string;
    total_bonus_usd: string;
    total_bonus_sol: string;
    total_claimable_bonus_usd: string;
    total_claimable_bonus_sol: string;
    total_current_value_usd: string;
    total_current_value_sol: string;
    realized_pnl_usd: string;
    realized_pnl_sol: string;
}

export function fetchLimitOrderSummary(wallet: string): Promise<LimitOrderSummary | null> {
    return getJson<LimitOrderSummary>(`${DLMM_DATA_API}/wallets/${wallet}/limit_orders/summary`);
}
