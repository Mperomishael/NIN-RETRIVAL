import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Wallet service is not configured.");
  return createSupabaseAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  const server = await createSupabaseServerClient();
  const { data: authData, error: authError } = await server.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Sign in before funding your wallet." }, { status: 401 });
  }
  if (!authData.user.email) {
    return NextResponse.json({ error: "Your account needs a verified email before wallet funding." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid funding request." }, { status: 400 });
  }

  const rawAmount = body.amountNaira;
  const amountNaira = typeof rawAmount === "number" ? rawAmount :
    typeof rawAmount === "string" && /^\d+$/.test(rawAmount) ? Number(rawAmount) : NaN;
  if (!Number.isSafeInteger(amountNaira) || amountNaira < 500 || amountNaira > 1000000) {
    return NextResponse.json({ error: "Enter a whole-naira amount between ₦500 and ₦1,000,000." }, { status: 400 });
  }

  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "Flutterwave is not configured yet. Contact TopVerify support." }, { status: 503 });
  }

  let admin: ReturnType<typeof adminClient>;
  try { admin = adminClient(); } catch {
    return NextResponse.json({ error: "Wallet service is not configured." }, { status: 503 });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("full_name,phone")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile) {
    return NextResponse.json({ error: "Your TopVerify profile could not be loaded." }, { status: 409 });
  }

  const { data: wallet, error: walletError } = await admin
    .from("wallets")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (walletError || !wallet) {
    return NextResponse.json({ error: "Your TopVerify wallet is not ready. Contact support." }, { status: 409 });
  }

  const txRef = `TVW-${crypto.randomUUID()}`;
  const { error: insertError } = await admin.from("wallet_topups").insert({
    user_id: authData.user.id,
    tx_ref: txRef,
    amount_kobo: amountNaira * 100,
    currency: "NGN",
    status: "pending",
  });
  if (insertError) {
    console.error("[TopVerify wallet funding] Could not create pending top-up:", insertError.message);
    return NextResponse.json({ error: "Unable to start this wallet top-up. Please try again." }, { status: 500 });
  }

  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}` : "";
  const siteUrl = configuredSiteUrl || vercelUrl || new URL(request.url).origin;
  const customer: Record<string, string> = {
    email: authData.user.email,
    name: profile.full_name || authData.user.email,
  };
  if (profile.phone) customer.phone_number = profile.phone;

  try {
    const paymentResponse = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: amountNaira,
        currency: "NGN",
        redirect_url: `${siteUrl}/api/payments/flutterwave/callback`,
        customer,
        customizations: {
          title: "TopVerify Wallet",
          description: "Fund your TopVerify NGN wallet",
        },
        meta: { topverify_tx_ref: txRef },
        configurations: { session_duration: 30, max_retry_attempt: 3 },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    const result = await paymentResponse.json().catch(() => ({})) as {
      status?: string;
      message?: string;
      data?: { link?: string; checkout_url?: string };
    };
    const rawLink = result.data?.link ?? result.data?.checkout_url;
    const checkoutUrl = typeof rawLink === "string" ? rawLink.trim() : "";
    let validCheckoutUrl = false;
    try {
      const parsed = new URL(checkoutUrl);
      // Trust only Flutterwave's checkout host over HTTPS. Flutterwave may
      // adjust the hosted-link path, so do not reject a valid link solely
      // because its pathname differs from the current documentation example.
      validCheckoutUrl = parsed.protocol === "https:" &&
        parsed.hostname.toLowerCase() === "checkout.flutterwave.com" &&
        !parsed.username && !parsed.password;
    } catch {
      validCheckoutUrl = false;
    }

    // "Hosted Link" is Flutterwave's normal success message, not an error.
    const providerSucceeded = result.status?.toLowerCase() === "success";
    // Flutterwave's JSON status and hosted link are the meaningful checkout
    // result. Some intermediaries can produce a non-2xx HTTP status even when
    // the provider body reports success, so do not discard a valid hosted URL
    // solely because response.ok is false.
    if (!providerSucceeded || !validCheckoutUrl) {
      const providerMessage = typeof result.message === "string"
        ? result.message.replace(/[\r\n\t]+/g, " ").slice(0, 220)
        : "Flutterwave returned no message.";
      console.error("[TopVerify wallet funding] Checkout creation did not return a usable hosted link:", {
        httpStatus: paymentResponse.status,
        providerStatus: result.status ?? "missing",
        providerMessage,
        hasLink: Boolean(checkoutUrl),
        linkHost: (() => { try { return new URL(checkoutUrl).hostname; } catch { return "missing-or-invalid"; } })(),
        linkPath: (() => { try { return new URL(checkoutUrl).pathname.slice(0, 100); } catch { return "missing-or-invalid"; } })(),
        txRef,
      });
      await admin.from("wallet_topups").update({ status: "failed", updated_at: new Date().toISOString() }).eq("tx_ref", txRef).eq("status", "pending");
      const errorMessage = providerSucceeded && providerMessage.toLowerCase() === "hosted link"
        ? `Flutterwave reported success, but TopVerify could not validate the checkout URL (HTTP ${paymentResponse.status}; link ${checkoutUrl ? "present" : "missing"}; host ${(() => { try { return new URL(checkoutUrl).hostname; } catch { return "unreadable"; } })()}).`
        : `Flutterwave checkout could not be created: ${providerMessage}`;
      return NextResponse.json({
        error: errorMessage,
        code: "FLUTTERWAVE_CHECKOUT_REJECTED",
      }, { status: 502 });
    }

    return NextResponse.json({ checkoutUrl, txRef });
  } catch (error) {
    console.error("[TopVerify wallet funding] Could not reach Flutterwave:", {
      txRef,
      message: error instanceof Error ? error.message.slice(0, 180) : "Unknown network error",
    });
    await admin.from("wallet_topups").update({ status: "failed", updated_at: new Date().toISOString() }).eq("tx_ref", txRef).eq("status", "pending");
    return NextResponse.json({ error: "Flutterwave checkout could not be reached. Check the deployment logs or try again shortly.", code: "FLUTTERWAVE_NETWORK_ERROR" }, { status: 502 });
  }
}
