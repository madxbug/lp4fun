'use client';

import React, {useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {isValidSolanaAddress} from "@/app/utils/validation";
import Link from 'next/link';

interface WalletGroup {
    id: string;
    name: string;
    wallets: string[];
}

interface FormState {
    walletPubKey: string;
    error: string;
}

interface GroupFormState {
    id: string;
    name: string;
    wallets: string;
    error: string;
}

const Home = () => {
    const [formState, setFormState] = useState<FormState>({walletPubKey: '', error: ''});
    const [history, setHistory] = useState<(string | WalletGroup)[]>([]);
    const [groups, setGroups] = useState<WalletGroup[]>([]);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [groupFormState, setGroupFormState] = useState<GroupFormState>({id: '', name: '', wallets: '', error: ''});
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const storedHistory = localStorage.getItem('walletHistory');
        const storedGroups = localStorage.getItem('walletGroups');
        if (storedHistory) setHistory(JSON.parse(storedHistory));
        if (storedGroups) setGroups(JSON.parse(storedGroups));
    }, []);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const {walletPubKey} = formState;

        if (!walletPubKey) return;

        const wallets = walletPubKey.split(',').map(w => w.trim());
        const invalidWallets: string[] = [];

        for (const wallet of wallets) {
            const isValid = await isValidSolanaAddress(wallet);
            if (!isValid) {
                invalidWallets.push(wallet);
            }
        }

        if (invalidWallets.length > 0) {
            setFormState(prev => ({...prev, error: `Invalid wallet address(es): ${invalidWallets.join(', ')}`}));
            return;
        }

        const existingGroup = groups.find(b => b.wallets.join(',') === walletPubKey);
        if (existingGroup) {
            updateHistory(existingGroup);
        } else {
            updateHistory(walletPubKey);
        }

        router.push(`/wallet/${walletPubKey}`);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormState({walletPubKey: e.target.value, error: ''});
    };

    const updateHistory = (newItem: string | WalletGroup) => {
        const updatedHistory = [newItem, ...history.filter(item =>
            typeof item === 'string'
                ? item !== newItem
                : typeof newItem === 'object'
                    ? item.id !== newItem.id
                    : true
        )].slice(0, 20);
        setHistory(updatedHistory);
        localStorage.setItem('walletHistory', JSON.stringify(updatedHistory));
    };

    const clearInput = () => {
        setFormState({walletPubKey: '', error: ''});
        if (inputRef.current) {
            inputRef.current.value = '';
            inputRef.current.focus();
        }
    };

    const openGroupModal = () => {
        const wallets = formState.walletPubKey.split(',').map(w => w.trim()).join('\n');
        setGroupFormState({id: '', name: '', wallets, error: ''});
        setShowGroupModal(true);
    };

    const handleGroupInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const {name, value} = e.target;
        setGroupFormState(prev => ({...prev, [name]: value, error: ''}));
    };

    const saveGroup = async () => {
        const {id, name, wallets} = groupFormState;
        if (!name.trim()) {
            setGroupFormState(prev => ({...prev, error: 'Group name is required'}));
            return;
        }
        const walletSet = new Set(wallets.split('\n').map(w => w.trim()).filter(w => w !== ''));
        const walletList = Array.from(walletSet);
        if (walletList.length === 0) {
            setGroupFormState(prev => ({...prev, error: 'At least one wallet address is required'}));
            return;
        }

        // Check for existing group name (excluding the current group if updating)
        if (groups.some(g => g.name.toLowerCase() === name.trim().toLowerCase() && g.id !== id)) {
            setGroupFormState(prev => ({...prev, error: 'A group with this name already exists'}));
            return;
        }

        let hasErrors = false;

        for (const wallet of walletList) {
            const isValid = await isValidSolanaAddress(wallet);
            if (!isValid) {
                hasErrors = true;
                break;
            }
        }

        if (hasErrors) {
            setGroupFormState(prev => ({...prev, error: 'One or more wallet addresses are invalid'}));
            return;
        }

        const newGroup: WalletGroup = {
            id: id || Date.now().toString(),
            name: name.trim(),
            wallets: walletList
        };

        let updatedGroups;
        if (id) {
            updatedGroups = groups.map(g => g.id === id ? newGroup : g);
        } else {
            updatedGroups = [...groups, newGroup];
        }

        setGroups(updatedGroups);
        localStorage.setItem('walletGroups', JSON.stringify(updatedGroups));

        updateHistory(newGroup);
        setShowGroupModal(false);
        setFormState({walletPubKey: newGroup.wallets.join(','), error: ''});
    };

    const loadGroup = (group: WalletGroup) => {
        setFormState({walletPubKey: group.wallets.join(','), error: ''});
    };

    const showDropdown = !formState.walletPubKey && history.length > 0;

    return (
        <>
            <div className="w-full max-w-md mx-auto relative">
                <div className="mb-2 flex justify-end">
                    <button
                        onClick={openGroupModal}
                        className="btn btn-ghost btn-circle btn-sm"
                        title="Create Wallet Group"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24"
                             stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                  d="M3 4h6v6H3V4zM15 4h6v6h-6V4zM3 14h6v6H3v-6zM15 14h6v6h-6v-6z"/>
                        </svg>

                    </button>
                </div>

                <div className="relative">
                    <form onSubmit={handleSubmit} className="relative">
                        <div className="relative">
                            <input
                                ref={inputRef}
                                type="text"
                                value={formState.walletPubKey}
                                onChange={handleInputChange}
                                placeholder="Solana wallet address(es) or domain(s) here"
                                className="input input-bordered w-full pr-12 pl-12"
                                autoComplete="off"
                                style={{fontFamily: 'Open Sans, sans-serif'}}
                            />
                            <button
                                type="button"
                                onClick={clearInput}
                                className="absolute left-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-circle btn-sm"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none"
                                     viewBox="0 0 24 24"
                                     stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                          d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                            <button
                                type="submit"
                                className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-circle btn-sm"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none"
                                     viewBox="0 0 24 24"
                                     stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                                </svg>
                            </button>
                        </div>
                    </form>
                    {formState.error && (
                        <p className="text-error mt-1 text-sm absolute left-0 right-0">
                            {formState.error}
                        </p>
                    )}
                    {showDropdown && (
                        <div className="bg-base-200 rounded-box mt-1 max-h-60 overflow-y-auto absolute w-full z-10">
                            {history.map((item, index) => (
                                <button
                                    key={`history-${index}`}
                                    onClick={() => {
                                        if (typeof item === 'string') {
                                            setFormState({walletPubKey: item, error: ''});
                                        } else {
                                            loadGroup(item);
                                        }
                                    }}
                                    className="btn btn-ghost w-full justify-start text-left text-sm font-normal"
                                >
                                    {typeof item === 'string' ? item : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 inline"
                                                 fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                                            </svg>
                                            {item.name}</>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {showGroupModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                        <div className="bg-base-100 rounded-lg p-6 w-full max-w-md">
                            <h3 className="font-bold text-lg mb-4">Create Wallet Group</h3>
                            <input
                                type="text"
                                name="name"
                                placeholder="Enter group name"
                                className="input input-bordered w-full mb-4"
                                value={groupFormState.name}
                                onChange={handleGroupInputChange}
                                autoComplete="off"
                            />
                            <textarea
                                name="wallets"
                                className="textarea textarea-bordered w-full h-24 mb-4 text-xs"
                                placeholder="Enter wallet addresses (one per line)"
                                value={groupFormState.wallets}
                                onChange={handleGroupInputChange}
                            />
                            <div className="flex justify-end space-x-2">
                                <button onClick={() => setShowGroupModal(false)} className="btn btn-ghost">Cancel</button>
                                <button onClick={saveGroup} className="btn btn-accent">Create Group</button>
                            </div>
                            {groupFormState.error && (
                                <p className="text-error mt-2 text-sm">{groupFormState.error}</p>
                            )}
                        </div>
                    </div>
                )}

            </div>
            <footer className="fixed bottom-0 left-0 right-0 p-4">
                <div className="container mx-auto flex justify-center items-center space-x-4">
                    <span className="text-base-content text-sm font-medium">Made with <span
                        className="beating-heart">💗</span> for the Meteora Community</span>
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
