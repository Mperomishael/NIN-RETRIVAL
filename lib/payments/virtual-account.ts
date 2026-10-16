import { randomUUID } from "node:crypto";
import { writeAudit, type ServiceClient } from "@/lib/server/admin";

export type ProvisionResult =
  | { ok: true; account: { account_number: string; bank_name: string; status: "active" }; alreadyExists?: boolean }
  | { ok: false; status: number; error: string };

export async function provisionVirtualAccount(
  admin: ServiceClient,
  user: { id: string; email: string },
  profile: { full_name: string | null; phone: string | null },
  nin: string
): Promise<ProvisionResult> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return { ok: false, status: 503, error: "Verification is temporarily unavailable. Please try again shortly." };

  const { data: existing, error: existingError } = await admin.from("virtual_accounts")
    .select("account_number,bank_name,status").eq("user_id", user.id).maybeSingle();
  if (existingError) return { ok: false, status: 503, error: "Unable to check your deposit account." };
  if (existing?.status === "active" && existing.account_number && existing.bank_name) {
    return { ok: true, account: { account_number: existing.account_number, bank_name: existing.bank_name, status: "active" }, alreadyExists: true };
  }
  if (existing?.status === "provisioning") {
    return { ok: false, status: 409, error: "Your account setup is already processing. Refresh shortly." };
  }

  const txRef = `TVVA-${user.id}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  if (existing) {
    const { error } = await admin.from("virtual_accounts").update({
      tx_ref: txRef, status: "provisioning", account_number: null, bank_name: null,
      provider_reference: null, updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("status", "failed");
    if (error) return { ok: false, status: 503, error: "Unable to restart account setup." };
  } else {
    const { error } = await admin.from("virtual_accounts").insert({ user_id: user.id, tx_ref: txRef, status: "provisioning" });
    if (error) {
      const { data: raced } = await admin.from("virtual_accounts").select("status,account_number,bank_name").eq("user_id", user.id).maybeSingle();
      if (raced?.status === "active" && raced.account_number && raced.bank_name) {
        return { ok: true, account: { account_number: raced.account_number, bank_name: raced.bank_name, status: "active" }, alreadyExists: true };
      }
      return { ok: false, status: 409, error: "Account setup has already started. Refresh shortly." };
    }
  }

  const markFailed = () => admin.from("virtual_accounts")
    .update({ status: "failed", updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("tx_ref", txRef);

  const parts = (profile.full_name || user.email).trim().split(/\s+/);
  const firstname = parts[0] || "TopVerify";
  const lastname = parts.slice(1).join(" ") || "Customer";

  try {
    const response = await fetch("https://api.flutterwave.com/v3/virtual-account-numbers", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: user.email, tx_ref: txRef, is_permanent: true, nin, firstname, lastname,
        phonenumber: profile.phone || undefined,
        narration: (profile.full_name || firstname).trim().slice(0, 35),
        bank_code: "090567",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => ({})) as {
      status?: string;
      data?: { account_number?: string; bank_name?: string; flw_ref?: string; response_code?: string };
    };
    const accountNumber = typeof result.data?.account_number === "string" ? result.data.account_number : "";
    const bankName = typeof result.data?.bank_name === "string" ? result.data.bank_name : "";

    if (!response.ok || result.status?.toLowerCase() !== "success" || !accountNumber || !bankName) {
      console.error("[TopVerify virtual account] Flutterwave rejected account creation", {
        httpStatus: response.status, providerStatus: result.status ?? "missing",
        responseCode: result.data?.response_code ?? "missing", txRef,
      });
      await markFailed();
      return { ok: false, status: 422, error: "We could not verify this NIN. Check the number and try again." };
    }

    const { error: saveError } = await admin.from("virtual_accounts").update({
      account_number: accountNumber, bank_name: bankName, provider_reference: result.data?.flw_ref ?? null,
      status: "active", updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("tx_ref", txRef);
    if (saveError) {
      console.error("[TopVerify virtual account] Could not save account details", { txRef, error: saveError.message });
      return { ok: false, status: 503, error: "Your account was verified but could not be saved. Contact support before retrying." };
    }
    return { ok: true, account: { account_number: accountNumber, bank_name: bankName, status: "active" } };
  } catch (error) {
    console.error("[TopVerify virtual account] Provider request failed", {
      txRef, message: error instanceof Error ? error.message.slice(0, 120) : "Unknown error",
    });
    await markFailed();
    return { ok: false, status: 503, error: "Verification is temporarily unavailable. Please try again shortly." };
  }
}

export async function approveProfileIfPending(admin: ServiceClient, userId: string) {
  const now = new Date().toISOString();
  const { data } = await admin.from("profiles")
    .update({ status: "approved", authorization_reviewed_at: now, updated_at: now })
    .eq("id", userId).eq("status", "pending").select("id");
  if (data && data.length > 0) {
    await writeAudit(admin, null, userId, "account_auto_approved", "profile", userId, { method: "nin_verified_deposit_account" });
    return true;
  }
  return false;
}
