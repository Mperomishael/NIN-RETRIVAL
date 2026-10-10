import { createBrowserClient } from "@supabase/ssr";

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function createClient() {
  // Safe placeholder lets Next.js build before deployment variables are added.
  // The app checks isSupabaseConfigured() and will not allow auth/API use until configured.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://topverify-unconfigured.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_unconfigured";
  return createBrowserClient(url, key);
}
