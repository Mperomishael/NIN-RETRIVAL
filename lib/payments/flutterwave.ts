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
