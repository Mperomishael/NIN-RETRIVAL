import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type VerifiedTransaction = {
  id?: string | number;
  tx_ref?: string;
  status?: string;
  currency?: string;
  amount?: string | number;
};

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
  if (topup.status !== "pending") throw new Error("Wallet top-up is not pending.");

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


/**
 * Reconcile a bank transfer paid into a customer's permanent static virtual account.
 * The provider's transaction is verified server-to-server before any wallet credit.
 */
export async function verifyAndCreditVirtualAccountPayment(accountTxRef: string, transactionId: string) {
  if (!/^TVVA-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}$/i.test(accountTxRef) || !/^\d+$/.test(transactionId)) {
    throw new Error("Invalid virtual-account payment reference.");
  }

  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) throw new Error("Flutterwave is not configured.");
  const admin = adminClient();

  const { data: account, error: accountError } = await admin
    .from("virtual_accounts")
    .select("id,user_id,tx_ref,status,account_number")
    .eq("tx_ref", accountTxRef)
    .maybeSingle();
  if (accountError) throw new Error("Unable to load the virtual account.");
  if (!account || account.status !== "active" || !account.account_number) {
    throw new Error("Active virtual account not found.");
  }

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

  const amountNaira = Number(tx.amount);
  const amountKobo = Math.round(amountNaira * 100);
  if (
    String(tx.id ?? "") !== transactionId ||
    String(tx.tx_ref ?? "") !== accountTxRef ||
    String(tx.status ?? "").toLowerCase() !== "successful" ||
    String(tx.currency ?? "").toUpperCase() !== "NGN" ||
    !Number.isSafeInteger(amountKobo) || amountKobo <= 0
  ) {
    throw new Error("Virtual-account transfer did not pass provider verification.");
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
        account_reference: accountTxRef,
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
      if (racedError || !raced) throw new Error("Unable to create the virtual-account funding record.");
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
      account_reference: accountTxRef,
      transaction_id: transactionId,
      status: "successful",
      currency: "NGN",
      amount_kobo: amountKobo,
    },
  });
  if (creditError || !creditResult) throw new Error("Verified virtual-account payment could not yet be credited.");
  return {
    alreadyCredited: Boolean((creditResult as { already_credited?: boolean }).already_credited),
    balanceAfterKobo: Number((creditResult as { balance_after_kobo?: number }).balance_after_kobo ?? NaN),
  };
}
