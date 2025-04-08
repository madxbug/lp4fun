// app/wallet/[[...walletPubKeys]]/page.tsx
'use client';

import {usePathname, useSearchParams} from 'next/navigation';
import React, {useEffect, useState} from 'react';
import TableComponent from '@/app/wallet/[[...walletPubKeys]]/TableComponent';
import DLMM, {LbPosition} from '@meteora-ag/dlmm';
import {PublicKey} from '@solana/web3.js';
import {formatTokenBalance} from "@/app/utils/solana";
import {PoolData, PositionData, WalletData} from "@/app/types";
import {bnToDate} from "@/app/utils/numberFormatting";
import {fetchWithRetry} from "@/app/utils/rateLimitedFetch";
import {fetchTokenPrice} from "@/app/utils/jup";
import {FaChartBar, FaCheckDouble, FaTrashAlt} from 'react-icons/fa';
import {formatPubKey} from "@/app/utils/formatters";
import {getTokenMetadata} from "@/app/utils/tokenMetadata";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from "@vercel/speed-insights/next"
import {getDefaultConnection} from "@/app/utils/cachedConnection";

const createDataMap = async (wallet: string): Promise<Map<string, PoolData>> => {
    const connection = getDefaultConnection();
    const user = new PublicKey(wallet);
    const positions = await fetchWithRetry(() => DLMM.getAllLbPairPositionsByUser(connection, user));
    const map = new Map<string, PoolData>();
    await Promise.all(Array.from(positions.entries()).map(async ([key, position]) => {
        const tokenInfo = await fetchTokenPrice(position.tokenX.publicKey, position.tokenY.publicKey);

        const lbPairPositionsData = position.lbPairPositionsData.map((pos: LbPosition): PositionData => {
            const claimedFeeXAmount = pos.positionData.totalClaimedFeeXAmount.toString();
            const claimedFeeYAmount = pos.positionData.totalClaimedFeeYAmount.toString();

            return {
                lastUpdatedAt: bnToDate(pos.positionData.lastUpdatedAt),
                totalXAmount: formatTokenBalance(BigInt(pos.positionData.totalXAmount.split('.')[0]), position.tokenX.decimal),
                totalYAmount: formatTokenBalance(BigInt(pos.positionData.totalYAmount.split('.')[0]), position.tokenY.decimal),
                feeX: formatTokenBalance(BigInt(pos.positionData.feeX.toString()), position.tokenX.decimal),
                feeY: formatTokenBalance(BigInt(pos.positionData.feeY.toString()), position.tokenY.decimal),
                publicKey: pos.publicKey.toString(),
                lowerBinId: pos.positionData.lowerBinId,
                upperBinId: pos.positionData.upperBinId,
                claimedFeeXAmount,
                claimedFeeYAmount,
                claimedFeeX: formatTokenBalance(BigInt(claimedFeeXAmount), position.tokenX.decimal),
                claimedFeeY: formatTokenBalance(BigInt(claimedFeeYAmount), position.tokenY.decimal),
            };
        });
        const mintInfoX = await getTokenMetadata(connection, position.tokenX.publicKey);
        const mintInfoY = await getTokenMetadata(connection, position.tokenY.publicKey);
        map.set(key, {
            lbPairPositionsData,
            nameX: mintInfoX?.symbol ?? 'Unknown Token X',
            nameY: mintInfoY?.symbol ?? 'Unknown Token Y',
            price: tokenInfo.price,
            activeBin: position.lbPair.activeId,
            tokenXDecimal: position.tokenX.decimal,
            tokenYDecimal: position.tokenY.decimal
        });
    }));

    return map;
};

