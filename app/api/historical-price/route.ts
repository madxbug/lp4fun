// app/api/historical-price/route.ts
import {NextRequest, NextResponse} from 'next/server';

const BASE_URL = 'https://public-api.birdeye.so/defi/history_price';
const REQUIRED_PARAMS = ['address', 'address_type', 'type', 'time_from', 'time_to'];

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const params = Object.fromEntries(request.nextUrl.searchParams);
        validateParams(params);

        const url = buildUrl(params);
        const data = await fetchData(url);

        return NextResponse.json(data);
    } catch (error) {
        console.error('Error fetching historical price data:', error);
        return handleError(error);
    }
}

function validateParams(params: Record<string, string>): void {
    const missingParams = REQUIRED_PARAMS.filter(param => !params[param]);
    if (missingParams.length > 0) {
        throw new ValidationError(`Missing required parameters: ${missingParams.join(', ')}`);
    }
}

function buildUrl(params: Record<string, string>): string {
    const urlParams = new URLSearchParams(params);
    return `${BASE_URL}?${urlParams}`;
}

async function fetchData(url: string): Promise<any> {
    const response = await fetch(url, {
        headers: {
            'x-chain': 'solana',
            'x-api-key': process.env.BIRDEYE_API_KEY || ''
        }
    });

    if (!response.ok) {
        throw new FetchError(`HTTP error! status: ${response.status}`);
    }

    return response.json();
}

function handleError(error: unknown): NextResponse {
    if (error instanceof ValidationError) {
        return NextResponse.json({error: error.message}, {status: 400});
    } else if (error instanceof FetchError) {
        return NextResponse.json({error: 'Failed to fetch data'}, {status: 502});
    } else {
        return NextResponse.json({error: 'An unexpected error occurred'}, {status: 500});
    }
}

class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

class FetchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FetchError';
    }
}