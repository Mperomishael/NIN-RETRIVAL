import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { verifyAndCreditVirtualAccountPayment } from "@/lib/payments/flutterwave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Wallet service is not configured.");
  return createSupabaseAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST() {
  const server = await createSupabaseServerClient();
  const { data: auth, error: authError } = await server.auth.getUser();
  const user = auth.user;
  if (authError || !user) return NextResponse.json({ error: "Sign in to check your deposit." }, { status: 401 });

  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return NextResponse.json({ error: "Flutterwave is not configured." }, { status: 503 });

  try {
    const admin = adminClient();
    const { data: account, error } = await admin.from("virtual_accounts")
      .select("tx_ref,created_at,status").eq("user_id", user.id).maybeSingle();
    if (error) throw new Error("Unable to load your deposit account.");
    if (!account || account.status !== "active") {
      return NextResponse.json({ error: "No active permanent deposit account was found." }, { status: 404 });
    }

    const from = new Date(account.created_at).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    let checked = 0;
    let credited = 0;
    let alreadyCredited = 0;

    for (let page = 1; page <= 10; page++) {
      const params = new URLSearchParams({
        from, to, page: String(page), status: "successful",
        tx_ref: account.tx_ref, currency: "NGN",
      });
      const response = await fetch(`https://api.flutterwave.com/v3/transactions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => ({})) as {
        status?: string;
        meta?: { page_info?: { total_pages?: number } };
        data?: Array<{ id?: string | number; tx_ref?: string; status?: string }>;
      };
      if (!response.ok || result.status !== "success" || !Array.isArray(result.data)) {
        console.error("[TopVerify VA reconcile] Flutterwave listing failed", { userId: user.id, status: response.status });
        return NextResponse.json({ error: "Flutterwave could not check the transfer right now. Please try again shortly." }, { status: 502 });
      }

      for (const transaction of result.data) {
        if (!transaction.id || transaction.tx_ref !== account.tx_ref ||
            String(transaction.status ?? "").toLowerCase() !== "successful") continue;
        checked++;
        try {
          const outcome = await verifyAndCreditVirtualAccountPayment(account.tx_ref, String(transaction.id));
          if (outcome.alreadyCredited) alreadyCredited++;
          else credited++;
        } catch (error) {
          console.error("[TopVerify VA reconcile] Verified transfer could not be credited", {
            userId: user.id,
            transactionId: String(transaction.id),
            reason: error instanceof Error ? error.message.slice(0, 140) : "Unknown error",
          });
          return NextResponse.json({ error: "A transfer was found but could not yet be credited. Please contact support with your transfer receipt." }, { status: 503 });
        }
      }

      const totalPages = Number(result.meta?.page_info?.total_pages ?? 1);
      if (page >= totalPages || page >= 10) break;
    }

    return NextResponse.json({
      ok: true,
      transactionsChecked: checked,
      newlyCredited: credited,
      alreadyCredited,
      message: credited > 0
        ? "Your verified bank transfer has been credited to your wallet."
        : checked > 0
          ? "Your bank transfer was already credited. Your wallet is up to date."
          : "No successful transfer was found for this account yet. If you have just transferred, wait a few minutes and check again.",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("[TopVerify VA reconcile] Request failed", {
      userId: user.id,
      reason: error instanceof Error ? error.message.slice(0, 140) : "Unknown error",
    });
    return NextResponse.json({ error: "Unable to reconcile your deposit right now." }, { status: 503 });
  }
}
