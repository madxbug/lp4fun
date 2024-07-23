// app/position/[[...positionPubKeys]]/page.tsx
'use client';
import React from 'react';
import { useParams } from 'next/navigation';
import PositionStatus from "./PositionStatus";

const DLMMPage = () => {
    const params = useParams();

    let positionPubKeys: string[] = [];

    if (params.positionPubKeys) {
        if (typeof params.positionPubKeys === 'string') {
            // Decode the URL-encoded string and split by comma
            positionPubKeys = decodeURIComponent(params.positionPubKeys).split(',');
        } else if (Array.isArray(params.positionPubKeys)) {
            // If it's an array, join all elements, decode, and then split
            positionPubKeys = decodeURIComponent(params.positionPubKeys.join(',')).split(',');
        }
    }

    // Trim whitespace from each key
    positionPubKeys = positionPubKeys.map(key => key.trim());

    if (positionPubKeys.length === 0) {
        return <div>No positions specified. Please provide at least one position public key.</div>;
    }

    return (
        <div className="container mx-auto my-8">
            <PositionStatus positionPubKeys={positionPubKeys} />
        </div>
    );
};

export default DLMMPage;