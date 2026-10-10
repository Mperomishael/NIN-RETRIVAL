import type { Metadata } from "next";
import "./globals.css";
import "./landing.css";

export const metadata: Metadata = {
  title: "TopVerify — Identity Operations",
  description: "A secure, consent-first identity verification workspace with agent accounts, dedicated wallets and auditable requests.",
  applicationName: "TopVerify",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
