import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { Outfit, Inter, Geist_Mono } from 'next/font/google';
import { APP_NAME } from '@elogbook/shared';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-heading' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Electronic logbook for medical residents',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F2F2F7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const nonce = headersList.get('x-nonce') ?? '';
  const locale = await getLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} className={`${outfit.variable} ${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {nonce ? (
          <script nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark'}document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(t)}catch(e){}`,
            }}
          />
        ) : null}
      </head>
      <body suppressHydrationWarning>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg">
          Skip to content
        </a>
        <ErrorBoundary>
          <NextIntlClientProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </NextIntlClientProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
