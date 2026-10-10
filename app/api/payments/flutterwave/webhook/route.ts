import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyAndCreditFlutterwaveTopup } from "@/lib/payments/flutterwave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function matchesSecret(received: string | null, expected: string) {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  if (!secretHash || !matchesSecret(request.headers.get("verif-hash"), secretHash)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: {
    event?: string;
    data?: { id?: string | number; tx_ref?: string; status?: string };
  };
  try { payload = await request.json(); } catch {
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
    await verifyAndCreditFlutterwaveTopup(txRef, transactionId);
    return NextResponse.json({ received: true });
  } catch {
    // A non-2xx response lets Flutterwave retry if verification or reconciliation is temporarily unavailable.
    return NextResponse.json({ error: "Payment verification/reconciliation pending." }, { status: 500 });
  }
}
