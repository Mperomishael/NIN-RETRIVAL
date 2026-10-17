import { NextResponse } from "next/server";
import { requireSuperAdmin, writeAudit, type ServiceClient } from "@/lib/server/admin";
import { reconcileHostedTopups, reconcileVirtualAccountDeposits } from "@/lib/payments/flutterwave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function emailMap(admin: ServiceClient) {
  const map = new Map<string, { email: string; lastSignIn: string | null }>();
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data.users) map.set(u.id, { email: u.email ?? "", lastSignIn: u.last_sign_in_at ?? null });
    if (data.users.length < 1000) break;
  }
  return map;
}

async function names(admin: ServiceClient, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const { data } = await admin.from("profiles").select("id,full_name,business_name").in("id", unique);
  return new Map((data ?? []).map(p => [p.id as string, (p.business_name || p.full_name || "User") as string]));
}

export async function GET(request: Request) {
  const ctx = await requireSuperAdmin();
  if (!ctx) return reply({ error: "Administrator access required." }, 403);
  const { admin } = ctx;
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "overview";

  try {
    if (view === "overview") {
      const [{ data: stats }, { data: signups }, { data: recent }] = await Promise.all([
        admin.rpc("topverify_admin_stats"),
        admin.from("profiles").select("id,full_name,business_name,status,created_at").order("created_at", { ascending: false }).limit(6),
        admin.from("identity_requests").select("id,service_id,status,fee_kobo,request_reference,created_at,user_id").order("created_at", { ascending: false }).limit(8),
      ]);
      const userNames = await names(admin, (recent ?? []).map(r => r.user_id as string));
      const [{ data: svc }, { data: costRows }] = await Promise.all([
        admin.from("services").select("id,name,price_kobo,enabled"),
        admin.from("service_costs").select("service_id,cost_kobo"),
      ]);
      const costOf = new Map((costRows ?? []).map(c => [c.service_id as string, Number(c.cost_kobo)]));
      const alerts = (svc ?? []).filter(x => x.enabled).flatMap(x => {
        const price = Number(x.price_kobo);
        const cost = costOf.get(x.id as string) ?? 0;
        if (cost <= 0) return [{ id: x.id, name: x.name, price_kobo: price, cost_kobo: cost, kind: "nocost" }];
        if (price < cost) return [{ id: x.id, name: x.name, price_kobo: price, cost_kobo: cost, kind: "below" }];
        if ((price - cost) / price < 0.15) return [{ id: x.id, name: x.name, price_kobo: price, cost_kobo: cost, kind: "thin" }];
        return [];
      });
      return reply({
        stats,
        alerts,
        signups,
        recent: (recent ?? []).map(r => ({ ...r, user_name: userNames.get(r.user_id as string) ?? "User" })),
      });
    }

    if (view === "users") {
      const q = (params.get("q") ?? "").trim().slice(0, 80);
      const status = params.get("status") ?? "";
      const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
      const emails = await emailMap(admin);

      let query = admin.from("profiles")
        .select("id,full_name,phone,business_name,status,is_super_admin,created_at", { count: "exact" })
        .order("created_at", { ascending: false }).range((page - 1) * 25, page * 25 - 1);
      if (["pending", "approved", "restricted"].includes(status)) query = query.eq("status", status);
      if (q) {
        const safe = q.replace(/[%,()]/g, " ");
        const emailIds = [...emails.entries()].filter(([, v]) => v.email.toLowerCase().includes(q.toLowerCase())).map(([id]) => id);
        const clauses = [`full_name.ilike.%${safe}%`, `business_name.ilike.%${safe}%`, `phone.ilike.%${safe}%`];
        if (emailIds.length) clauses.push(`id.in.(${emailIds.slice(0, 50).join(",")})`);
        query = query.or(clauses.join(","));
      }
      const { data: users, count, error } = await query;
      if (error) throw error;
      const ids = (users ?? []).map(u => u.id as string);
      const [{ data: wallets }, { data: accounts }] = await Promise.all([
        ids.length ? admin.from("wallets").select("user_id,balance_kobo").in("user_id", ids) : Promise.resolve({ data: [] }),
        ids.length ? admin.from("virtual_accounts").select("user_id,status").in("user_id", ids) : Promise.resolve({ data: [] }),
      ]);
      const balance = new Map((wallets ?? []).map(w => [w.user_id as string, Number(w.balance_kobo)]));
      const account = new Map((accounts ?? []).map(a => [a.user_id as string, a.status as string]));
      return reply({
        total: count ?? 0,
        page,
        users: (users ?? []).map(u => ({
          ...u, email: emails.get(u.id as string)?.email ?? "",
          balance_kobo: balance.get(u.id as string) ?? 0, account_status: account.get(u.id as string) ?? "none",
        })),
      });
    }

    if (view === "user") {
      const id = params.get("id");
      if (!isUuid(id)) return reply({ error: "Invalid user." }, 400);
      const [{ data: profile }, { data: wallet }, { data: account }, { data: ledger }, { data: requests }, { data: topups }, { data: auditRows }, authUser] = await Promise.all([
        admin.from("profiles").select("*").eq("id", id).maybeSingle(),
        admin.from("wallets").select("balance_kobo").eq("user_id", id).maybeSingle(),
        admin.from("virtual_accounts").select("account_number,bank_name,status,created_at").eq("user_id", id).maybeSingle(),
        admin.from("wallet_ledger").select("id,entry_type,amount_kobo,reference,description,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(15),
        admin.from("identity_requests").select("id,service_id,status,fee_kobo,request_reference,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(15),
        admin.from("wallet_topups").select("id,tx_ref,amount_kobo,status,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
        admin.from("audit_logs").select("id,action,created_at,metadata").eq("target_user_id", id).order("created_at", { ascending: false }).limit(10),
        admin.auth.admin.getUserById(id),
      ]);
      if (!profile) return reply({ error: "User not found." }, 404);
      return reply({
        profile, email: authUser.data.user?.email ?? "", last_sign_in_at: authUser.data.user?.last_sign_in_at ?? null,
        balance_kobo: Number(wallet?.balance_kobo ?? 0), account, ledger, requests, topups, audit: auditRows,
      });
    }

    if (view === "requests") {
      const status = params.get("status") ?? "";
      const q = (params.get("q") ?? "").trim().slice(0, 60).replace(/[%,()]/g, " ");
      let query = admin.from("identity_requests")
        .select("id,user_id,service_id,status,fee_kobo,request_reference,provider_reference,error_code,created_at,completed_at")
        .order("created_at", { ascending: false }).limit(80);
      if (["queued", "processing", "completed", "failed", "refunded", "cancelled"].includes(status)) query = query.eq("status", status);
      if (q) query = query.ilike("request_reference", `%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      const userNames = await names(admin, (data ?? []).map(r => r.user_id as string));
      return reply({ requests: (data ?? []).map(r => ({ ...r, user_name: userNames.get(r.user_id as string) ?? "User" })) });
    }

    if (view === "payments") {
      const status = params.get("status") ?? "";
      let query = admin.from("wallet_topups")
        .select("id,user_id,tx_ref,amount_kobo,status,provider_reference,created_at,credited_at")
        .order("created_at", { ascending: false }).limit(80);
      if (["pending", "credited", "failed"].includes(status)) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      const userNames = await names(admin, (data ?? []).map(r => r.user_id as string));
      const { data: accounts } = await admin.from("virtual_accounts").select("status");
      const accountCounts = { active: 0, provisioning: 0, failed: 0 } as Record<string, number>;
      for (const a of accounts ?? []) accountCounts[a.status as string] = (accountCounts[a.status as string] ?? 0) + 1;
      return reply({ topups: (data ?? []).map(r => ({ ...r, user_name: userNames.get(r.user_id as string) ?? "User" })), accountCounts });
    }

    if (view === "pricing") {
      const [{ data: svc, error }, { data: costRows }] = await Promise.all([
        admin.from("services").select("id,name,description,category,price_kobo,enabled").order("category").order("name"),
        admin.from("service_costs").select("service_id,cost_kobo"),
      ]);
      if (error) throw error;
      const costOf = new Map((costRows ?? []).map(c => [c.service_id as string, Number(c.cost_kobo)]));
      return reply({ services: (svc ?? []).map(x => ({ ...x, cost_kobo: costOf.get(x.id as string) ?? 0 })) });
    }

    if (view === "audit") {
      const { data, error } = await admin.from("audit_logs")
        .select("id,actor_id,target_user_id,action,entity_type,entity_id,metadata,created_at")
        .order("created_at", { ascending: false }).limit(120);
      if (error) throw error;
      const userNames = await names(admin, (data ?? []).flatMap(r => [r.actor_id as string, r.target_user_id as string]));
      return reply({
        logs: (data ?? []).map(r => ({
          ...r, actor_name: r.actor_id ? userNames.get(r.actor_id as string) ?? "User" : "System",
          target_name: r.target_user_id ? userNames.get(r.target_user_id as string) ?? "User" : "",
        })),
      });
    }

    return reply({ error: "Unknown view." }, 400);
  } catch (error) {
    console.error("[TopVerify admin] GET failed", { view, reason: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    return reply({ error: "Could not load this admin view." }, 500);
  }
}

const rpcErrors: Record<string, string> = {
  INSUFFICIENT_BALANCE: "The wallet balance is too low for this debit.",
  INVALID_AMOUNT: "Enter a valid amount.",
  REASON_REQUIRED: "Add a short reason (at least 5 characters).",
  ALREADY_REFUNDED: "This request has already been refunded.",
  NOTHING_TO_REFUND: "This request has no fee to refund.",
  WALLET_NOT_FOUND: "Wallet not found.",
  REQUEST_NOT_FOUND: "Request not found.",
};
const rpcMessage = (message: string) => Object.entries(rpcErrors).find(([k]) => message.includes(k))?.[1] ?? "The action could not be completed.";

export async function POST(request: Request) {
  const ctx = await requireSuperAdmin();
  if (!ctx) return reply({ error: "Administrator access required." }, 403);
  const { admin, userId: actorId } = ctx;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return reply({ error: "Invalid request." }, 400); }
  const action = String(body.action ?? "");
  const targetId = body.userId;

  try {
    if (action === "set_status") {
      const status = String(body.status);
      if (!isUuid(targetId) || !["pending", "approved", "restricted"].includes(status)) return reply({ error: "Invalid request." }, 400);
      if (targetId === actorId) return reply({ error: "You cannot change your own account status." }, 400);
      const now = new Date().toISOString();
      const { error } = await admin.from("profiles").update({
        status, updated_at: now, ...(status === "approved" ? { authorization_reviewed_at: now } : {}),
      }).eq("id", targetId);
      if (error) throw error;
      await writeAudit(admin, actorId, targetId, `account_${status}`, "profile", targetId, {});
      return reply({ ok: true, message: `Account marked ${status}.` });
    }

    if (action === "set_admin") {
      if (!isUuid(targetId) || typeof body.value !== "boolean") return reply({ error: "Invalid request." }, 400);
      if (targetId === actorId) return reply({ error: "You cannot change your own administrator access." }, 400);
      const { error } = await admin.from("profiles").update({
        is_super_admin: body.value, updated_at: new Date().toISOString(),
        ...(body.value ? { status: "approved" } : {}),
      }).eq("id", targetId);
      if (error) throw error;
      await writeAudit(admin, actorId, targetId, body.value ? "admin_granted" : "admin_revoked", "profile", targetId, {});
      return reply({ ok: true, message: body.value ? "Administrator access granted." : "Administrator access removed." });
    }

    if (action === "update_profile") {
      if (!isUuid(targetId)) return reply({ error: "Invalid request." }, 400);
      const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const fullName = clean(body.fullName, 120);
      if (fullName.length < 2) return reply({ error: "Enter the user's full name." }, 400);
      const { error } = await admin.from("profiles").update({
        full_name: fullName, phone: clean(body.phone, 30) || null,
        business_name: clean(body.businessName, 160) || null, business_address: clean(body.businessAddress, 300) || null,
        updated_at: new Date().toISOString(),
      }).eq("id", targetId);
      if (error) throw error;
      await writeAudit(admin, actorId, targetId, "profile_updated", "profile", targetId, {});
      return reply({ ok: true, message: "Profile updated." });
    }

    if (action === "adjust_wallet") {
      const amount = Number(body.amountNaira);
      if (!isUuid(targetId) || !Number.isFinite(amount) || amount <= 0 || amount > 100000000) return reply({ error: "Enter a valid amount." }, 400);
      const { data, error } = await admin.rpc("topverify_admin_adjust_wallet", {
        p_admin_id: actorId, p_user_id: targetId, p_direction: String(body.direction),
        p_amount_kobo: Math.round(amount * 100), p_reason: String(body.reason ?? ""),
      });
      if (error) return reply({ error: rpcMessage(error.message) }, 400);
      return reply({ ok: true, message: "Wallet updated.", balance_after_kobo: (data as { balance_after_kobo?: number })?.balance_after_kobo });
    }

    if (action === "refund_request") {
      if (!isUuid(body.requestId)) return reply({ error: "Invalid request." }, 400);
      const { error } = await admin.rpc("topverify_admin_refund_request", {
        p_admin_id: actorId, p_request_id: body.requestId, p_reason: String(body.reason ?? ""),
      });
      if (error) return reply({ error: rpcMessage(error.message) }, 400);
      return reply({ ok: true, message: "Fee refunded to the customer's wallet." });
    }

    if (action === "save_service") {
      const serviceId = String(body.serviceId ?? "");
      const price = Number(body.priceNaira);
      const cost = Number(body.costNaira);
      const enabled = body.enabled === true;
      if (!/^[a-z0-9-]{2,60}$/.test(serviceId) || !Number.isFinite(price) || price < 0 || price > 10000000 || !Number.isFinite(cost) || cost < 0 || cost > 10000000) {
        return reply({ error: "Enter a valid price and cost." }, 400);
      }
      if (enabled && price <= 0) return reply({ error: "Set a price above zero before enabling a service." }, 400);
      const now = new Date().toISOString();
      const { data: before } = await admin.from("services").select("price_kobo,enabled").eq("id", serviceId).maybeSingle();
      if (!before) return reply({ error: "Service not found." }, 404);
      const { error: svcError } = await admin.from("services").update({ price_kobo: Math.round(price * 100), enabled, updated_at: now }).eq("id", serviceId);
      if (svcError) throw svcError;
      const { error: costError } = await admin.from("service_costs").upsert({ service_id: serviceId, cost_kobo: Math.round(cost * 100), updated_at: now });
      if (costError) throw costError;
      await writeAudit(admin, actorId, null, "service_updated", "service", serviceId, {
        price_kobo: Math.round(price * 100), cost_kobo: Math.round(cost * 100), enabled,
        previous_price_kobo: before.price_kobo, previous_enabled: before.enabled,
      });
      return reply({ ok: true, message: "Service saved." });
    }

    if (action === "reconcile_user") {
      if (!isUuid(targetId)) return reply({ error: "Invalid request." }, 400);
      let credited = 0;
      const hosted = await reconcileHostedTopups(targetId);
      credited += hosted.credited;
      const { data: account } = await admin.from("virtual_accounts").select("user_id,tx_ref,created_at,status").eq("user_id", targetId).maybeSingle();
      if (account?.status === "active") {
        const owner = await admin.auth.admin.getUserById(targetId);
        const va = await reconcileVirtualAccountDeposits(account, owner.data.user?.email ?? "");
        credited += va.credited;
      }
      await writeAudit(admin, actorId, targetId, "payments_reconciled", "wallet", targetId, { credited });
      return reply({ ok: true, message: credited > 0 ? `${credited} payment(s) credited.` : "No new payments found." });
    }

    if (action === "reset_link") {
      if (!isUuid(targetId)) return reply({ error: "Invalid request." }, 400);
      const owner = await admin.auth.admin.getUserById(targetId);
      const email = owner.data.user?.email;
      if (!email) return reply({ error: "User email not found." }, 404);
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
      const hashed = data?.properties?.hashed_token;
      if (error || !hashed) return reply({ error: "Could not generate a reset link." }, 500);
      const site = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
      await writeAudit(admin, actorId, targetId, "password_reset_link_generated", "profile", targetId, {});
      return reply({ ok: true, link: `${site}/auth/verified?token_hash=${encodeURIComponent(hashed)}&type=recovery` });
    }

    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("[TopVerify admin] POST failed", { action, reason: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    return reply({ error: "The action could not be completed." }, 500);
  }
}
