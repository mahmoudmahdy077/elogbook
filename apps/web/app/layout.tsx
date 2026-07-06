import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { Outfit, Inter, Geist_Mono } from 'next/font/google';
import { APP_NAME } from '@elogbook/shared';
import ErrorBoundary from '@/components/ErrorBoundary';
import InstallPrompt from '@/components/InstallPrompt';
import { ToastProvider } from '@/components/Toast';
import { KeyboardShortcutsProvider } from '@/lib/shortcuts';
import ShortcutsRenderer from '@/components/ShortcutsRenderer';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-heading' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

const APP_DESCRIPTION = 'Electronic logbook for medical residents — log procedures, map to accreditation milestones, and receive supervisor verifications securely.';
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://elogbook.app';

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} Enterprise`,
    template: `%s | ${APP_NAME} Enterprise`,
  },
  description: APP_DESCRIPTION,
  icons: { icon: '/favicon.svg', apple: '/favicon.svg' },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'E-Logbook',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: APP_URL,
    siteName: `${APP_NAME} Enterprise`,
    title: `${APP_NAME} Enterprise — Medical Resident Logbook`,
    description: APP_DESCRIPTION,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: `${APP_NAME} Enterprise`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${APP_NAME} Enterprise — Medical Resident Logbook`,
    description: APP_DESCRIPTION,
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: APP_URL,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: `${APP_NAME} Enterprise`,
    description: APP_DESCRIPTION,
    url: APP_URL,
    about: {
      '@type': 'Thing',
      name: 'Medical Resident Procedure Logbook',
      description: 'Electronic logbook for logging clinical procedures, mapping to accreditation milestones, and supervisor verification.',
    },
    audience: {
      '@type': 'Audience',
      audienceType: 'Medical Residents and Program Administrators',
    },
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };

  return (
    <html lang={locale} dir={dir} className={`${outfit.variable} ${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Preconnect hints for critical origins */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* dns-prefetch for env-specific origins (supabase) helps resolve wildcard domains */}
        <link rel="dns-prefetch" href="//supabase.co" />

        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />

        {/* Theme FOUC guard — must be inline, non-deferrable */}
        {nonce ? (
          <script nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark'}document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(t)}catch(e){}`,
            }}
          />
        ) : null}

        {/* Service worker — defer registration until idle */}
        <script
          defer
          src="/sw-register.js"
          nonce={nonce || undefined}
        />

        {/* JSON-LD structured data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body suppressHydrationWarning>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg">
          Skip to content
        </a>
        <ErrorBoundary>
          <NextIntlClientProvider>
            <ToastProvider>
              <KeyboardShortcutsProvider>
                {children}
                <ShortcutsRenderer />
              </KeyboardShortcutsProvider>
            </ToastProvider>
            <InstallPrompt />
          </NextIntlClientProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
