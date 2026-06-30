import type { Metadata, Viewport } from 'next';
import { Outfit, Inter, Geist_Mono } from 'next/font/google';
import { APP_NAME } from '@elogbook/shared';
import ErrorBoundary from '@/components/ErrorBoundary';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-heading' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Electronic logbook for medical residents',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#060814',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${outfit.variable} ${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* U1.4: Apply persisted theme before hydration to avoid flash.
            This is a noop on the server (no window) — it runs in the browser. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(t==='light'?'light':'dark');}catch(e){}`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg">
          Skip to content
        </a>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
