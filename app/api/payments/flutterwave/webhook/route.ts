import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyAndCreditFlutterwaveTopup, verifyAndCreditVirtualAccountPayment } from "@/lib/payments/flutterwave";

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

  let payload: {
    event?: string;
    data?: { id?: string | number; tx_ref?: string; status?: string };
  };
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const data = payload.data;
  if (payload.event !== "charge.completed" || !data || String(data.status ?? "").toLowerCase() !== "successful") {
    return NextResponse.json({ received: true });
  }

  const txRef = typeof data.tx_ref === "string" ? data.tx_ref : "";
  const transactionId = String(data.id ?? "");
  if (!txRef || !transactionId) {
    return NextResponse.json({ error: "Missing transaction reference." }, { status: 400 });
  }

  try {
    if (txRef.startsWith("TVVA-")) {
      await verifyAndCreditVirtualAccountPayment(txRef, transactionId);
    } else {
      await verifyAndCreditFlutterwaveTopup(txRef, transactionId);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    // Do not log the webhook body or secrets; the reference and provider error
    // are enough to diagnose failed reconciliation from production logs.
    console.error("[TopVerify Flutterwave webhook] Reconciliation failed", {
      txRef,
      transactionId,
      reason: error instanceof Error ? error.message.slice(0, 180) : "Unknown reconciliation error",
    });
    // A non-2xx response lets Flutterwave retry if verification or reconciliation is temporarily unavailable.
    return NextResponse.json({ error: "Payment verification/reconciliation pending." }, { status: 500 });
  }
}
