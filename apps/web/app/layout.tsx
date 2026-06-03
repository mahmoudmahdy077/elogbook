import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'E-Logbook',
  description: 'Electronic logbook for medical residents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
