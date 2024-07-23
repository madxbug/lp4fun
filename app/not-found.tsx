// app/not-found.tsx
import Link from 'next/link';
import {HomeIcon} from '@heroicons/react/24/solid';

const NotFound = () => {
    return (
        <div
            className="min-h-screen flex flex-col justify-center items-center bg-inherit text-gray-900 dark:text-gray-100">
            <h1 className="text-6xl font-bold mb-4">404</h1>
            <p className="text-2xl mb-8">Page Not Found</p>
            <Link href="/"
                  className="flex items-center gap-2 text-sky-600 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300">
                <HomeIcon className="w-6 h-6"/>
                <span>Go Home</span>
            </Link>
        </div>
    );
};

export default NotFound;
