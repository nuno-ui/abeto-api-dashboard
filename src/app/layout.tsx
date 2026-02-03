import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Abeto API Dashboard',
  description: 'Real-time status dashboard for Abeto API resources',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
