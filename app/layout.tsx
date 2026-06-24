import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Neha Broadcast Channel | Campaign Manager',
  description: 'Send promotional messages safely with auto delay and attachment support.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable}`}>
      <body className="bg-slate-950 text-slate-100 font-sans antialiased">{children}</body>
    </html>
  );
}

