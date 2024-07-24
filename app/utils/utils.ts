function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithRetry<T>(fetchFunc: () => Promise<T>, maxRetries = 5, initialDelay = 1000): Promise<T> {
    let retries = 0;
    while (true) {
        try {
            return await fetchFunc();
        } catch (error) {
            if (retries >= maxRetries || !(error instanceof Error) || !error.message.includes('too many requests')) {
                throw error;
            }
            retries++;
            const delayTime = initialDelay * Math.pow(2, retries - 1);
            console.log(`Retry attempt ${retries} after ${delayTime}ms delay`);
            await delay(delayTime);
        }
    }
}
