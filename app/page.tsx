// app/page.tsx
'use client';

import React, {useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {isValidSolanaAddress} from "@/app/utils/validation";
import Link from 'next/link';

interface FormState {
    walletPubKey: string;
    error: string;
}

const Home = () => {
    const [formState, setFormState] = useState<FormState>({walletPubKey: '', error: ''});
    const [history, setHistory] = useState<string[]>([]);
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const storedHistory = typeof window !== 'undefined' ? localStorage.getItem('walletHistory') : null;
        if (storedHistory) {
            setHistory(JSON.parse(storedHistory));
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const {walletPubKey} = formState;

        if (!walletPubKey) return;

        const isValid = await isValidSolanaAddress(walletPubKey);
        if (!isValid) {
            setFormState(prev => ({...prev, error: 'Invalid Solana wallet address or domain'}));
            return;
        }

        const newHistory = [walletPubKey, ...history.filter(item => item !== walletPubKey)];
        setHistory(newHistory);
        if (typeof window !== 'undefined') {
            localStorage.setItem('walletHistory', JSON.stringify(newHistory));
        }
        router.push(`/wallet/${walletPubKey}`);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormState({walletPubKey: e.target.value, error: ''});
    };

    const clearInput = () => {
        setFormState({walletPubKey: '', error: ''});
        inputRef.current?.focus();
    };

    const showDropdown = !formState.walletPubKey && history.length > 0;

    return (
        <>
            <div className="w-full max-w-md relative">
                <form onSubmit={handleSubmit} className="relative">
                    <div className="relative h-12"> {/* Fixed height container */}
                        <input
                            ref={inputRef}
                            type="text"
                            value={formState.walletPubKey}
                            onChange={handleInputChange}
                            placeholder="Solana wallet address or domain here"
                            className="input input-bordered w-full h-12 px-12" // Fixed height and padding
                            autoComplete="off"
                            style={{fontFamily: 'Open Sans, sans-serif'}}
                        />
                        <button
                            type="button"
                            onClick={clearInput}
                            className={`absolute left-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-circle btn-sm ${
                                formState.walletPubKey ? 'opacity-100' : 'opacity-0 pointer-events-none'
                            }`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                      d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                        <button
                            type="submit"
                            className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-circle btn-sm"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                 stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                            </svg>
                        </button>
                    </div>
                    {formState.error && <p className="text-error mt-2 absolute">{formState.error}</p>}
                </form>
                {showDropdown && (
                    <ul className="menu bg-base-200 w-full rounded-box mt-1 max-h-60 overflow-y-auto absolute z-10">
                        {history.map((item, index) => (
                            <li key={index}>
                                <button
                                    onClick={() => setFormState({walletPubKey: item, error: ''})}
                                    className="truncate w-full text-left"
                                    style={{
                                        fontWeight: '400',
                                        fontFamily: 'inherit'
                                    }}
                                >
                                    {item}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <footer className="fixed bottom-0 left-0 right-0 p-4">
                <div className="container mx-auto flex justify-center items-center space-x-4">
                    <span className="text-base-content text-sm font-medium">Made with <span className="beating-heart">💗</span> for the Meteora Community</span>
                    <Link href="https://x.com/madxbug" target="_blank" rel="noopener noreferrer"
                          className="text-base-content hover:text-primary transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                             fill="currentColor">
                            <path
                                d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                    </Link>
                    <Link href="https://github.com/madxbug/lp4fun" target="_blank"
                          rel="noopener noreferrer" className="text-base-content hover:text-primary transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                             fill="currentColor">
                            <path
                                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                    </Link>
                </div>
            </footer>
        </>
    );
};

export default Home;
