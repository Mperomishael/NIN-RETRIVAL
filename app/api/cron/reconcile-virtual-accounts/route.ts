import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAndCreditVirtualAccountPayment } from "@/lib/payments/flutterwave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ListedTransaction = {
  id?: string | number;
  tx_ref?: string;
  status?: string;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Wallet service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function utcDate(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return NextResponse.json({ error: "Flutterwave is not configured." }, { status: 503 });

  try {
    const admin = adminClient();
    const { data: accounts, error } = await admin
      .from("virtual_accounts")
      .select("tx_ref,created_at")
      .eq("status", "active");
    if (error) throw new Error("Unable to load active virtual accounts.");

    const today = utcDate(new Date());
    let checked = 0;
    let credited = 0;
    let alreadyCredited = 0;
    let failed = 0;
    const failures: Array<{ reference: string; reason: string }> = [];

    for (const account of accounts ?? []) {
      // Flutterwave supports exact tx_ref filtering for transaction listing.
      // Re-checking the account reference catches deposits whose webhook was
      // missed or rejected. Every candidate is still verified by transaction ID
      // before the wallet is credited.
      for (let page = 1; page <= 10; page++) {
        const params = new URLSearchParams({
          from: utcDate(account.created_at),
          to: today,
          page: String(page),
          status: "successful",
          tx_ref: account.tx_ref,
          currency: "NGN",
        });
        const response = await fetch(`https://api.flutterwave.com/v3/transactions?${params.toString()}`, {
          headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        const result = await response.json().catch(() => ({})) as {
          status?: string;
          message?: string;
          meta?: { page_info?: { total_pages?: number } };
          data?: ListedTransaction[];
        };
        if (!response.ok || result.status !== "success" || !Array.isArray(result.data)) {
          failed++;
          failures.push({ reference: account.tx_ref, reason: "Flutterwave transaction listing failed." });
          break;
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
            failed++;
            failures.push({
              reference: account.tx_ref,
              reason: error instanceof Error ? error.message.slice(0, 160) : "Reconciliation failed.",
            });
          }
        }

        const totalPages = Number(result.meta?.page_info?.total_pages ?? 1);
        if (page >= totalPages || page >= 10) break;
      }
    }

    return NextResponse.json({
      ok: failed === 0,
      accountsChecked: accounts?.length ?? 0,
      transactionsChecked: checked,
      newlyCredited: credited,
      alreadyCredited,
      failed,
      failures: failures.slice(0, 20),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[TopVerify VA reconciliation cron] Failed", {
      reason: error instanceof Error ? error.message.slice(0, 160) : "Unknown error",
    });
    return NextResponse.json({ error: "Virtual-account reconciliation failed." }, { status: 500 });
  }
}
