// app/components/Trend.tsx
import React from 'react';

interface TrendData {
    min_30: number;
    hour_1: number;
    hour_2: number;
    hour_4: number;
    hour_12: number;
    hour_24: number;
}

interface CompactTrendProps {
    data: TrendData;
}

interface NormalizedPeriod {
    label: string;
    per30min: number;
    baseline: number;
    isAbove: boolean;
}

export const CompactTrendBars: React.FC<CompactTrendProps> = ({ data }) => {
    // Normalize everything to 30-minute units
    const baseline30min = data.hour_24 / 48; // 24 hours = 48 thirty-minute periods

    const periods: NormalizedPeriod[] = [
        {
            label: "24h",
            per30min: data.hour_24 / 48,
            baseline: baseline30min,
            isAbove: true // baseline, neutral
        },
        {
            label: "12h",
            per30min: data.hour_12 / 24,
            baseline: baseline30min,
            get isAbove() { return this.per30min >= this.baseline; }
        },
        {
            label: "4h",
            per30min: data.hour_4 / 8,
            baseline: baseline30min,
            get isAbove() { return this.per30min >= this.baseline; }
        },
        {
            label: "2h",
            per30min: data.hour_2 / 4,
            baseline: baseline30min,
            get isAbove() { return this.per30min >= this.baseline; }
        },
        {
            label: "1h",
            per30min: data.hour_1 / 2,
            baseline: baseline30min,
            get isAbove() { return this.per30min >= this.baseline; }
        },
        {
            label: "30m",
            per30min: data.min_30,
            baseline: baseline30min,
            get isAbove() { return this.per30min >= this.baseline; }
        }
    ];

    // Get all values for normalization
    const values = periods.map(p => p.per30min);
    const maxValue = Math.max(...values, baseline30min);
    const minValue = Math.min(...values, 0);
    const range = maxValue - minValue || 1;

    // Normalize points for SVG (0 to 1 range)
    const normalizedPoints = values.map((value: number) => (value - minValue) / range);
    const normalizedBaseline = (baseline30min - minValue) / range;

    return (
        <svg
            width="80"
            height="28"
            viewBox="0 0 80 28"
            className="inline-block"
        >
            {/* Baseline reference line */}
            <line
                x1="0"
                y1={24 - (normalizedBaseline * 20)}
                x2="80"
                y2={24 - (normalizedBaseline * 20)}
                stroke="#94a3b8"
                strokeWidth="0.5"
                strokeDasharray="2 2"
                opacity="0.5"
            />

            {/* Line segments with individual colors */}
            {normalizedPoints.map((value: number, index: number) => {
                if (index === 0) return null; // Skip first point for segments

                const prevValue = normalizedPoints[index - 1];
                const x1 = ((index - 1) / (normalizedPoints.length - 1)) * 80;
                const y1 = 24 - (prevValue * 20);
                const x2 = (index / (normalizedPoints.length - 1)) * 80;
                const y2 = 24 - (value * 20);

                // Color based on current point vs baseline
                const isAbove = periods[index].isAbove;
                const segmentColor = isAbove ? '#10b981' : '#ef4444';
                const areaOpacity = isAbove ? 0.1 : 0.15;

                // Create gradient area for this segment
                const baselineY = 24 - (normalizedBaseline * 20);
                const areaPath = `M ${x1},${baselineY} L ${x1},${y1} L ${x2},${y2} L ${x2},${baselineY} Z`;

                return (
                    <g key={`segment-${index}`}>
                        {/* Area fill */}
                        <path
                            d={areaPath}
                            fill={segmentColor}
                            opacity={areaOpacity}
                        />
                        {/* Line segment */}
                        <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={segmentColor}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                        />
                    </g>
                );
            })}

            {/* Dots at each point */}
            {normalizedPoints.map((value: number, index: number) => {
                const x = (index / (normalizedPoints.length - 1)) * 80;
                const y = 24 - (value * 20);
                const period = periods[index];
                const dotColor = period.isAbove ? '#10b981' : '#ef4444';
                const percentDiff = ((period.per30min - period.baseline) / period.baseline) * 100;

                return (
                    <circle
                        key={index}
                        cx={x}
                        cy={y}
                        r="2.5"
                        fill={dotColor}
                        stroke="white"
                        strokeWidth="0.5"
                    >
                        <title>{`${period.label}: ${period.per30min.toFixed(6)} per 30m\nBaseline: ${baseline30min.toFixed(6)}\n${percentDiff >= 0 ? '+' : ''}${percentDiff.toFixed(1)}%`}</title>
                    </circle>
                );
            })}
        </svg>
    );
};