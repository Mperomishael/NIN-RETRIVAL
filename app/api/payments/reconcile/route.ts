import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { reconcileHostedTopups, reconcileVirtualAccountDeposits, type ReconcileSummary } from "@/lib/payments/flutterwave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Customer-triggered "check my payment" endpoint. Re-verifies every recent unresolved
 * hosted checkout and every transfer into the customer's permanent account directly
 * with Flutterwave, then credits whatever is genuinely paid. Safe to call repeatedly.
 */
export async function POST() {
  const server = await createSupabaseServerClient();
  const { data: auth, error: authError } = await server.auth.getUser();
  const user = auth.user;
  if (authError || !user) return NextResponse.json({ error: "Sign in to check your payment." }, { status: 401 });
  if (!process.env.FLUTTERWAVE_SECRET_KEY) {
    return NextResponse.json({ error: "Flutterwave is not configured." }, { status: 503 });
  }

  const totals: ReconcileSummary = { checked: 0, credited: 0, alreadyCredited: 0, failed: 0 };
  const add = (s: ReconcileSummary) => {
    totals.checked += s.checked; totals.credited += s.credited;
    totals.alreadyCredited += s.alreadyCredited; totals.failed += s.failed;
  };

  try {
    add(await reconcileHostedTopups(user.id));

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const admin = createSupabaseAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: account } = await admin.from("virtual_accounts")
        .select("user_id,tx_ref,created_at,status").eq("user_id", user.id).maybeSingle();
      if (account?.status === "active") {
        add(await reconcileVirtualAccountDeposits(account, user.email ?? ""));
      }
    }
  } catch (error) {
    console.error("[TopVerify reconcile] Request failed", {
      userId: user.id,
      reason: error instanceof Error ? error.message.slice(0, 160) : "unknown",
    });
    return NextResponse.json({ error: "Flutterwave could not be checked right now. Please try again shortly." }, { status: 503 });
  }

  if (totals.failed > 0 && totals.credited === 0) {
    return NextResponse.json({
      ok: false,
      ...totals,
      error: "A payment was found but could not yet be credited. Please contact support with your payment receipt.",
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    ...totals,
    message: totals.credited > 0
      ? "Your verified payment has been credited to your wallet."
      : totals.alreadyCredited > 0
        ? "Your payments are already credited. Your wallet is up to date."
        : "No completed payment was found yet. If you have just paid, wait a minute and check again.",
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
