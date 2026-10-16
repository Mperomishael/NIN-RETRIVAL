import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type VerifiedTransaction = {
  id?: string | number;
  tx_ref?: string;
  status?: string;
  currency?: string;
  amount?: string | number;
  payment_type?: string;
  customer?: { email?: string };
};

/** Raised when a verified Flutterwave transaction does not belong to any TopVerify wallet. */
export class NotOurTransactionError extends Error {}

const VA_REF_USER = /^TVVA-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Wallet service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function verifyAndCreditFlutterwaveTopup(txRef: string, transactionId: string) {
  if (!/^TVW-[0-9a-f-]{36}$/i.test(txRef) || !/^\d+$/.test(transactionId)) {
    throw new Error("Invalid payment reference.");
  }

  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) throw new Error("Flutterwave is not configured.");

  const admin = adminClient();
  const { data: topup, error: topupError } = await admin
    .from("wallet_topups")
    .select("id,user_id,tx_ref,amount_kobo,status")
    .eq("tx_ref", txRef)
    .maybeSingle();

  if (topupError) throw new Error("Unable to load the wallet top-up.");
  if (!topup) throw new Error("Wallet top-up not found.");
  if (topup.status === "credited") return { alreadyCredited: true };
  // A checkout attempt may have been marked failed by a transient provider/link
  // response even though Flutterwave later completed it. Never revive it until
  // the provider transaction below has been independently verified.
  if (topup.status !== "pending" && topup.status !== "failed") {
    throw new Error("Wallet top-up is not eligible for reconciliation.");
  }
  const wasMarkedFailed = topup.status === "failed";

  const verifyResponse = await fetch(
    `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    }
  );
  const verification = await verifyResponse.json().catch(() => ({})) as {
    status?: string;
    data?: VerifiedTransaction;
  };
  const tx = verification.data;

  if (!verifyResponse.ok || verification.status !== "success" || !tx) {
    throw new Error("Flutterwave transaction verification is temporarily unavailable.");
  }

  const paidKobo = Math.round(Number(tx.amount) * 100);
  if (
    String(tx.id ?? "") !== transactionId ||
    String(tx.tx_ref ?? "") !== txRef ||
    String(tx.status ?? "").toLowerCase() !== "successful" ||
    String(tx.currency ?? "").toUpperCase() !== "NGN" ||
    !Number.isSafeInteger(paidKobo) ||
    paidKobo !== Number(topup.amount_kobo)
  ) {
    throw new Error("Flutterwave transaction details did not match the pending top-up.");
  }

  if (wasMarkedFailed) {
    const { data: reopened, error: reopenError } = await admin.from("wallet_topups")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("tx_ref", txRef).eq("status", "failed").select("tx_ref").maybeSingle();
    if (reopenError) throw new Error("Verified payment could not be reopened for wallet reconciliation.");
    if (!reopened) {
      const { data: current } = await admin.from("wallet_topups").select("status").eq("tx_ref", txRef).maybeSingle();
      if (current?.status === "credited") return { alreadyCredited: true };
      if (current?.status !== "pending") throw new Error("Wallet top-up status changed during reconciliation.");
    }
  }

  const { data: creditResult, error: creditError } = await admin.rpc("topverify_credit_flutterwave_topup", {
    p_tx_ref: txRef,
    p_transaction_id: transactionId,
    p_amount_kobo: paidKobo,
    p_currency: "NGN",
    p_provider_payload: {
      transaction_id: transactionId,
      tx_ref: txRef,
      status: "successful",
      currency: "NGN",
      amount_kobo: paidKobo,
    },
  });

  if (creditError || !creditResult) {
    throw new Error("Verified payment could not yet be reconciled to the wallet.");
  }

  return {
    alreadyCredited: Boolean((creditResult as { already_credited?: boolean }).already_credited),
    balanceAfterKobo: Number((creditResult as { balance_after_kobo?: number }).balance_after_kobo ?? NaN),
  };
}


async function verifyTransactionById(transactionId: string): Promise<VerifiedTransaction> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) throw new Error("Flutterwave is not configured.");
  const verifyResponse = await fetch(
    `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    }
  );
  const verification = await verifyResponse.json().catch(() => ({})) as {
    status?: string;
    data?: VerifiedTransaction;
  };
  if (!verifyResponse.ok || verification.status !== "success" || !verification.data) {
    throw new Error("Flutterwave transaction verification is temporarily unavailable.");
  }
  return verification.data;
}

