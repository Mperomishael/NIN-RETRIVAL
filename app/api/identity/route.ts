import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providerBase = "https://api.ninslip.com";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server billing configuration is incomplete.");
  return createSupabaseAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function safeServicePayload(serviceId: string, body: Record<string, unknown>) {
  const str = (key: string) => typeof body[key] === "string" ? String(body[key]).trim() : "";
  const elevenDigits = (v: string) => /^\d{11}$/.test(v);
  if (serviceId === "nin-lookup") {
    if (!elevenDigits(str("nin"))) throw new Error("Enter a valid 11-digit NIN.");
    return { endpoint: "/nin/", payload: { number: str("nin") } };
  }
  if (serviceId === "phone-lookup") {
    const phone = str("phone").replace(/[\\s-]/g, "");
    if (!/^(0\\d{10}|234\\d{10}|\\+234\\d{10})$/.test(phone)) throw new Error("Enter a valid Nigerian phone number.");
    const normalizedPhone = phone.startsWith("+234") ? "0" + phone.slice(4) : phone.startsWith("234") ? "0" + phone.slice(3) : phone;
    return { endpoint: "/phone/", payload: { number: normalizedPhone } };
  }
  if (serviceId === "bvn-verify") {
    if (!elevenDigits(str("bvn"))) throw new Error("Enter a valid 11-digit BVN.");
    return { endpoint: "/bvn/", payload: { number: str("bvn") } };
  }
  if (serviceId === "demographic") {
    const firstName = str("firstName");
    const lastName = str("lastName");
    const gender = str("gender").toLowerCase();
    const dateOfBirth = str("dateOfBirth");
    if (!firstName || !lastName || !["m", "f"].includes(gender) || !/^\d{2}-\d{2}-\d{4}$/.test(dateOfBirth)) {
      throw new Error("Enter first name, last name, gender, and date of birth in DD-MM-YYYY format.");
    }
    return { endpoint: "/demography/", payload: { firstName, lastName, gender, dateOfBirth, ref: `TV-${crypto.randomUUID()}` } };
  }
  if (serviceId === "nin-slip") {
    if (!elevenDigits(str("nin"))) throw new Error("Enter a valid 11-digit NIN.");
    const slipType = str("slipType") || "Standard Slip";
    if (!["Standard Slip", "Premium Slip", "Regular Slip", "Information Slip"].includes(slipType)) throw new Error("Choose a supported slip type.");
    return { endpoint: "/nin-slip/", payload: { nin: str("nin"), slip_type: slipType } };
  }
  if (serviceId === "bvn-slip") {
    if (!elevenDigits(str("bvn"))) throw new Error("Enter a valid 11-digit BVN.");
    return { endpoint: "/bvn-slip/", payload: { bvn: str("bvn"), slip_type: str("slipType") || "Standard Slip" } };
  }
  throw new Error("This service is not enabled for live requests yet. Contact TopVerify support.");
}

function minimalResult(serviceId: string, response: Record<string, unknown>) {
  const slip = response.slip as Record<string, unknown> | undefined;
  const data = response.data as Record<string, unknown> | undefined;
  const verification = response.verification as Record<string, unknown> | undefined;
  return {
    service_id: serviceId,
    provider_status: String(response.status ?? verification?.status ?? "unknown"),
    report_reference: String(response.reportID ?? response.reference ?? verification?.reference ?? ""),
    slip_file_name: slip && typeof slip.file_name === "string" ? slip.file_name : null,
    has_pdf: Boolean(slip && typeof slip.pdf_base64 === "string" && slip.pdf_base64.length > 100),
    returned_fields: data ? Object.keys(data).filter(k => !["photo", "signature"].includes(k)) : [],
  };
}

