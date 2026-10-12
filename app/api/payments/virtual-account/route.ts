import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Virtual account service is not configured.");
  return createSupabaseAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInUser() {
  const server = await createSupabaseServerClient();
  const { data, error } = await server.auth.getUser();
  return error || !data.user ? null : data.user;
}

export async function GET() {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Sign in to view your deposit account." }, { status: 401 });
  try {
    const admin = adminClient();
    const { data, error } = await admin.from("virtual_accounts")
      .select("account_number,bank_name,status,created_at")
      .eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ account: data ?? null }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({ error: "Unable to load your deposit account." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await signedInUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "Sign in with a verified email to set up a deposit account." }, { status: 401 });
  }

  let body: { nin?: unknown; consent?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid virtual account request." }, { status: 400 });
  }
  const nin = typeof body.nin === "string" ? body.nin.replace(/\s/g, "") : "";
  if (!/^\d{11}$/.test(nin)) {
    return NextResponse.json({ error: "Enter a valid 11-digit NIN." }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json({ error: "Consent is required to send your NIN to Flutterwave for permanent account creation." }, { status: 400 });
  }

  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return NextResponse.json({ error: "Flutterwave is not configured. Use hosted payment or contact support." }, { status: 503 });

  let admin: ReturnType<typeof adminClient>;
  try { admin = adminClient(); } catch {
    return NextResponse.json({ error: "Virtual account service is not configured." }, { status: 503 });
  }

  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("full_name,phone").eq("id", user.id).maybeSingle();
  if (profileError || !profile) return NextResponse.json({ error: "Your TopVerify profile could not be loaded." }, { status: 409 });

  const { data: existing, error: existingError } = await admin.from("virtual_accounts")
    .select("account_number,bank_name,status").eq("user_id", user.id).maybeSingle();
  if (existingError) return NextResponse.json({ error: "Unable to check your deposit account." }, { status: 503 });
  if (existing?.status === "active" && existing.account_number && existing.bank_name) {
    return NextResponse.json({ account: existing, alreadyExists: true });
  }
  if (existing?.status === "provisioning") {
    return NextResponse.json({ error: "Your permanent account setup is already processing. Refresh shortly." }, { status: 409 });
  }

  const txRef = `TVVA-${user.id}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  if (existing) {
    const { error } = await admin.from("virtual_accounts").update({
      tx_ref: txRef, status: "provisioning", account_number: null, bank_name: null,
      provider_reference: null, updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("status", "failed");
    if (error) return NextResponse.json({ error: "Unable to restart account setup." }, { status: 503 });
  } else {
    const { error } = await admin.from("virtual_accounts").insert({
      user_id: user.id, tx_ref: txRef, status: "provisioning",
    });
    if (error) {
      // Avoid duplicate account creation if two requests arrive at once.
      const { data: raced } = await admin.from("virtual_accounts").select("status,account_number,bank_name")
        .eq("user_id", user.id).maybeSingle();
      if (raced?.status === "active" && raced.account_number && raced.bank_name) {
        return NextResponse.json({ account: raced, alreadyExists: true });
      }
      return NextResponse.json({ error: "Account setup has already started. Refresh shortly." }, { status: 409 });
    }
  }

  const parts = (profile.full_name || user.email).trim().split(/\s+/);
  const firstname = parts[0] || "TopVerify";
  const lastname = parts.slice(1).join(" ") || "Customer";
  try {
    const providerResponse = await fetch("https://api.flutterwave.com/v3/virtual-account-numbers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        tx_ref: txRef,
        is_permanent: true,
        nin,
        firstname,
        lastname,
        phonenumber: profile.phone || undefined,
        narration: `TopVerify - ${firstname}`,
        bank_code: "090567",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const result = await providerResponse.json().catch(() => ({})) as {
      status?: string; message?: string;
      data?: { account_number?: string; bank_name?: string; flw_ref?: string; response_code?: string; response_message?: string };
    };
    const accountNumber = typeof result.data?.account_number === "string" ? result.data.account_number : "";
    const bankName = typeof result.data?.bank_name === "string" ? result.data.bank_name : "";
    if (!providerResponse.ok || result.status?.toLowerCase() !== "success" || !accountNumber || !bankName) {
      console.error("[TopVerify virtual account] Flutterwave did not return account details", {
        httpStatus: providerResponse.status,
        providerStatus: result.status ?? "missing",
        responseCode: result.data?.response_code ?? "missing",
        txRef,
      });
      await admin.from("virtual_accounts").update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("tx_ref", txRef);
      return NextResponse.json({
        error: "Flutterwave could not create your permanent account. Your NIN was not saved by TopVerify. You can retry or use hosted payment.",
      }, { status: 502 });
    }

    const { error: saveError } = await admin.from("virtual_accounts").update({
      account_number: accountNumber,
      bank_name: bankName,
      provider_reference: result.data?.flw_ref ?? null,
      status: "active",
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("tx_ref", txRef);
    if (saveError) {
      console.error("[TopVerify virtual account] Could not save provider account details", { txRef, error: saveError.message });
      return NextResponse.json({ error: "Flutterwave created the account, but TopVerify could not save its details. Contact support before retrying." }, { status: 503 });
    }

    return NextResponse.json({ account: { account_number: accountNumber, bank_name: bankName, status: "active" } });
  } catch (error) {
    console.error("[TopVerify virtual account] Provider request failed", {
      txRef, message: error instanceof Error ? error.message.slice(0, 120) : "Unknown error",
    });
    await admin.from("virtual_accounts").update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("tx_ref", txRef);
    return NextResponse.json({ error: "Unable to reach Flutterwave. Your NIN was not saved by TopVerify. Retry or use hosted payment." }, { status: 502 });
  }
}