/**
 * Credit a bank transfer paid into a customer's permanent virtual account.
 *
 * Flutterwave does not always echo the account-creation reference as the
 * transfer's tx_ref, so the owner is resolved in this order:
 *   1. an authenticated caller (`opts.userId`) whose email matches the transaction customer,
 *   2. the tx_ref exactly matching a stored virtual account,
 *   3. the user id embedded in a `TVVA-<user-id>-…` reference.
 * The transaction is always verified server-to-server by ID first.
 */
export async function creditVirtualAccountTransfer(
  transactionId: string,
  opts: { userId?: string; expectedEmail?: string } = {}
) {
  if (!/^\d+$/.test(transactionId)) throw new Error("Invalid virtual-account payment reference.");
  const admin = adminClient();
  const tx = await verifyTransactionById(transactionId);

  const txRef = String(tx.tx_ref ?? "");
  const amountKobo = Math.round(Number(tx.amount) * 100);
  if (
    String(tx.id ?? "") !== transactionId ||
    String(tx.status ?? "").toLowerCase() !== "successful" ||
    String(tx.currency ?? "").toUpperCase() !== "NGN" ||
    !Number.isSafeInteger(amountKobo) || amountKobo <= 0
  ) {
    throw new Error("Virtual-account transfer did not pass provider verification.");
  }
  // Hosted-checkout payments are credited through their own pending top-up record.
  if (txRef.startsWith("TVW-")) throw new NotOurTransactionError("Hosted checkout payment.");

  type Account = { id: string; user_id: string; tx_ref: string; status: string; account_number: string | null };
  let account: Account | null = null;
  const columns = "id,user_id,tx_ref,status,account_number";

  if (opts.userId) {
    const customerEmail = String(tx.customer?.email ?? "").trim().toLowerCase();
    const sameCustomer = opts.expectedEmail && customerEmail === opts.expectedEmail.trim().toLowerCase();
    const sameReference = VA_REF_USER.exec(txRef)?.[1]?.toLowerCase() === opts.userId.toLowerCase();
    if (!sameCustomer && !sameReference) throw new NotOurTransactionError("Transaction belongs to another customer.");
    const { data, error } = await admin.from("virtual_accounts").select(columns).eq("user_id", opts.userId).maybeSingle();
    if (error) throw new Error("Unable to load the virtual account.");
    account = data as Account | null;
  } else {
    if (txRef) {
      const { data, error } = await admin.from("virtual_accounts").select(columns).eq("tx_ref", txRef).maybeSingle();
      if (error) throw new Error("Unable to load the virtual account.");
      account = data as Account | null;
    }
    const embeddedUser = VA_REF_USER.exec(txRef)?.[1];
    if (!account && embeddedUser) {
      const { data, error } = await admin.from("virtual_accounts").select(columns).eq("user_id", embeddedUser).maybeSingle();
      if (error) throw new Error("Unable to load the virtual account.");
      account = data as Account | null;
    }
  }
  if (!account || account.status !== "active" || !account.account_number) {
    throw new NotOurTransactionError("No active TopVerify virtual account matches this transaction.");
  }

  const existing = await admin.from("wallet_topups")
    .select("tx_ref,status,amount_kobo")
    .eq("provider_reference", transactionId)
    .maybeSingle();
  if (existing.error) throw new Error("Unable to reconcile the virtual-account transfer.");
  if (existing.data?.status === "credited") return { alreadyCredited: true };
  if (existing.data && Number(existing.data.amount_kobo) !== amountKobo) {
    throw new Error("Virtual-account payment amount does not match the funding record.");
  }

  if (existing.data?.status === "failed") {
    const { data: reopened, error: reopenError } = await admin.from("wallet_topups")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("provider_reference", transactionId).eq("status", "failed")
      .select("tx_ref").maybeSingle();
    if (reopenError) throw new Error("Verified virtual-account payment could not be reopened for reconciliation.");
    if (!reopened) {
      const { data: current } = await admin.from("wallet_topups")
        .select("tx_ref,status").eq("provider_reference", transactionId).maybeSingle();
      if (current?.status === "credited") return { alreadyCredited: true };
      if (current?.status !== "pending") throw new Error("Virtual-account top-up status changed during reconciliation.");
    }
  }

  let topupRef = existing.data?.tx_ref;
  if (!topupRef) {
    topupRef = `TVW-${randomUUID()}`;
    const { error: insertError } = await admin.from("wallet_topups").insert({
      user_id: account.user_id,
      tx_ref: topupRef,
      amount_kobo: amountKobo,
      currency: "NGN",
      status: "pending",
      provider_reference: transactionId,
      provider_payload: {
        source: "static_virtual_account",
        account_reference: account.tx_ref,
        transaction_id: transactionId,
        amount_kobo: amountKobo,
        currency: "NGN",
      },
    });
    if (insertError) {
      // A duplicate webhook may have won the insert race. Read the unique payment record.
      const { data: raced, error: racedError } = await admin.from("wallet_topups")
        .select("tx_ref,status,amount_kobo")
        .eq("provider_reference", transactionId)
        .maybeSingle();
      if (racedError || !raced) {
        // Surface the real database reason (for example a missing migration) in the logs.
        console.error("[TopVerify VA credit] Could not create funding record", { transactionId, reason: insertError.message.slice(0, 200) });
        throw new Error("Unable to create the virtual-account funding record.");
      }
      if (raced.status === "credited") return { alreadyCredited: true };
      if (Number(raced.amount_kobo) !== amountKobo) throw new Error("Conflicting virtual-account payment amount.");
      topupRef = raced.tx_ref;
    }
  }

  const { data: creditResult, error: creditError } = await admin.rpc("topverify_credit_flutterwave_topup", {
    p_tx_ref: topupRef,
    p_transaction_id: transactionId,
    p_amount_kobo: amountKobo,
    p_currency: "NGN",
    p_provider_payload: {
      source: "static_virtual_account",
      account_reference: account.tx_ref,
      transaction_id: transactionId,
      status: "successful",
      currency: "NGN",
      amount_kobo: amountKobo,
    },
  });
  if (creditError || !creditResult) {
    console.error("[TopVerify VA credit] Wallet credit RPC failed", { transactionId, reason: creditError?.message?.slice(0, 200) ?? "empty result" });
    throw new Error("Verified virtual-account payment could not yet be credited.");
  }
  return {
    alreadyCredited: Boolean((creditResult as { already_credited?: boolean }).already_credited),
    balanceAfterKobo: Number((creditResult as { balance_after_kobo?: number }).balance_after_kobo ?? NaN),
  };
}

