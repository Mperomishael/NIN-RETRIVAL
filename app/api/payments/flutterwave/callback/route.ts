import { NextResponse } from "next/server";
import { verifyAndCreditFlutterwaveTopup } from "@/lib/payments/flutterwave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function destination(request: Request, status: "success" | "pending" | "failed", txRef?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const base = configured || new URL(request.url).origin;
  const url = new URL("/", base);
  url.searchParams.set("wallet_payment", status);
  if (txRef) url.searchParams.set("tx_ref", txRef);
  return NextResponse.redirect(url, 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const txRef = url.searchParams.get("tx_ref") || "";
  const transactionId = url.searchParams.get("transaction_id") || "";
  const status = (url.searchParams.get("status") || "").toLowerCase();

  if (status !== "successful" || !txRef || !transactionId) {
    return destination(request, status === "failed" || status === "cancelled" ? "failed" : "pending", txRef || undefined);
  }

  try {
    await verifyAndCreditFlutterwaveTopup(txRef, transactionId);
    return destination(request, "success", txRef);
  } catch {
    // The webhook may still reconcile a legitimate payment; never credit based on the redirect alone.
    return destination(request, "pending", txRef);
  }
}
