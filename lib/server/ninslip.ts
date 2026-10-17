export const providerBase = "https://api.ninslip.com";

export function safeServicePayload(serviceId: string, body: Record<string, unknown>): { endpoint: string; payload: Record<string, unknown> } {
  const str = (key: string) => typeof body[key] === "string" ? String(body[key]).trim() : "";
  const elevenDigits = (v: string) => /^\d{11}$/.test(v);
  if (serviceId === "nin-lookup" || serviceId === "nin-image-report") {
    if (!elevenDigits(str("nin"))) throw new Error("Enter a valid 11-digit NIN.");
    return { endpoint: "/nin/", payload: { number: str("nin") } };
  }
  if (serviceId === "phone-lookup") {
    const phone = str("phone").replace(/[\s-]/g, "");
    if (!/^(0\d{10}|234\d{10}|\+234\d{10})$/.test(phone)) throw new Error("Enter a valid Nigerian phone number.");
    const normalizedPhone = phone.startsWith("+234") ? "0" + phone.slice(4) : phone.startsWith("234") ? "0" + phone.slice(3) : phone;
    return { endpoint: "/phone/", payload: { number: normalizedPhone } };
  }
  if (serviceId === "phone-slip") {
    const phone = str("phone").replace(/[\s-]/g, "");
    if (!/^(0\d{10}|234\d{10}|\+234\d{10})$/.test(phone)) throw new Error("Enter a valid Nigerian phone number.");
    const normalizedPhone = phone.startsWith("+234") ? "0" + phone.slice(4) : phone.startsWith("234") ? "0" + phone.slice(3) : phone;
    const slipType = str("slipType") || "Standard Slip";
    if (!["Standard Slip", "Premium Slip", "Regular Slip", "Information Slip"].includes(slipType)) throw new Error("Choose a supported slip type.");
    return { endpoint: "/phone-slip/", payload: { phone: normalizedPhone, slip_type: slipType } };
  }
  if (serviceId === "tracking-id-lookup") {
    const trackingId = str("trackingId");
    if (!/^[A-Za-z0-9]{8,32}$/.test(trackingId)) throw new Error("Enter the tracking ID supplied by the identity provider.");
    return { endpoint: "/tracking-id/", payload: { number: trackingId } };
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
  if (serviceId === "nin-validation") {
    if (!elevenDigits(str("nin"))) throw new Error("Enter a valid 11-digit NIN.");
    const errorType = str("errorType");
    if (errorType.length < 2 || errorType.length > 80) throw new Error("Enter the validation issue label supplied by NINSlip.");
    return { endpoint: "/nin_validation/", payload: { nin: str("nin"), error_type: errorType } };
  }
  if (serviceId === "ipe-clearance") {
    const trackingId = str("trackingId");
    if (!/^[A-Za-z0-9]{8,32}$/.test(trackingId)) throw new Error("Enter the tracking ID supplied by the identity provider.");
    return { endpoint: "/ipe_clearance/", payload: { tracking_id: trackingId } };
  }
  if (serviceId === "nin-modification") {
    if (!elevenDigits(str("nin"))) throw new Error("Enter a valid 11-digit NIN.");
    const fieldCode = str("fieldCode");
    const modificationValue = str("modificationValue");
    const reason = str("modificationReason");
    const labels: Record<string, string> = { "032": "Correct Name", "033": "Phone Number", "034": "Gender", "035": "Date of Birth", "037": "Address" };
    if (!labels[fieldCode] || !modificationValue || !reason) throw new Error("Complete the modification type, corrected details and reason.");
    return { endpoint: "/nin_modification/", payload: {
      nin: str("nin"), field_code: fieldCode,
      modification_data: { [labels[fieldCode]]: modificationValue, Reason: reason }
    } };
  }
  throw new Error("This service is not enabled for live requests yet. Contact TopVerify support.");
}

export function providerSucceeded(httpOk: boolean, r: Record<string, unknown>) {
  if (!httpOk) return false;
  const status = typeof r.status === "string" ? r.status.toLowerCase() : r.status;
  if (status === false || (typeof status === "string" && ["error", "failed", "failure", "fail", "false"].includes(status))) return false;
  if (r.error) return false;
  if (status === true || (typeof status === "string" && ["success", "successful", "true", "ok", "verified"].includes(status))) return true;
  if (r.response_code === "00") return true;
  if (typeof r.message === "string" && /generated successfully|successful/i.test(r.message)) return true;
  return false;
}

export function describeProviderResponse(httpStatus: number, endpoint: string, r: Record<string, unknown>) {
  const kind = (v: unknown) => Array.isArray(v) ? `list(${v.length})` : v && typeof v === "object" ? `object(${Object.keys(v as object).length})` : typeof v;
  const nested = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object).slice(0, 40) : [];
  const data = r.data ?? r.verification ?? r.nin_data;
  return {
    http_status: httpStatus,
    endpoint,
    treated_as_success: providerSucceeded(httpStatus >= 200 && httpStatus < 300, r),
    provider_status: String(r.status ?? "").slice(0, 40),
    provider_code: String(r.response_code ?? r.code ?? "").slice(0, 20),
    provider_message: String(r.message ?? r.detail ?? r.error ?? "").slice(0, 240),
    top_level_fields: Object.fromEntries(Object.entries(r).slice(0, 40).map(([k, v]) => [k, kind(v)])),
    data_fields: nested(data),
  };
}
