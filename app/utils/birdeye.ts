// app/utils/birdeye.ts
import {AddressType, HistoricalPriceData, TimeInterval} from "@/app/types";

const MAX_DATA_POINTS = 999;

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

export function determineOptimalTimeInterval(fromDate: Date, toDate: Date): TimeInterval {
    const totalDurationMinutes = (toDate.getTime() - fromDate.getTime()) / (60 * 1000);
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

export function determineIntervalIndex(fromTime: Date, interval: TimeInterval, targetTime: Date): number {
    const intervalMs = convertIntervalToMs(interval);
    const timeDifference = targetTime.getTime() - fromTime.getTime();
    const index = Math.floor(timeDifference / intervalMs);
    return Math.max(0, index);
}

function convertIntervalToMs(interval: TimeInterval): number {
    const [value, unit] = interval.match(/(\d+)(\w+)/)?.slice(1) || [];
    const numericValue = parseInt(value, 10);

    const MS_PER_MINUTE = 60000;
    const MS_PER_HOUR = 3600000;
    const MS_PER_DAY = 86400000;

    switch (unit) {
        case 'm':
            return numericValue * MS_PER_MINUTE;
        case 'H':
            return numericValue * MS_PER_HOUR;
        case 'D':
            return numericValue * MS_PER_DAY;
        case 'W':
            return numericValue * 7 * MS_PER_DAY;
        case 'M':
            return numericValue * 30 * MS_PER_DAY; // Approximation
        default:
            throw new Error(`Invalid interval: ${interval}`);
    }
}
