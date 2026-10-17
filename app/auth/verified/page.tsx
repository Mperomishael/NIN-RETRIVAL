import type { Metadata } from "next";
import { VerifiedView } from "@/components/VerifiedView";

export const metadata: Metadata = {
  title: "Email verification | TopVerify",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function VerifiedPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  return <VerifiedView tokenHash={first(params.token_hash)} type={first(params.type)} />;
}
