// app/utils/rpcSettings.ts
import {config} from '@/app/utils/config';

const CUSTOM_RPC_STORAGE_KEY = 'customRpcEndpoint';

export function getCustomRpcEndpoint(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const value = localStorage.getItem(CUSTOM_RPC_STORAGE_KEY)?.trim();
        if (value && /^https?:\/\//i.test(value)) {
            return value;
        }
    } catch {
        // localStorage unavailable (private mode etc.)
    }
    return null;
}

export function setCustomRpcEndpoint(url: string): void {
    localStorage.setItem(CUSTOM_RPC_STORAGE_KEY, url.trim());
}

export function clearCustomRpcEndpoint(): void {
    localStorage.removeItem(CUSTOM_RPC_STORAGE_KEY);
}

export function isValidRpcUrl(url: string): boolean {
    try {
        const parsed = new URL(url.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

// Custom endpoint from localStorage wins over the build-time default
export function getRpcEndpoint(): string {
    return getCustomRpcEndpoint() ?? config.RPC_ENDPOINT;
}
