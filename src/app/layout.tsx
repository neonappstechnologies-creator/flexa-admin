import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Flexa operator panel',
  description: 'Switch a clinic off, and control who its reminders reach.',
  // Nothing here should ever be indexed. It is behind a password, but a search
  // result naming an internal panel is an invitation to try the password.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
