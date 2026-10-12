import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const server = await createSupabaseServerClient();
  const { data: authData, error: authError } = await server.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Sign in to view wallet funding history." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Wallet service is not configured." }, { status: 503 });
  }

  const admin = createSupabaseAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const columns = "id,tx_ref,amount_kobo,currency,status,created_at,updated_at,credited_at,provider_reference";

  // Keep every pending deposit visible, plus the latest 50 resolved deposits.
  const [pendingResult, resolvedResult] = await Promise.all([
    admin.from("wallet_topups").select(columns).eq("user_id", authData.user.id)
      .eq("status", "pending").order("created_at", { ascending: false }),
    admin.from("wallet_topups").select(columns).eq("user_id", authData.user.id)
      .in("status", ["credited", "failed"]).order("created_at", { ascending: false }).limit(50),
  ]);

  if (pendingResult.error || resolvedResult.error) {
    console.error("[TopVerify wallet history] Could not load funding history:", pendingResult.error?.message ?? resolvedResult.error?.message);
    return NextResponse.json({ error: "Unable to load wallet funding history." }, { status: 500 });
  }

  const topups = [...(pendingResult.data ?? []), ...(resolvedResult.data ?? [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({ topups }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
