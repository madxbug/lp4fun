// app/wallet/[walletPubKey]/TableComponent.tsx
'use client';

import React, {useEffect, useState} from 'react';
import RangeIndicator from "./RangeIndicator";
import {FaChartBar, FaTimes} from 'react-icons/fa';
import Image from 'next/image';
import {formatDistanceToNow} from 'date-fns';
import {PoolData, PoolInfo, PositionData} from "@/app/types";
import {formatCurrency, prettifyNumber} from "@/app/utils/numberFormatting";
import {calculateLiquidityDistribution} from "@/app/utils/liquidity";

interface TableComponentProps {
    dataMap: Map<string, PoolData>;
}

interface GroupedPool {
    key: string;
    value: PoolData;
    newestDate: Date;
}

interface TokenGroup {
    tokenX: string;
    pairs: {
        pairName: string;
        pools: GroupedPool[];
    }[];
}

const TableComponent: React.FC<TableComponentProps> = ({dataMap}) => {
    const [poolInfoMap, setPoolInfoMap] = useState<Map<string, PoolInfo>>(new Map());
    const [positionsWithDates, setPositionsWithDates] = useState<Map<string, PositionData[]>>(new Map());
    const [groupedPools, setGroupedPools] = useState<TokenGroup[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());

    useEffect(() => {
        const fetchPoolInfo = async (pubkey: string, xDecimals: number, yDecimals: number) => {
            try {
                const response = await fetch(`https://dlmm-api.meteora.ag/pair/${pubkey}`);
                const data = await response.json();
                return {
                    ...data,
                    tokenXDecimal: xDecimals,
                    tokenYDecimal: yDecimals,
                    liquidityDistribution: calculateLiquidityDistribution(
                        data.reserve_x_amount,
                        data.reserve_y_amount,
                        data.current_price,
                        xDecimals,
                        yDecimals
                    ),
                };
            } catch (error) {
                console.error(`Error fetching pool info for ${pubkey}:`, error);
                return null;
            }
        };

        const fetchAllPoolInfo = async () => {
            const infoMap = new Map<string, PoolInfo>();
            for (const [key, value] of Array.from(dataMap.entries())) {
                const info = await fetchPoolInfo(key, value.tokenXDecimal, value.tokenYDecimal);
                if (info) {
                    infoMap.set(key, info);
                }
            }
            setPoolInfoMap(infoMap);
        };

        const fetchPositionDates = async () => {
            const newPositionsWithDates = new Map<string, PositionData[]>();
            const tokenGroups = new Map<string, TokenGroup>();

            for (const [key, value] of Array.from(dataMap.entries())) {
                const positionsWithDate = value.lbPairPositionsData.map((position: PositionData) => position);

                positionsWithDate.sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());

                newPositionsWithDates.set(key, positionsWithDate);

                const pairName = `${value.nameX}-${value.nameY}`;
                const newestDate = positionsWithDate.length > 0 ? positionsWithDate[0].lastUpdatedAt : new Date(0);

                const groupedPool: GroupedPool = {key, value, newestDate};

                if (!tokenGroups.has(value.nameX)) {
                    tokenGroups.set(value.nameX, {tokenX: value.nameX, pairs: []});
                }
                const tokenGroup = tokenGroups.get(value.nameX)!;

                let pair = tokenGroup.pairs.find(p => p.pairName === pairName);
                if (!pair) {
                    pair = {pairName, pools: []};
                    tokenGroup.pairs.push(pair);
                }
                pair.pools.push(groupedPool);
            }

            setPositionsWithDates(newPositionsWithDates);

            // Sort pools within pairs and pairs within token groups
            const sortedTokenGroups = Array.from(tokenGroups.values()).map(group => {
                group.pairs.forEach(pair => {
                    pair.pools.sort((a, b) => b.newestDate.getTime() - a.newestDate.getTime());
                });
                group.pairs.sort((a, b) => b.pools[0].newestDate.getTime() - a.pools[0].newestDate.getTime());
                return group;
            });

            // Sort token groups
            sortedTokenGroups.sort((a, b) => b.pairs[0].pools[0].newestDate.getTime() - a.pairs[0].pools[0].newestDate.getTime());

            setGroupedPools(sortedTokenGroups);
        };

        const loadData = async () => {
            setIsLoading(true);
            await Promise.all([fetchAllPoolInfo(), fetchPositionDates()]);
            setIsLoading(false);
        };

        loadData().catch(error => {
            console.error("Unexpected error in loadData:", error);
        });
    }, [dataMap]);

    const togglePositionSelection = (positionKey: string) => {
        setSelectedPositions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(positionKey)) {
                newSet.delete(positionKey);
            } else {
                newSet.add(positionKey);
            }
            return newSet;
        });
    };

    const clearSelection = () => {
        setSelectedPositions(new Set());
    };

    const openSelectedPositions = () => {
        const positionKeys = Array.from(selectedPositions);
        const url = `/position/${positionKeys.join(',')}`;
        window.open(url, '_blank');
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

    const toggleGroupSelection = (groupPositions: string[]) => {
        setSelectedPositions(prev => {
            const newSet = new Set(prev);
            const allSelected = groupPositions.every(pos => newSet.has(pos));

            if (allSelected) {
                groupPositions.forEach(pos => newSet.delete(pos));
            } else {
                groupPositions.forEach(pos => newSet.add(pos));
            }

            return newSet;
        });
    };

    const isGroupSelected = (groupPositions: string[]) => {
        return groupPositions.every(pos => selectedPositions.has(pos));
    };

    const createTableRows = (): React.ReactNode[] => {
        return groupedPools.map((tokenGroup, tokenGroupIndex) => {
            const allPositionsInGroup = tokenGroup.pairs.flatMap(pair =>
                pair.pools.flatMap(pool =>
                    positionsWithDates.get(pool.key)?.map(pos => pos.publicKey.toString()) || []
                )
            );

            const isTokenGroupSelected = isGroupSelected(allPositionsInGroup);

            return (
                <div key={`tokenGroup-${tokenGroupIndex}`} className="mb-4">
                    <div className={`border border-base-300 rounded-lg bg-base-100 p-4 ${isTokenGroupSelected ? 'bg-light-green' : ''}`}>
                        <div
                            className={`text-xl font-medium flex items-center justify-between mb-4 cursor-pointer p-2 rounded
                            ${isTokenGroupSelected ? 'bg-light-green' : 'hover-light-green'}`}
                            onClick={() => toggleGroupSelection(allPositionsInGroup)}
                        >
                            <span className="text-base-content">{tokenGroup.tokenX}</span>
                        </div>
                        <div>
                            {tokenGroup.pairs.map((pair, pairIndex) => {
                                const pairPositions = pair.pools.flatMap(pool =>
                                    positionsWithDates.get(pool.key)?.map(pos => pos.publicKey.toString()) || []
                                );

                                const isPairSelected = isGroupSelected(pairPositions);

                                return (
                                    <div key={`pair-${tokenGroupIndex}-${pairIndex}`} className={`mt-4 first:mt-0 ${isPairSelected ? 'bg-light-green' : ''}`}>
                                        {tokenGroup.pairs.length > 1 && (
                                            <div
                                                className={`text-lg font-medium text-base-content mb-2 cursor-pointer p-2 rounded
                                                ${isPairSelected ? 'bg-light-green' : 'hover-light-green'}`}
                                                onClick={() => toggleGroupSelection(pairPositions)}
                                            >
                                                {pair.pairName}
                                            </div>
                                        )}
                                        {pair.pools.map(({key, value}) => {
                                            const poolInfo = poolInfoMap.get(key);
                                            const positions = positionsWithDates.get(key) || [];
                                            const dailyYield = poolInfo?.liquidity && poolInfo?.fees_24h
                                                ? (poolInfo.fees_24h / parseFloat(poolInfo.liquidity)) * 100
                                                : 0;

                                            return (
                                                <div key={`${key}-header`} className="mb-4">
                                                    <div
                                                        className="bg-base-200 shadow-sm rounded-lg p-3 w-full max-w-4xl mx-auto">
                                                        {/* Main header - always visible */}
                                                        <div className="flex flex-wrap justify-between items-center mb-2">
                                                            <a
                                                                href={`https://app.meteora.ag/dlmm/${key}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="group flex items-center space-x-2 transition-all duration-300 ease-in-out hover:bg-gray-100 rounded-md px-2 py-1"
                                                            >
                                                                <Image
                                                                    src="https://app.meteora.ag/icons/logo.svg"
                                                                    alt="Meteora"
                                                                    width={20}
                                                                    height={20}
                                                                    className="transition-transform duration-300 group-hover:rotate-12"
                                                                />
                                                                <span
                                                                    className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors duration-300">
                                                            {poolInfo?.name || key}
                                                        </span>
                                                            </a>
                                                            <div className="text-sm font-medium text-gray-600">
                                                                {value.nameY} per {value.nameX} {prettifyNumber(poolInfo?.current_price || 0)}
                                                            </div>
                                                        </div>

                                                        {/* Key metrics - always visible */}
                                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                                                            <div>
                                                                <div className="text-xs text-gray-500">Liquidity</div>
                                                                <div
                                                                    className="font-semibold">{formatCurrency(poolInfo?.liquidity || 0)}</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-xs text-gray-500">24h Volume</div>
                                                                <div
                                                                    className="font-semibold">{formatCurrency(poolInfo?.trade_volume_24h || 0)}</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-xs text-gray-500">24h Fees</div>
                                                                <div
                                                                    className="font-semibold">{formatCurrency(poolInfo?.fees_24h || 0)}</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-xs text-gray-500">Daily Yield</div>
                                                                <div
                                                                    className="font-semibold">{prettifyNumber(dailyYield, true)}%
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div
                                                            className="mt-2 relative h-5 bg-gray-100 rounded-full overflow-hidden">
                                                            <div
                                                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-yellow-200 to-red-600 transition-all duration-500 ease-out"
                                                                style={{width: `${poolInfo?.liquidityDistribution.percentX}%`}}
                                                            />
                                                            <div
                                                                className="absolute inset-y-0 right-0 bg-gradient-to-l from-emerald-50 to-emerald-300 transition-all duration-500 ease-out"
                                                                style={{width: `${poolInfo?.liquidityDistribution.percentY}%`}}
                                                            />
                                                            <div
                                                                className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
                                                                {value.nameX} {prettifyNumber(poolInfo?.liquidityDistribution.percentX)}%
                                                                / {value.nameY} {prettifyNumber(poolInfo?.liquidityDistribution.percentY)}%
                                                            </div>
                                                        </div>

                                                        <details>
                                                            <summary
                                                                className="cursor-pointer text-sm font-medium mt-2">Pool
                                                                Settings
                                                            </summary>
                                                            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                                                <div>Bin Step</div>
                                                                <div>{poolInfo?.bin_step}</div>
                                                                <div>Base Fee</div>
                                                                <div>{poolInfo?.base_fee_percentage}%</div>
                                                                <div>Max Fee</div>
                                                                <div>{poolInfo?.max_fee_percentage}%</div>
                                                            </div>
                                                        </details>
                                                    </div>
                                                    {/* Position header and rows */}
                                                    <div className="mt-4 w-full max-w-4xl mx-auto">
                                                        {/* Table for larger screens */}
                                                        <div className="hidden md:block overflow-x-auto">
                                                            <table className="table table-compact w-full text-xs">
                                                                <thead>
                                                                <tr className="border-b">
                                                                    {['LAST UPDATED', 'TOKENS', 'LIQUIDITY', 'UNCLAIMED FEES', 'CLAIMED FEES', 'RANGE'].map((header, index) => (
                                                                        <th key={index}
                                                                            className="text-left px-2 py-3 border-r last:border-r-0 whitespace-nowrap">
                                                                            {header}
                                                                        </th>
                                                                    ))}
                                                                </tr>
                                                                </thead>
                                                                <tbody>
                                                                {positions.map((position, index) => (
                                                                    <tr
                                                                        key={`${key}-${index}`}
                                                                        className={`border-b last:border-b-0 cursor-pointer transition-colors duration-200
            ${selectedPositions.has(position.publicKey.toString())
                                                                            ? 'bg-light-green'
                                                                            : 'hover-light-green'
                                                                        }`}
                                                                        onClick={() => togglePositionSelection(position.publicKey.toString())}
                                                                    >
                                                                        <td className="px-2 py-2 border-r whitespace-nowrap">
                                                                            {formatDistanceToNow(position.lastUpdatedAt, {
                                                                                addSuffix: true,
                                                                                includeSeconds: true
                                                                            })}
                                                                        </td>
                                                                        <td className="px-2 py-2 border-r whitespace-nowrap">
                                                                            <div>{value.nameX}</div>
                                                                            <div>{value.nameY}</div>
                                                                        </td>
                                                                        <td className="text-right px-2 py-2 border-r whitespace-nowrap">
                                                                            <div>{prettifyNumber(position.totalXAmount)}</div>
                                                                            <div>{prettifyNumber(position.totalYAmount)}</div>
                                                                        </td>
                                                                        <td className="text-right px-2 py-2 border-r whitespace-nowrap">
                                                                            <div>{prettifyNumber(position.feeX)}</div>
                                                                            <div>{prettifyNumber(position.feeY)}</div>
                                                                        </td>
                                                                        <td className="text-right px-2 py-2 border-r whitespace-nowrap">
                                                                            <div>{prettifyNumber(position.claimedFeeX || 0)}</div>
                                                                            <div>{prettifyNumber(position.claimedFeeY || 0)}</div>
                                                                        </td>
                                                                        <td className="px-2 py-2 border-r">
                                                                            {position.lowerBinId !== undefined && position.upperBinId !== undefined && value.activeBin !== undefined ? (
                                                                                <div
                                                                                    className={`range-indicator-${position.lowerBinId}-${position.upperBinId} w-24`}>
                                                                                    <RangeIndicator
                                                                                        position={position}
                                                                                        activeBin={value.activeBin}
                                                                                        binStep={poolInfo?.bin_step || 0}
                                                                                        mintXDigits={poolInfo?.tokenXDecimal || 0}
                                                                                        mintYDigits={poolInfo?.tokenYDecimal || 0}
                                                                                    />
                                                                                </div>
                                                                            ) : (
                                                                                'N/A'
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                        {/* Cards for smaller screens */}
                                                        <div className="md:hidden space-y-4">
                                                            {positions.map((position, index) => (
                                                                <div
                                                                    key={`${key}-${index}`}
                                                                    className={`shadow rounded-lg p-4 text-xs cursor-pointer transition-all duration-200
            ${selectedPositions.has(position.publicKey.toString())
                                                                        ? 'bg-light-green ring-2 ring-green-300'
                                                                        : 'hover-light-green'
                                                                    }
        bg-base-100
    `}
                                                                    onClick={() => togglePositionSelection(position.publicKey.toString())}
                                                                >
                                                                    <div
                                                                        className="mb-2 text-sm text-base-content opacity-70">
                                                                        Last
                                                                        Updated: {formatDistanceToNow(position.lastUpdatedAt, {
                                                                        addSuffix: true,
                                                                        includeSeconds: true
                                                                    })}
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <div>
                                                                        <span
                                                                            className="font-semibold">Liquidity:</span>
                                                                            <div>{prettifyNumber(position.totalXAmount)} {value.nameX}</div>
                                                                            <div>{prettifyNumber(position.totalYAmount)} {value.nameY}</div>
                                                                        </div>
                                                                        <div>
                                                                        <span
                                                                            className="font-semibold">Unclaimed Fees:</span>
                                                                            <div>{prettifyNumber(position.feeX)} {value.nameX}</div>
                                                                            <div>{prettifyNumber(position.feeY)} {value.nameY}</div>
                                                                        </div>
                                                                        <div>
                                                                        <span
                                                                            className="font-semibold">Claimed Fees:</span>
                                                                            <div>{prettifyNumber(position.claimedFeeX || 0)} {value.nameX}</div>
                                                                            <div>{prettifyNumber(position.claimedFeeY || 0)} {value.nameY}</div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="mt-2">
                                                                        <span className="font-semibold">Range:</span>
                                                                        {position.lowerBinId !== undefined && position.upperBinId !== undefined && value.activeBin !== undefined ? (
                                                                            <div
                                                                                className={`range-indicator-${position.lowerBinId}-${position.upperBinId}`}>
                                                                                <RangeIndicator
                                                                                    position={position}
                                                                                    activeBin={value.activeBin}
                                                                                    binStep={poolInfo?.bin_step || 0}
                                                                                    mintXDigits={poolInfo?.tokenXDecimal || 0}
                                                                                    mintYDigits={poolInfo?.tokenYDecimal || 0}
                                                                                />
                                                                            </div>
                                                                        ) : (
                                                                            'N/A'
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            );
        });
    };

    return (
        <div className="p-4">
            {createTableRows()}
            {selectedPositions.size > 0 && (
                <div className="fixed bottom-4 right-4 flex space-x-2">
                    <button
                        onClick={() => setSelectedPositions(new Set())}
                        className="btn btn-circle btn-error"
                    >
                        <FaTimes/>
                    </button>
                    <button
                        onClick={openSelectedPositions}
                        className="btn btn-circle btn-primary"
                    >
                        <FaChartBar/>
                    </button>
                </div>
            )}
        </div>
    );
};

export default TableComponent;
