// app/layout.tsx
import {Inter} from "next/font/google";
import "./globals.css";
import {ThemeProvider} from './contexts/ThemeContext';
import ThemeToggle from './components/ThemeToggle';
import React from "react";
import { Analytics } from "@vercel/analytics/react";
import {SpeedInsights} from "@vercel/speed-insights/next";

const inter = Inter({subsets: ["latin"]});

export const metadata = {
    title: "DLMM live data",
    description: "DLMM positions viewer",
};

export default function RootLayout({children}: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
        <head>
            <script
                dangerouslySetInnerHTML={{
                    __html: `
              (function() {
                function getInitialTheme() {
                  const savedTheme = localStorage.getItem('theme');
                  if (savedTheme) return savedTheme;
                  
                  return window.matchMedia('(prefers-color-scheme: dark)').matches 
                    ? 'dark' 
                    : 'light';
                }
                document.documentElement.setAttribute('data-theme', getInitialTheme());
              })();
            `,
                }}
            />
        </head>
        <body className={`${inter.className} min-h-screen bg-base-100 text-base-content`}>
        <ThemeProvider>
            <div className="absolute top-4 right-4">
                <ThemeToggle/>
            </div>
            <div className="min-h-screen flex flex-col">
                <main className="flex-grow flex justify-center items-center p-5">
                    {children}
                </main>
            </div>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
        </body>
        </html>
    );
}