const WalletPage: React.FC = () => {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [walletsData, setWalletsData] = useState<WalletData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
    const [allPositions, setAllPositions] = useState<Set<string>>(new Set());

    useEffect(() => {
        const fetchData = async () => {
            let wallets: string[] = [];

            if (pathname) {
                const pathWallets = pathname.split('/').pop();
                if (pathWallets) {
                    wallets = decodeURIComponent(pathWallets).split(',');
                }
            } else if (searchParams.get('wallet')) {
                wallets = decodeURIComponent(searchParams.get('wallet') || '').split(',');
            }

            wallets = wallets.map(wallet => wallet.trim()).filter(Boolean);

            if (wallets.length === 0) {
                setError('No wallets specified. Please provide at least one wallet address.');
                setIsLoading(false);
                return;
            }

            try {
                setIsLoading(true);
                const walletsDataPromises = wallets.map(async (wallet) => {
                    const dataMap = await createDataMap(wallet);
                    return { wallet, dataMap };
                });

                const resolvedWalletsData = await Promise.all(walletsDataPromises);
                setWalletsData(resolvedWalletsData);

                const allPositionKeys = new Set<string>();
                resolvedWalletsData.forEach(({ dataMap }) => {
                    dataMap.forEach((poolData) => {
                        poolData.lbPairPositionsData.forEach((position) => {
                            allPositionKeys.add(position.publicKey.toString());
                        });
                    });
                });
                setAllPositions(allPositionKeys);
            } catch (error) {
                console.error('Error fetching data:', error);
                setError('Failed to fetch wallet data. Please try again later.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [pathname, searchParams]);

    const handleSelectionChange = (newSelection: Set<string>) => {
        setSelectedPositions(newSelection);
    };

    const clearSelection = () => {
        setSelectedPositions(new Set());
    };

    const selectAllPositions = () => {
        setSelectedPositions(new Set(allPositions));
    };

    const viewPositionAnalytics = () => {
        const positionKeys = Array.from(selectedPositions);
        if (positionKeys.length > 0) {
            const url = `/position/${positionKeys.join(',')}`;
            window.open(url, '_blank');
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

    if (error) {
        return <div className="alert alert-error">{error}</div>;
    }

    if (walletsData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-screen text-center">
                <div className="text-2xl font-bold mb-4">No open DLMM positions found</div>
                <div className="text-lg mb-6">Looks like you haven&apos;t dipped your toes in the DLMM pool yet!</div>
                <div className="text-md">
                    Ready to dive in? Open a position at{' '}
                    <a
                        href="https://app.meteora.ag/dlmm"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700 underline"
                    >
                        Meteora DLMM
                    </a>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="container mx-auto p-4 mb-16"> {/* Added margin-bottom to prevent footer overlap */}
                {walletsData.map(({ wallet, dataMap }) => (
                    <div key={wallet} className="mb-8">
                        <div className="border border-base-300 rounded-lg bg-base-100 p-4 mb-4">
                            <a
                                href={`https://solscan.io/account/${wallet}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block"
                            >
                                <div className="text-xl font-medium flex items-center justify-between cursor-pointer p-2 rounded hover:bg-base-200 transition-colors duration-300">
                                    <span className="text-base-content">Wallet: {formatPubKey(wallet)}</span>
                                </div>
                            </a>
                        </div>
                        {dataMap.size > 0 ? (
                            <TableComponent
                                dataMap={dataMap}
                                selectedPositions={selectedPositions}
                                onSelectionChange={handleSelectionChange}
                            />
                        ) : (
                            <div className="text-center text-base-content/70 italic">
                                No open DLMM positions found for this wallet.
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {allPositions.size > 0 && (
                <footer className="fixed bottom-0 left-0 right-0 bg-base-100 bg-opacity-80 backdrop-blur-md shadow-lg">
                    <div className="container mx-auto px-4 py-3 flex justify-center items-center space-x-4">
                        <button
                            onClick={clearSelection}
                            className="btn btn-sm btn-ghost text-error"
                        >
                            <FaTrashAlt className="mr-2" /> Clear
                        </button>
                        <button
                            onClick={selectAllPositions}
                            className="btn btn-sm btn-ghost text-success"
                        >
                            <FaCheckDouble className="mr-2" /> Select All
                        </button>
                        <button
                            onClick={viewPositionAnalytics}
                            className={`btn btn-sm ${selectedPositions.size > 0 ? 'btn-primary' : 'btn-disabled'}`}
                            disabled={selectedPositions.size === 0}
                        >
                            <FaChartBar className="mr-2" /> View Analytics
                        </button>
                    </div>
                </footer>
            )}
            <Analytics />
            <SpeedInsights />
        </>
    );
};

export default WalletPage;