/** Backwards-compatible wrapper used by older callers. */
export async function verifyAndCreditVirtualAccountPayment(_accountTxRef: string, transactionId: string) {
  return creditVirtualAccountTransfer(transactionId);
}

type ListedTransaction = { id?: string | number; tx_ref?: string; status?: string; payment_type?: string };

async function listSuccessfulTransactions(filters: Record<string, string>) {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) throw new Error("Flutterwave is not configured.");
  const found: ListedTransaction[] = [];
  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({ ...filters, page: String(page), status: "successful", currency: "NGN" });
    const response = await fetch(`https://api.flutterwave.com/v3/transactions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({})) as {
      status?: string;
      meta?: { page_info?: { total_pages?: number } };
      data?: ListedTransaction[];
    };
    if (!response.ok || result.status !== "success" || !Array.isArray(result.data)) {
      throw new Error("Flutterwave transaction listing failed.");
    }
    found.push(...result.data);
    if (page >= Number(result.meta?.page_info?.total_pages ?? 1)) break;
  }
  return found;
}

export type ReconcileSummary = { checked: number; credited: number; alreadyCredited: number; failed: number };

/**
 * Find and credit every successful transfer into one customer's permanent account.
 * Searches by the account reference AND by the customer's email, because Flutterwave
 * can label transfers with a reference other than the account's own.
 */
export async function reconcileVirtualAccountDeposits(
  account: { user_id: string; tx_ref: string; created_at: string },
  email: string
): Promise<ReconcileSummary> {
  const from = new Date(new Date(account.created_at).getTime() - 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const candidates = new Map<string, ListedTransaction>();
  const searches: Array<Record<string, string>> = [{ from, to, tx_ref: account.tx_ref }];
  if (email) searches.push({ from, to, customer_email: email });
  let listed = false;
  for (const filters of searches) {
    try {
      for (const tx of await listSuccessfulTransactions(filters)) if (tx.id) candidates.set(String(tx.id), tx);
      listed = true;
    } catch (error) {
      console.error("[TopVerify VA reconcile] Listing failed", { reason: error instanceof Error ? error.message : "unknown" });
    }
  }
  if (!listed) throw new Error("Flutterwave could not check the transfer right now.");

  const summary: ReconcileSummary = { checked: 0, credited: 0, alreadyCredited: 0, failed: 0 };
  for (const [id, tx] of candidates) {
    if (String(tx.tx_ref ?? "").startsWith("TVW-")) continue;
    try {
      const outcome = await creditVirtualAccountTransfer(id, { userId: account.user_id, expectedEmail: email });
      summary.checked++;
      if (outcome.alreadyCredited) summary.alreadyCredited++; else summary.credited++;
    } catch (error) {
      if (error instanceof NotOurTransactionError) continue;
      summary.failed++;
      console.error("[TopVerify VA reconcile] Transfer could not be credited", {
        transactionId: id,
        reason: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      });
    }
  }
  return summary;
}

/**
 * Recover hosted-checkout payments whose redirect or webhook never arrived.
 * Asks Flutterwave about each recent unresolved top-up by its reference.
 */
export async function reconcileHostedTopups(userId: string): Promise<ReconcileSummary> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) throw new Error("Flutterwave is not configured.");
  const admin = adminClient();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: topups, error } = await admin.from("wallet_topups")
    .select("tx_ref")
    .eq("user_id", userId)
    .in("status", ["pending", "failed"])
    .like("tx_ref", "TVW-%")
    .is("provider_reference", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error("Unable to load pending top-ups.");

  const summary: ReconcileSummary = { checked: 0, credited: 0, alreadyCredited: 0, failed: 0 };
  for (const topup of topups ?? []) {
    try {
      const response = await fetch(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(topup.tx_ref)}`,
        {
          headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        }
      );
      const body = await response.json().catch(() => ({})) as { status?: string; data?: VerifiedTransaction };
      // No transaction yet (customer never paid) is normal, not an error.
      if (!response.ok || body.status !== "success" || !body.data) continue;
      if (String(body.data.status ?? "").toLowerCase() !== "successful" || !body.data.id) continue;
      summary.checked++;
      const outcome = await verifyAndCreditFlutterwaveTopup(topup.tx_ref, String(body.data.id));
      if (outcome.alreadyCredited) summary.alreadyCredited++; else summary.credited++;
    } catch (err) {
      summary.failed++;
      console.error("[TopVerify hosted reconcile] Top-up could not be credited", {
        txRef: topup.tx_ref,
        reason: err instanceof Error ? err.message.slice(0, 160) : "unknown",
      });
    }
  }
  return summary;
}
