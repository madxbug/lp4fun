// app/utils/rateLimitedFetch.ts
import { config } from "@/app/utils/config";

export const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

class RateLimiter {
    private queue: Array<() => void> = [];
    private isProcessing: boolean = false;
    private lastCallTime: number = 0;
    private callInterval: number = 0;

    constructor(callsPerSecond: number) {
        this.callInterval = 1000 / callsPerSecond;
    }

    async limit(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    private async processQueue() {
        this.isProcessing = true;
        while (this.queue.length > 0) {
            const now = Date.now();
            const timeToWait = Math.max(0, this.lastCallTime + this.callInterval - now);
            if (timeToWait > 0) {
                await delay(timeToWait);
            }
            this.lastCallTime = Date.now();
            const next = this.queue.shift();
            if (next) {
                next();
            }
        }
        this.isProcessing = false;
    }
}

const rateLimiter = new RateLimiter(10);

export async function fetchWithRetry<T>(
    fetchFunc: () => Promise<T>,
    options: {
        maxRetries?: number,
        initialDelay?: number,
        useRateLimiter?: boolean
    } = {}
): Promise<T> {
    const {
        maxRetries = config.MAX_RETRIES,
        initialDelay = config.INITIAL_RETRY_DELAY,
        useRateLimiter = false
    } = options;
    for (let retries = 0; retries < maxRetries; retries++) {
        try {
            if (useRateLimiter) {
                await rateLimiter.limit();
            }
            return await fetchFunc();
        } catch (error) {
            if (retries === maxRetries - 1) {
                console.error('Max retries reached, throwing error', error);
                throw error;
            }
            const baseDelay = initialDelay * Math.pow(2, retries);
            const jitter = 500 * (1 + Math.random());
            const delayTime = Math.floor(baseDelay + jitter);
            const timestamp = new Date().toISOString();
            console.warn(`[${timestamp}] Retry attempt ${retries + 1} after ${delayTime}ms delay due to ${error}`);
            await delay(delayTime);
        }
    }
    throw new Error("Max retries reached");
}
