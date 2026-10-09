import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Empire Identity Hub', description: 'Identity services workspace for authorized agents.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }