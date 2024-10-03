// app/utils/birdeye.ts
import {AddressType, HistoricalPriceData, TimeInterval} from "@/app/types";

const MAX_DATA_POINTS = 999;
const SECONDS_PER_MINUTE = 60;

export async function getHistoricalPrice(
    address: string,
    addressType: AddressType,
    type: TimeInterval,
    fromBlockTime: number,
    toBlockTime: number
): Promise<HistoricalPriceData> {
    /*
    FIXME: consider using some approximation on price inside interval, like if we have 15 minutes
        chart and operation happen at 32 minutes, 30 minutes price will be taken, but maybe it more correct
        to take 45m-price minus 30m-price divided by 2, like average, or gmean,
        check which method is better and more accurate statistically
     */
    if (toBlockTime - fromBlockTime < SECONDS_PER_MINUTE) {
        toBlockTime += SECONDS_PER_MINUTE;
    }
    const params = new URLSearchParams({
        address,
        address_type: addressType,
        type,
        time_from: fromBlockTime.toString(),
        time_to: toBlockTime.toString()
    });

    const url = `/api/historical-price?${params}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching historical price data:', error);
        throw error;
    }
}

export function determineOptimalTimeInterval(fromBlockTime: number, toBlockTime: number): TimeInterval {
    const totalDurationMinutes = (toBlockTime - fromBlockTime) / SECONDS_PER_MINUTE;
    const targetIntervalMinutes = Math.ceil(totalDurationMinutes / MAX_DATA_POINTS);

    const availableIntervals: [number, TimeInterval][] = [
        [1, '1m'], [3, '3m'], [5, '5m'], [15, '15m'], [30, '30m'],
        [60, '1H'], [120, '2H'], [240, '4H'], [360, '6H'], [480, '8H'], [720, '12H'],
        [1440, '1D'], [4320, '3D'], [10080, '1W'], [43200, '1M']
    ];

    for (const [minutes, interval] of availableIntervals) {
        if (minutes >= targetIntervalMinutes) {
            return interval;
        }
    }

    return '1M';
}

export function determineIntervalIndex(initBlockTime: number, interval: TimeInterval, targetBlockTime: number): number {
    const intervalSeconds = convertIntervalToSeconds(interval);
    const timeDifference = targetBlockTime - initBlockTime;
    const index = Math.floor(timeDifference / intervalSeconds);
    return Math.max(0, index);
}

function convertIntervalToSeconds(interval: TimeInterval): number {
    const [value, unit] = interval.match(/(\d+)(\w+)/)?.slice(1) || [];
    const numericValue = parseInt(value, 10);

    const SECONDS_PER_HOUR = 3600;
    const SECONDS_PER_DAY = 86400;

    switch (unit) {
        case 'm':
            return numericValue * SECONDS_PER_MINUTE;
        case 'H':
            return numericValue * SECONDS_PER_HOUR;
        case 'D':
            return numericValue * SECONDS_PER_DAY;
        case 'W':
            return numericValue * 7 * SECONDS_PER_DAY;
        case 'M':
            return numericValue * 30 * SECONDS_PER_DAY; // Approximation
        default:
            throw new Error(`Invalid interval: ${interval}`);
    }
}