export async function POST(request: Request) {
  let requestId: string | null = null;
  const server = await createSupabaseServerClient();
  const { data: authData, error: authError } = await server.auth.getUser();
  if (authError || !authData.user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const allowedPurposes = ["Customer onboarding / KYC with consent", "Data subject requested their own record", "Compliance verification with lawful basis"];
  const purpose = typeof body.purpose === "string" ? body.purpose : "";
  if (!allowedPurposes.includes(purpose)) return NextResponse.json({ error: "Select a valid purpose for this identity request." }, { status: 400 });
  if (body.consent !== true) return NextResponse.json({ error: "Confirm that you have the data subject’s authorization and consent for this specific request." }, { status: 400 });

  let requestPayload: { endpoint: string; payload: Record<string, string> };
  try { requestPayload = safeServicePayload(serviceId, body); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request details." }, { status: 400 }); }

  const apiKey = process.env.NINSLIP_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Identity provider is not configured. Contact TopVerify support." }, { status: 503 });

  const reference = `TV-${crypto.randomUUID()}`;
  let admin: ReturnType<typeof adminClient>;
  try { admin = adminClient(); }
  catch { return NextResponse.json({ error: "Wallet service is not configured. Contact TopVerify support." }, { status: 503 }); }

  const { data: reservation, error: reserveError } = await admin.rpc("topverify_reserve_request", {
    p_user_id: authData.user.id,
    p_service_id: serviceId,
    p_request_reference: reference,
    p_consent_confirmed_at: new Date().toISOString(),
    p_purpose: purpose,
  });
  if (reserveError || !reservation) {
    const message = reserveError?.message ?? "Unable to reserve this request.";
    if (message.includes("ACCOUNT_NOT_APPROVED")) return NextResponse.json({ error: "Your account is awaiting approval. You can use live identity services after TopVerify approves your KYC." }, { status: 403 });
    if (message.includes("INSUFFICIENT_BALANCE")) return NextResponse.json({ error: "Insufficient wallet balance. Fund your wallet before making this request." }, { status: 402 });
    if (message.includes("SERVICE_UNAVAILABLE")) return NextResponse.json({ error: "This service is currently unavailable." }, { status: 409 });
    if (message.includes("TERMS_NOT_ACCEPTED")) return NextResponse.json({ error: "Accept the current acceptable-use terms before making requests." }, { status: 403 });
    if (message.includes("INVALID_REQUEST_PURPOSE")) return NextResponse.json({ error: "Select a valid purpose for this identity request." }, { status: 400 });
    return NextResponse.json({ error: "Could not reserve the request. Please try again or contact support." }, { status: 400 });
  }
  requestId = String(reservation.request_id);

  try {
    const upstream = await fetch(providerBase + requestPayload.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload.payload),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    const response = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    const statusText = String(response.status ?? "");
    const verified = upstream.ok && (statusText === "success" || response.response_code === "00" || response.message === "NIN Slip Generated Successfully" || response.message === "Phone NIN Slip Generated Successfully" || response.message === "BVN Slip Generated Successfully");
    if (!verified) {
      await admin.rpc("topverify_finalize_request", { p_request_id: requestId, p_status: "failed", p_provider_reference: String(response.reportID ?? response.reference ?? ""), p_result_summary: {}, p_error_code: "PROVIDER_FAILED" });
      return NextResponse.json({ error: "The provider could not complete this request. Your TopVerify service fee has been refunded if it was reserved. Please check the reference before retrying." }, { status: 502 });
    }

    const summary = minimalResult(serviceId, response);
    await admin.rpc("topverify_finalize_request", {
      p_request_id: requestId,
      p_status: "completed",
      p_provider_reference: summary.report_reference || reference,
      p_result_summary: summary,
      p_error_code: null,
    });

    const slip = response.slip as Record<string, unknown> | undefined;
    const pdfBase64 = slip && typeof slip.pdf_base64 === "string" ? slip.pdf_base64 : null;
    const data = response.data && typeof response.data === "object" ? response.data : response.verification && typeof response.verification === "object" ? response.verification : null;
    return NextResponse.json({
      ok: true,
      reference,
      serviceId,
      message: String(response.message ?? "Request completed."),
      result: data,
      slip: pdfBase64 ? { fileName: String(slip?.file_name ?? "TopVerify-slip.pdf"), mimeType: "application/pdf", base64: pdfBase64 } : null,
      note: "Identity results are sensitive. Store or share them only for the authorized purpose.",
    });
  } catch {
    await admin.rpc("topverify_finalize_request", { p_request_id: requestId, p_status: "failed", p_provider_reference: reference, p_result_summary: {}, p_error_code: "PROVIDER_UNAVAILABLE" });
    return NextResponse.json({ error: "The identity provider timed out or could not be reached. Your reserved service fee has been refunded if the failure was recorded. Check request history before retrying." }, { status: 502 });
  }
}
