import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { NotOurTransactionError, creditVirtualAccountTransfer, verifyAndCreditFlutterwaveTopup } from "@/lib/payments/flutterwave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function constantTimeEqual(received: string | null, expected: string) {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isValidWebhook(rawBody: string, request: Request, secretHash: string) {
  // Current Flutterwave webhooks use an HMAC-SHA256 Base64 signature.
  const signature = request.headers.get("flutterwave-signature");
  const expectedSignature = createHmac("sha256", secretHash).update(rawBody).digest("base64");
  if (constantTimeEqual(signature, expectedSignature)) return true;

  // Retain compatibility with legacy v3 dashboard configurations that send verif-hash.
  return constantTimeEqual(request.headers.get("verif-hash"), secretHash);
}

export async function POST(request: Request) {
  const secretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  let rawBody: string;
  try { rawBody = await request.text(); } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  if (!secretHash || !isValidWebhook(rawBody, request, secretHash)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  // Flutterwave sends charge.completed with a nested `data` object. Older dashboard
  // configurations send a flat payload (txRef / event.type), so accept both shapes.
  type Raw = { id?: string | number; tx_ref?: string; txRef?: string; status?: string };
  let payload: Raw & { event?: string; "event.type"?: string; data?: Raw };
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const data: Raw = payload.data ?? payload;
  const eventName = String(payload.event ?? payload["event.type"] ?? "");
  const isPaymentEvent = eventName === "charge.completed" || /TRANSACTION|TRANSFER/i.test(eventName);
  if (!isPaymentEvent || String(data.status ?? "").toLowerCase() !== "successful") {
    return NextResponse.json({ received: true });
  }

  const txRef = typeof (data.tx_ref ?? data.txRef) === "string" ? String(data.tx_ref ?? data.txRef) : "";
  const transactionId = String(data.id ?? "");
  if (!/^\d+$/.test(transactionId)) {
    return NextResponse.json({ error: "Missing transaction id." }, { status: 400 });
  }

  try {
    if (txRef.startsWith("TVW-")) {
      await verifyAndCreditFlutterwaveTopup(txRef, transactionId);
    } else {
      // Bank transfers into a permanent virtual account may carry any reference;
      // the credit function resolves the owner after verifying with Flutterwave.
      await creditVirtualAccountTransfer(transactionId);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    if (error instanceof NotOurTransactionError) {
      // Not a TopVerify wallet payment (or a customer we cannot match). Acknowledge so Flutterwave stops retrying.
      console.warn("[TopVerify Flutterwave webhook] Ignored unmatched transaction", { txRef, transactionId, reason: error.message });
      return NextResponse.json({ received: true, ignored: true });
    }
    console.error("[TopVerify Flutterwave webhook] Reconciliation failed", {
      txRef,
      transactionId,
      reason: error instanceof Error ? error.message.slice(0, 180) : "Unknown reconciliation error",
    });
    // A non-2xx response lets Flutterwave retry if verification or reconciliation is temporarily unavailable.
    return NextResponse.json({ error: "Payment verification/reconciliation pending." }, { status: 500 });
  }
}
