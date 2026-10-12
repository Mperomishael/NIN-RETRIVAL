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

  const { data, error } = await admin
    .from("wallet_topups")
    .select("id,tx_ref,amount_kobo,currency,status,created_at,updated_at,credited_at,provider_reference,flutterwave_transaction_id")
    .eq("user_id", authData.user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[TopVerify wallet history] Could not load funding history:", error.message);
    return NextResponse.json({ error: "Unable to load wallet funding history." }, { status: 500 });
  }

  return NextResponse.json({ topups: data ?? [] }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
