// app/page.tsx
'use client';

import React, {useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {isValidSolanaAddress} from "@/app/utils/validation";

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
    );
};

export default Home;
