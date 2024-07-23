// app/wallet/[walletPubKey]/RangeIndicator.tsx
import React from 'react';
import {Tooltip} from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import {useTheme} from '../../contexts/ThemeContext';
import {getPriceFromBinId} from "@/app/utils/solana";

interface RangeIndicatorProps {
    position: { lowerBinId: number; upperBinId: number };
    activeBin: number;
    binStep: number;
    mintXDigits: number;
    mintYDigits: number;
}

const RangeIndicator: React.FC<RangeIndicatorProps> = ({position, activeBin, binStep, mintXDigits, mintYDigits}) => {
    const {theme} = useTheme();
    const {lowerBinId, upperBinId} = position;
    const isInRange = activeBin >= lowerBinId && activeBin <= upperBinId;

    const getVisualElement = () => {
        const baseLineClass = "w-full h-2 bg-gray-300 rounded-full relative";
        const indicatorClass = "absolute top-1/2 h-4 w-1 rounded-full transform -translate-y-1/2";

        let indicatorColor = "bg-green-500";
        let indicatorPosition = "50%";

        if (activeBin < lowerBinId) {
            indicatorColor = "bg-red-500";
            indicatorPosition = "0%";
        } else if (activeBin > upperBinId) {
            indicatorColor = "bg-yellow-500";
            indicatorPosition = "100%";
        } else {
            indicatorPosition = `${((activeBin - lowerBinId) / (upperBinId - lowerBinId)) * 100}%`;
        }

        return (
            <div className={baseLineClass}>
                <div
                    className={`${indicatorClass} ${indicatorColor}`}
                    style={{left: indicatorPosition}}
                />
            </div>
        );
    };

    const rangeColor = isInRange ? 'text-green-500' : 'text-red-500';

    const tooltipContent = `
    <div class="font-sans text-sm leading-relaxed ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-gray-800'} rounded-lg p-3 shadow-md">
        <div class="mb-2">
            <span class="font-medium">Current Price:</span> 
            <span class="text-blue-500 font-medium">${getPriceFromBinId(activeBin, binStep, mintXDigits, mintYDigits).toFixed(6)}</span>
        </div>
        <div>
            <span class="font-medium">Active Range:</span> 
            <span class="${rangeColor} font-medium">${getPriceFromBinId(lowerBinId, binStep, mintXDigits, mintYDigits).toFixed(6)} → ${getPriceFromBinId(upperBinId, binStep, mintXDigits, mintYDigits).toFixed(6)}</span>
        </div>
    </div>
    `;

    return (
        <div className="w-full py-2">
            <div
                className="hover:opacity-75 transition-opacity duration-200"
                data-tooltip-id={`range-tooltip-${lowerBinId}-${upperBinId}`}
                data-tooltip-html={tooltipContent}
            >
                {getVisualElement()}
            </div>
            <Tooltip
                id={`range-tooltip-${lowerBinId}-${upperBinId}`}
                place="top"
                className="!bg-transparent !border-none !p-0"
            />
        </div>
    );
};

export default RangeIndicator;