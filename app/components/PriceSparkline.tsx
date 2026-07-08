// app/components/PriceSparkline.tsx
'use client';

import React, {useEffect, useState} from 'react';
import {fetchPoolOhlcv, OhlcvCandle} from '@/app/utils/meteoraDataAPI';
import {prettifyNumber} from '@/app/utils/numberFormatting';

interface PriceSparklineProps {
    poolAddress: string;
    days?: number;
    width?: number;
    height?: number;
}

// 7-day pool price line from the Meteora OHLCV endpoint (4h candles)
const PriceSparkline: React.FC<PriceSparklineProps> = ({poolAddress, days = 7, width = 110, height = 28}) => {
    const [candles, setCandles] = useState<OhlcvCandle[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        const startTime = Math.floor(Date.now() / 1000) - days * 86400;
        fetchPoolOhlcv(poolAddress, '4h', startTime).then(data => {
            if (!cancelled) setCandles(data);
        });
        return () => {
            cancelled = true;
        };
    }, [poolAddress, days]);

    if (!candles || candles.length < 2) {
        return null;
    }

    const closes = candles.map(c => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const isUp = closes[closes.length - 1] >= closes[0];
    const color = isUp ? '#10b981' : '#ef4444';

    const points = closes
        .map((v, i) => {
            const x = (i / (closes.length - 1)) * width;
            const y = height - 3 - ((v - min) / range) * (height - 6);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

    const pctChange = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block align-middle">
            <title>{`${days}d price: ${prettifyNumber(closes[0])} → ${prettifyNumber(closes[closes.length - 1])} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%)`}</title>
            <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
};

export default PriceSparkline;
