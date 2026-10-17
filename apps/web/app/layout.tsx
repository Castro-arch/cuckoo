import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cuckoo',
  description: 'Open-source, self-hostable scheduling.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
