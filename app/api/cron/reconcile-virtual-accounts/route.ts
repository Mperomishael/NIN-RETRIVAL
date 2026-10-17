import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveStuckRequests } from "@/lib/server/stuck-requests";
import { reconcileHostedTopups, reconcileVirtualAccountDeposits } from "@/lib/payments/flutterwave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Wallet service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!process.env.FLUTTERWAVE_SECRET_KEY) return NextResponse.json({ error: "Flutterwave is not configured." }, { status: 503 });

  try {
    const admin = adminClient();
    let checked = 0, credited = 0, alreadyCredited = 0, failed = 0;

    // Hosted checkouts whose redirect/webhook never arrived (last 7 days, any user).
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: pending } = await admin.from("wallet_topups").select("user_id")
      .in("status", ["pending", "failed"]).like("tx_ref", "TVW-%").is("provider_reference", null).gte("created_at", since);
    for (const userId of new Set((pending ?? []).map(row => row.user_id as string))) {
      try {
        const r = await reconcileHostedTopups(userId);
        checked += r.checked; credited += r.credited; alreadyCredited += r.alreadyCredited; failed += r.failed;
      } catch { failed++; }
    }

    // Permanent virtual accounts.
    const { data: accounts, error } = await admin.from("virtual_accounts")
      .select("user_id,tx_ref,created_at").eq("status", "active");
    if (error) throw new Error("Unable to load active virtual accounts.");
    for (const account of accounts ?? []) {
      try {
        const { data: owner } = await admin.auth.admin.getUserById(account.user_id);
        const r = await reconcileVirtualAccountDeposits(account, owner.user?.email ?? "");
        checked += r.checked; credited += r.credited; alreadyCredited += r.alreadyCredited; failed += r.failed;
      } catch { failed++; }
    }

    const stuck = await resolveStuckRequests(admin, 10).catch(() => ({ completed: 0, refunded: 0, failed: 0 }));

    return NextResponse.json({
      stuckRequests: stuck,
      ok: failed === 0,
      accountsChecked: accounts?.length ?? 0,
      transactionsChecked: checked,
      newlyCredited: credited,
      alreadyCredited,
      failed,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[TopVerify reconciliation cron] Failed", {
      reason: error instanceof Error ? error.message.slice(0, 160) : "Unknown error",
    });
    return NextResponse.json({ error: "Reconciliation failed." }, { status: 500 });
  }
}
