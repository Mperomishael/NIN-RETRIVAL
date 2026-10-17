"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Ban, Check, Copy, CreditCard, FileText, KeyRound, LayoutDashboard, Minus, Plus, RefreshCw, Receipt,
  ScrollText, Search, ShieldCheck, UserCheck, Users, Wallet,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useConfirm } from "@/components/ui/Confirm";
import { dateText, money } from "@/lib/format";

type Tab = "overview" | "users" | "requests" | "payments" | "pricing" | "audit";
type Notice = (message: string, error?: boolean) => void;

const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "requests", label: "Requests", icon: FileText },
  { id: "payments", label: "Payments", icon: Receipt },
  { id: "pricing", label: "Pricing", icon: CreditCard },
  { id: "audit", label: "Audit log", icon: ScrollText },
];

const statusClass = (status: string) =>
  ["approved", "credited", "completed", "active"].includes(status) ? "tv-table-status tv-table-success"
  : ["failed", "restricted", "refunded", "cancelled"].includes(status) ? "tv-table-status tv-table-failed"
  : "tv-table-status tv-table-pending";

function useAdminData<T>(query: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const counter = useRef(0);
  const load = useCallback(async () => {
    const id = ++counter.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin?${query}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (id !== counter.current) return;
      if (!response.ok) throw new Error(body.error || "Could not load this view.");
      setData(body as T);
    } catch (err) {
      if (id === counter.current) setError(err instanceof Error ? err.message : "Could not load this view.");
    } finally {
      if (id === counter.current) setLoading(false);
    }
  }, [query]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load };
}

async function adminPost(body: Record<string, unknown>) {
  const response = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The action could not be completed.");
  return payload as { message?: string; link?: string; balance_after_kobo?: number };
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="tv-skeleton-list" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="tv-skeleton" style={{ animationDelay: `${i * 0.08}s` }} />)}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="tv-empty"><span>{text}</span></div>;
}

function Failed({ message, retry }: { message: string; retry: () => void }) {
  return <div className="tv-inline-alert"><span>{message}</span><button type="button" className="tv-text-btn" onClick={retry}>Retry</button></div>;
}

function Pills<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return <div className="tv-pills" role="tablist">{options.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={value === key} className={value === key ? "tv-pill tv-pill-active" : "tv-pill"} onClick={() => onChange(key)}>{label}</button>)}</div>;
}

export function AdminConsole({ currentUserId, onRefreshServices, onNotice, initialTab = "overview" }: {
  currentUserId: string;
  onRefreshServices: () => void;
  onNotice: Notice;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <>
      <div className="tv-page-heading">
        <div>
          <h1>Admin console</h1>
        </div>
      </div>
      <nav className="tv-admin-tabs" aria-label="Admin sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={tab === id ? "tv-admin-tab tv-admin-tab-active" : "tv-admin-tab"} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>
      <div className="tv-admin-body" key={tab}>
        {tab === "overview" && <Overview onOpenTab={setTab} />}
        {tab === "users" && <UsersTab currentUserId={currentUserId} onNotice={onNotice} />}
        {tab === "requests" && <RequestsTab onNotice={onNotice} />}
        {tab === "payments" && <PaymentsTab onNotice={onNotice} />}
        {tab === "pricing" && <PricingTab onRefresh={onRefreshServices} onNotice={onNotice} />}
        {tab === "audit" && <AuditTab />}
      </div>
    </>
  );
}

type Stats = {
  users: { total: number; pending: number; approved: number; restricted: number; admins: number };
  wallet_liability_kobo: number; funded_month_kobo: number; funded_total_kobo: number;
  revenue_month_kobo: number; revenue_total_kobo: number; cost_month_kobo: number; cost_total_kobo: number;
  loss_requests: number; loss_total_kobo: number; pending_topups: number;
  requests: { total: number; today: number; processing: number; completed: number; failed: number };
  daily: Array<{ day: string; requests: number; revenue_kobo: number; profit_kobo: number }>;
};

type PricingAlert = { id: string; name: string; price_kobo: number; cost_kobo: number; kind: "below" | "nocost" | "thin" };

function Overview({ onOpenTab }: { onOpenTab: (tab: Tab) => void }) {
  const { data, loading, error, reload } = useAdminData<{ stats: Stats; alerts: PricingAlert[]; signups: Array<{ id: string; full_name: string; business_name: string | null; status: string; created_at: string }>; recent: Array<{ id: string; user_name: string; service_id: string; status: string; fee_kobo: number; request_reference: string; created_at: string }> }>("view=overview");
  const [metric, setMetric] = useState<"revenue" | "profit">("profit");
  if (loading && !data) return <Skeleton rows={5} />;
  if (error || !data?.stats) return <Failed message={error || "No data."} retry={reload} />;
  const s = data.stats;
  const profitMonth = s.revenue_month_kobo - s.cost_month_kobo;
  const profitTotal = s.revenue_total_kobo - s.cost_total_kobo;
  const value = (d: Stats["daily"][number]) => metric === "profit" ? Math.max(0, d.profit_kobo) : d.revenue_kobo;
  const maxValue = Math.max(1, ...s.daily.map(value));
  const below = data.alerts.filter(a => a.kind === "below");
  const noCost = data.alerts.filter(a => a.kind === "nocost");
  const thin = data.alerts.filter(a => a.kind === "thin");
  const cards: Array<[string, string, string, ReactNode]> = [
    ["Profit this month", money(profitMonth), `${money(s.revenue_month_kobo)} revenue, ${money(s.cost_month_kobo)} cost`, <CreditCard size={18} key="p" />],
    ["Wallet balances", money(s.wallet_liability_kobo), "Owed to customers", <Wallet size={18} key="w" />],
    ["Funded this month", money(s.funded_month_kobo), `${s.pending_topups} pending top-ups`, <Receipt size={18} key="f" />],
    ["Users", String(s.users.total), `${s.users.pending} pending, ${s.users.restricted} restricted`, <Users size={18} key="u" />],
  ];
  return (
    <>
      {(below.length > 0 || s.loss_requests > 0) && (
        <div className="tv-alert-card tv-alert-danger tv-rise" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>{below.length > 0 ? `${below.length} service${below.length > 1 ? "s are" : " is"} priced below cost` : "Requests were sold below cost"}</strong>
            {below.map(a => <span key={a.id}>{a.name}: sold at {money(a.price_kobo)}, costs {money(a.cost_kobo)} (loses {money(a.cost_kobo - a.price_kobo)} each)</span>)}
            {s.loss_requests > 0 && <span>{s.loss_requests} past request{s.loss_requests > 1 ? "s" : ""} lost {money(s.loss_total_kobo)} in total</span>}
          </div>
          <button type="button" className="tv-button-danger tv-btn-sm" onClick={() => onOpenTab("pricing")}>Fix pricing</button>
        </div>
      )}
      {(noCost.length > 0 || thin.length > 0) && (
        <div className="tv-alert-card tv-alert-warn tv-rise">
          <AlertTriangle size={20} />
          <div>
            {noCost.length > 0 && <><strong>Cost not set for {noCost.length} service{noCost.length > 1 ? "s" : ""}</strong><span>{noCost.map(a => a.name).join(", ")}. Profit for these is overstated.</span></>}
            {thin.length > 0 && <><strong>Thin margin</strong><span>{thin.map(a => `${a.name} (${money(a.price_kobo - a.cost_kobo)})`).join(", ")}</span></>}
          </div>
          <button type="button" className="tv-button-secondary tv-btn-sm" onClick={() => onOpenTab("pricing")}>Review</button>
        </div>
      )}
      <div className="tv-stat-grid">
        {cards.map(([label, val, hint, icon], i) => (
          <div className="tv-stat-card tv-rise" style={{ animationDelay: `${i * 0.06}s` }} key={label}>
            <div><span>{label}</span><div className="tv-stat-icon tv-blue">{icon}</div></div>
            <strong className={label === "Profit this month" && profitMonth < 0 ? "tv-negative" : ""}>{val}</strong><small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="tv-admin-grid">
        <section className="tv-panel">
          <div className="tv-panel-heading">
            <div><h2>Last 7 days</h2><p>{money(profitTotal)} profit all time on {money(s.revenue_total_kobo)} revenue</p></div>
            <Pills value={metric} onChange={setMetric} options={[["profit", "Profit"], ["revenue", "Revenue"]]} />
          </div>
          <div className="tv-chart" role="img" aria-label="Last seven days">
            {s.daily.map((d, i) => (
              <div className="tv-chart-col" key={d.day}>
                <span className="tv-chart-value">{d.requests}</span>
                <div className="tv-chart-bar" style={{ height: `${Math.max(6, (value(d) / maxValue) * 100)}%`, animationDelay: `${i * 0.05}s` }} title={money(metric === "profit" ? d.profit_kobo : d.revenue_kobo)} />
                <span className="tv-chart-label">{new Date(d.day).toLocaleDateString("en-NG", { weekday: "short" })}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="tv-panel">
          <div className="tv-panel-heading"><div><h2>Requests</h2><p>{s.requests.today} today</p></div><button type="button" className="tv-text-btn" onClick={() => onOpenTab("requests")}>View all</button></div>
          <ul className="tv-metric-list">
            <li><span>Total</span><strong>{s.requests.total}</strong></li>
            <li><span>Completed</span><strong>{s.requests.completed}</strong></li>
            <li><span>Processing</span><strong>{s.requests.processing}</strong></li>
            <li><span>Failed or refunded</span><strong>{s.requests.failed}</strong></li>
          </ul>
        </section>
      </div>
      <div className="tv-admin-grid">
        <section className="tv-panel">
          <div className="tv-panel-heading"><div><h2>Recent requests</h2></div></div>
          {data.recent.length === 0 ? <Empty text="No requests yet." /> : (
            <ul className="tv-feed">{data.recent.map(r => (
              <li key={r.id}><div><strong>{r.user_name}</strong><small>{r.service_id} · {dateText(r.created_at)}</small></div><span className={statusClass(r.status)}>{r.status}</span></li>
            ))}</ul>
          )}
        </section>
        <section className="tv-panel">
          <div className="tv-panel-heading"><div><h2>New users</h2></div><button type="button" className="tv-text-btn" onClick={() => onOpenTab("users")}>Manage</button></div>
          {data.signups.length === 0 ? <Empty text="No users yet." /> : (
            <ul className="tv-feed">{data.signups.map(u => (
              <li key={u.id}><div><strong>{u.business_name || u.full_name}</strong><small>{dateText(u.created_at)}</small></div><span className={statusClass(u.status)}>{u.status}</span></li>
            ))}</ul>
          )}
        </section>
      </div>
    </>
  );
}

type UserRow = { id: string; full_name: string; email: string; phone: string | null; business_name: string | null; status: string; is_super_admin: boolean; created_at: string; balance_kobo: number; account_status: string };

function UsersTab({ currentUserId, onNotice }: { currentUserId: string; onNotice: Notice }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "pending" | "approved" | "restricted">("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setSearch(q); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
  const { data, loading, error, reload } = useAdminData<{ users: UserRow[]; total: number }>(`view=users&q=${encodeURIComponent(search)}&status=${status}&page=${page}`);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));

  return (
    <>
      <div className="tv-toolbar">
        <div className="tv-searchbar"><Search size={17} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, business, phone or email" aria-label="Search users" /></div>
        <Pills value={status} onChange={v => { setStatus(v); setPage(1); }} options={[["", "All"], ["pending", "Pending"], ["approved", "Approved"], ["restricted", "Restricted"]]} />
      </div>
      <section className="tv-panel tv-history-panel">
        {loading && !data ? <Skeleton /> : error ? <Failed message={error} retry={reload} /> : !data?.users.length ? <Empty text="No users match." /> : (
          <div className="tv-table-scroll">
            <table className="tv-table tv-table-click">
              <thead><tr><th>USER</th><th>EMAIL</th><th>STATUS</th><th>WALLET</th><th>DEPOSIT ACCOUNT</th><th>JOINED</th></tr></thead>
              <tbody>{data.users.map(u => (
                <tr key={u.id} tabIndex={0} onClick={() => setOpenId(u.id)} onKeyDown={e => { if (e.key === "Enter") setOpenId(u.id); }}>
                  <td data-label="USER"><strong>{u.business_name || u.full_name}</strong>{u.is_super_admin && <small className="tv-admin-badge">Admin</small>}</td>
                  <td data-label="EMAIL">{u.email || "-"}</td>
                  <td data-label="STATUS"><span className={statusClass(u.status)}>{u.status}</span></td>
                  <td data-label="WALLET">{money(u.balance_kobo)}</td>
                  <td data-label="DEPOSIT ACCOUNT"><span className={statusClass(u.account_status === "none" ? "pending" : u.account_status)}>{u.account_status === "none" ? "Not set up" : u.account_status}</span></td>
                  <td data-label="JOINED">{dateText(u.created_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="tv-pager">
            <button type="button" className="tv-button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="tv-button-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </section>
      {openId && <UserModal id={openId} currentUserId={currentUserId} onClose={() => setOpenId(null)} onChanged={reload} onNotice={onNotice} />}
    </>
  );
}

type UserDetail = {
  profile: { id: string; full_name: string; phone: string | null; business_name: string | null; business_address: string | null; intended_use: string | null; status: string; is_super_admin: boolean; created_at: string };
  email: string; last_sign_in_at: string | null; balance_kobo: number;
  account: { account_number: string; bank_name: string; status: string } | null;
  ledger: Array<{ id: string; entry_type: string; amount_kobo: number; reference: string; description: string; created_at: string }>;
  requests: Array<{ id: string; service_id: string; status: string; fee_kobo: number; request_reference: string; created_at: string }>;
  topups: Array<{ id: string; tx_ref: string; amount_kobo: number; status: string; created_at: string }>;
  audit: Array<{ id: string; action: string; created_at: string }>;
};

function UserModal({ id, currentUserId, onClose, onChanged, onNotice }: { id: string; currentUserId: string; onClose: () => void; onChanged: () => void; onNotice: Notice }) {
  const [open, setOpen] = useState(true);
  const { data, loading, error, reload } = useAdminData<UserDetail>(`view=user&id=${id}`);
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<"account" | "wallet" | "activity">("account");
  const [busy, setBusy] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState<{ fullName: string; phone: string; businessName: string; businessAddress: string } | null>(null);
  const [resetLink, setResetLink] = useState("");
  const self = id === currentUserId;
  const close = () => { setOpen(false); setTimeout(onClose, 200); };

  async function run(key: string, body: Record<string, unknown>, after?: (r: Awaited<ReturnType<typeof adminPost>>) => void) {
    setBusy(key);
    try {
      const result = await adminPost({ ...body, userId: id });
      if (result.message) onNotice(result.message);
      after?.(result);
      await reload();
      onChanged();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "The action could not be completed.", true);
    } finally {
      setBusy("");
    }
  }

  async function setStatus(status: "approved" | "restricted" | "pending") {
    const labels = { approved: "Approve", restricted: "Restrict", pending: "Set to pending" } as const;
    const ok = await confirm({
      title: `${labels[status]} this account?`,
      message: status === "restricted" ? "The user will be blocked from making new requests." : status === "approved" ? "The user will be able to make live requests." : "The user will need to verify their NIN again to be approved.",
      confirmLabel: labels[status], tone: status === "restricted" ? "danger" : "default",
    });
    if (ok) await run("status", { action: "set_status", status });
  }

  async function toggleAdmin(value: boolean) {
    const ok = await confirm({
      title: value ? "Grant administrator access?" : "Remove administrator access?",
      message: value ? "This user will get full control of the platform, including wallets and pricing." : "This user will lose access to the admin console.",
      confirmLabel: value ? "Grant access" : "Remove access", tone: "danger",
    });
    if (ok) await run("admin", { action: "set_admin", value });
  }

  async function adjust(event: FormEvent) {
    event.preventDefault();
    const naira = Number(amount);
    if (!Number.isFinite(naira) || naira <= 0) { onNotice("Enter a valid amount.", true); return; }
    const ok = await confirm({
      title: `${direction === "credit" ? "Credit" : "Debit"} ${money(Math.round(naira * 100))}?`,
      message: `This changes the wallet balance immediately and is recorded in the ledger and audit log. Reason: ${reason || "none given"}.`,
      confirmLabel: direction === "credit" ? "Credit wallet" : "Debit wallet", tone: direction === "debit" ? "danger" : "default",
    });
    if (!ok) return;
    await run("wallet", { action: "adjust_wallet", direction, amountNaira: naira, reason }, () => { setAmount(""); setReason(""); });
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!edit) return;
    await run("profile", { action: "update_profile", ...edit }, () => setEdit(null));
  }

  const p = data?.profile;
  return (
    <>
      <Modal open={open} onClose={close} size="lg" title={p ? (p.business_name || p.full_name) : "User"} subtitle={data?.email} icon={<Users size={20} />}
        footer={<button type="button" className="tv-button-secondary" onClick={close}>Close</button>}>
        {loading && !data ? <Skeleton /> : error || !p || !data ? <Failed message={error || "Not found."} retry={reload} /> : (
          <div className="tv-user-modal">
            <div className="tv-user-summary">
              <span className={statusClass(p.status)}>{p.status}</span>
              {p.is_super_admin && <span className="tv-admin-badge">Administrator</span>}
              <span className="tv-user-balance"><Wallet size={15} /> {money(data.balance_kobo)}</span>
            </div>
            <Pills value={view} onChange={setView} options={[["account", "Account"], ["wallet", "Wallet"], ["activity", "Activity"]]} />

            {view === "account" && (
              <div className="tv-user-section">
                {edit ? (
                  <form className="tv-form" onSubmit={saveProfile}>
                    <label className="tv-field"><span className="tv-field-label">Full name</span><input required value={edit.fullName} onChange={e => setEdit({ ...edit, fullName: e.target.value })} /></label>
                    <div className="tv-two-fields">
                      <label className="tv-field"><span className="tv-field-label">Phone</span><input value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></label>
                      <label className="tv-field"><span className="tv-field-label">Business</span><input value={edit.businessName} onChange={e => setEdit({ ...edit, businessName: e.target.value })} /></label>
                    </div>
                    <label className="tv-field"><span className="tv-field-label">Address</span><input value={edit.businessAddress} onChange={e => setEdit({ ...edit, businessAddress: e.target.value })} /></label>
                    <div className="tv-actions-row">
                      <button type="button" className="tv-button-secondary" onClick={() => setEdit(null)}>Cancel</button>
                      <button type="submit" className="tv-button-primary" disabled={busy === "profile"}>Save profile</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <dl className="tv-kv">
                      <div><dt>Full name</dt><dd>{p.full_name}</dd></div>
                      <div><dt>Phone</dt><dd>{p.phone || "-"}</dd></div>
                      <div><dt>Business</dt><dd>{p.business_name || "-"}</dd></div>
                      <div><dt>Address</dt><dd>{p.business_address || "-"}</dd></div>
                      <div><dt>Joined</dt><dd>{dateText(p.created_at)}</dd></div>
                      <div><dt>Last sign-in</dt><dd>{data.last_sign_in_at ? dateText(data.last_sign_in_at) : "Never"}</dd></div>
                      <div><dt>Deposit account</dt><dd>{data.account?.status === "active" ? `${data.account.bank_name} · ${data.account.account_number}` : "Not set up"}</dd></div>
                    </dl>
                    <div className="tv-actions-grid">
                      <button type="button" className="tv-button-secondary" onClick={() => setEdit({ fullName: p.full_name, phone: p.phone ?? "", businessName: p.business_name ?? "", businessAddress: p.business_address ?? "" })}>Edit profile</button>
                      {p.status !== "approved" && <button type="button" className="tv-button-primary" disabled={!!busy || self} onClick={() => void setStatus("approved")}><UserCheck size={16} /> Approve</button>}
                      {p.status !== "restricted" && <button type="button" className="tv-button-danger" disabled={!!busy || self} onClick={() => void setStatus("restricted")}><Ban size={16} /> Restrict</button>}
                      {p.status === "approved" && <button type="button" className="tv-button-secondary" disabled={!!busy || self} onClick={() => void setStatus("pending")}>Set pending</button>}
                      <button type="button" className="tv-button-secondary" disabled={!!busy || self} onClick={() => void toggleAdmin(!p.is_super_admin)}><ShieldCheck size={16} /> {p.is_super_admin ? "Remove admin" : "Make admin"}</button>
                      <button type="button" className="tv-button-secondary" disabled={!!busy} onClick={() => void run("reset", { action: "reset_link" }, r => setResetLink(r.link ?? ""))}><KeyRound size={16} /> Reset link</button>
                      <button type="button" className="tv-button-secondary" disabled={!!busy} onClick={() => void run("recon", { action: "reconcile_user" })}><RefreshCw size={16} className={busy === "recon" ? "tv-spin" : ""} /> Re-check payments</button>
                    </div>
                    {resetLink && (
                      <div className="tv-copy-row">
                        <input readOnly value={resetLink} aria-label="Password reset link" onFocus={e => e.currentTarget.select()} />
                        <button type="button" className="tv-button-secondary" onClick={() => { void navigator.clipboard?.writeText(resetLink); onNotice("Link copied."); }}><Copy size={16} /> Copy</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {view === "wallet" && (
              <div className="tv-user-section">
                <form className="tv-form tv-adjust" onSubmit={adjust}>
                  <div className="tv-segment" role="radiogroup" aria-label="Adjustment type">
                    <button type="button" role="radio" aria-checked={direction === "credit"} className={direction === "credit" ? "tv-segment-on" : ""} onClick={() => setDirection("credit")}><Plus size={15} /> Credit</button>
                    <button type="button" role="radio" aria-checked={direction === "debit"} className={direction === "debit" ? "tv-segment-on" : ""} onClick={() => setDirection("debit")}><Minus size={15} /> Debit</button>
                  </div>
                  <div className="tv-two-fields">
                    <label className="tv-field"><span className="tv-field-label">Amount (NGN)</span><input required type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="5000" /></label>
                    <label className="tv-field"><span className="tv-field-label">Reason</span><input required minLength={5} maxLength={150} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this needed?" /></label>
                  </div>
                  <button type="submit" className="tv-button-primary" disabled={busy === "wallet"}>{busy === "wallet" ? "Applying" : "Apply adjustment"}</button>
                </form>
                <h3 className="tv-subheading">Recent ledger</h3>
                {data.ledger.length === 0 ? <Empty text="No ledger entries." /> : (
                  <ul className="tv-feed">{data.ledger.map(l => (
                    <li key={l.id}><div><strong>{l.description}</strong><small>{dateText(l.created_at)}</small></div><span className={l.entry_type === "debit" ? "tv-amount-debit" : "tv-amount-credit"}>{l.entry_type === "debit" ? "−" : "+"}{money(l.amount_kobo)}</span></li>
                  ))}</ul>
                )}
              </div>
            )}

            {view === "activity" && (
              <div className="tv-user-section">
                <h3 className="tv-subheading">Requests</h3>
                {data.requests.length === 0 ? <Empty text="No requests." /> : (
                  <ul className="tv-feed">{data.requests.map(r => (
                    <li key={r.id}><div><strong>{r.service_id}</strong><small>{r.request_reference} · {dateText(r.created_at)}</small></div><span className={statusClass(r.status)}>{r.status}</span></li>
                  ))}</ul>
                )}
                <h3 className="tv-subheading">Top-ups</h3>
                {data.topups.length === 0 ? <Empty text="No top-ups." /> : (
                  <ul className="tv-feed">{data.topups.map(t => (
                    <li key={t.id}><div><strong>{money(t.amount_kobo)}</strong><small>{dateText(t.created_at)}</small></div><span className={statusClass(t.status)}>{t.status}</span></li>
                  ))}</ul>
                )}
                <h3 className="tv-subheading">Admin history</h3>
                {data.audit.length === 0 ? <Empty text="No admin actions." /> : (
                  <ul className="tv-feed">{data.audit.map(a => <li key={a.id}><div><strong>{a.action.replace(/_/g, " ")}</strong><small>{dateText(a.created_at)}</small></div></li>)}</ul>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      {dialog}
    </>
  );
}

type ReqRow = { id: string; user_name: string; service_id: string; status: string; fee_kobo: number; request_reference: string; provider_reference: string | null; error_code: string | null; created_at: string };

function RequestsTab({ onNotice }: { onNotice: Notice }) {
  const catalog = useAdminData<{ services: Array<{ id: string; name: string }> }>("view=pricing");
  const services = catalog.data?.services ?? [];
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearch(q), 350); return () => clearTimeout(t); }, [q]);
  const { data, loading, error, reload } = useAdminData<{ requests: ReqRow[] }>(`view=requests&status=${status}&q=${encodeURIComponent(search)}`);
  const [target, setTarget] = useState<ReqRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const serviceName = (id: string) => services.find(s => s.id === id)?.name ?? id;

  async function refund(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    setBusy(true);
    try {
      const result = await adminPost({ action: "refund_request", requestId: target.id, reason });
      onNotice(result.message ?? "Refunded.");
      setTarget(null); setReason("");
      await reload();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Refund failed.", true);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="tv-toolbar">
        <div className="tv-searchbar"><Search size={17} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by request reference" aria-label="Search requests" /></div>
        <Pills value={status} onChange={setStatus} options={[["", "All"], ["processing", "Processing"], ["completed", "Completed"], ["failed", "Failed"], ["refunded", "Refunded"]]} />
      </div>
      <section className="tv-panel tv-history-panel">
        {loading && !data ? <Skeleton /> : error ? <Failed message={error} retry={reload} /> : !data?.requests.length ? <Empty text="No requests match." /> : (
          <div className="tv-table-scroll">
            <table className="tv-table">
              <thead><tr><th>USER</th><th>SERVICE</th><th>REFERENCE</th><th>DATE</th><th>FEE</th><th>STATUS</th><th></th></tr></thead>
              <tbody>{data.requests.map(r => (
                <tr key={r.id}>
                  <td data-label="USER"><strong>{r.user_name}</strong></td>
                  <td data-label="SERVICE">{serviceName(r.service_id)}</td>
                  <td className="tv-ref" data-label="REFERENCE"><span>{r.request_reference}</span></td>
                  <td data-label="DATE">{dateText(r.created_at)}</td>
                  <td data-label="FEE">{money(r.fee_kobo)}</td>
                  <td data-label="STATUS"><span className={statusClass(r.status)}>{r.status}</span></td>
                  <td data-label="">{r.status !== "refunded" && r.fee_kobo > 0 && <button type="button" className="tv-button-secondary tv-btn-sm" onClick={() => setTarget(r)}>Refund</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <Modal open={!!target} onClose={() => !busy && setTarget(null)} size="sm" busy={busy} title="Refund this fee?" icon={<Receipt size={20} />}
        footer={<><button type="button" className="tv-button-secondary" onClick={() => setTarget(null)} disabled={busy}>Cancel</button><button type="submit" form="tv-refund-form" className="tv-button-primary" disabled={busy}>{busy ? "Refunding" : "Refund fee"}</button></>}>
        <form id="tv-refund-form" className="tv-form" onSubmit={refund}>
          <p className="tv-confirm-text">{target ? `${money(target.fee_kobo)} will be returned to ${target.user_name}'s wallet.` : ""}</p>
          <label className="tv-field"><span className="tv-field-label">Reason</span><input value={reason} onChange={e => setReason(e.target.value)} maxLength={150} placeholder="Provider failed, stuck request, etc." /></label>
        </form>
      </Modal>
    </>
  );
}

function PaymentsTab({ onNotice }: { onNotice: Notice }) {
  const [status, setStatus] = useState("");
  const { data, loading, error, reload } = useAdminData<{ topups: Array<{ id: string; user_id: string; user_name: string; tx_ref: string; amount_kobo: number; status: string; created_at: string }>; accountCounts: Record<string, number> }>(`view=payments&status=${status}`);
  const [busy, setBusy] = useState("");

  async function recheck(userId: string) {
    setBusy(userId);
    try {
      const result = await adminPost({ action: "reconcile_user", userId });
      onNotice(result.message ?? "Checked.");
      await reload();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Check failed.", true);
    } finally { setBusy(""); }
  }

  return (
    <>
      {data && (
        <div className="tv-stat-grid tv-stat-grid-3">
          {[["Active deposit accounts", data.accountCounts.active ?? 0], ["Provisioning", data.accountCounts.provisioning ?? 0], ["Failed setups", data.accountCounts.failed ?? 0]].map(([label, value]) => (
            <div className="tv-stat-card" key={String(label)}><div><span>{label}</span></div><strong>{value}</strong></div>
          ))}
        </div>
      )}
      <div className="tv-toolbar"><Pills value={status} onChange={setStatus} options={[["", "All"], ["pending", "Pending"], ["credited", "Credited"], ["failed", "Failed"]]} /></div>
      <section className="tv-panel tv-history-panel">
        {loading && !data ? <Skeleton /> : error ? <Failed message={error} retry={reload} /> : !data?.topups.length ? <Empty text="No payments." /> : (
          <div className="tv-table-scroll">
            <table className="tv-table">
              <thead><tr><th>USER</th><th>REFERENCE</th><th>DATE</th><th>AMOUNT</th><th>STATUS</th><th></th></tr></thead>
              <tbody>{data.topups.map(t => (
                <tr key={t.id}>
                  <td data-label="USER"><strong>{t.user_name}</strong></td>
                  <td className="tv-ref" data-label="REFERENCE"><span>{t.tx_ref}</span></td>
                  <td data-label="DATE">{dateText(t.created_at)}</td>
                  <td data-label="AMOUNT">{money(t.amount_kobo)}</td>
                  <td data-label="STATUS"><span className={statusClass(t.status)}>{t.status}</span></td>
                  <td data-label="">{t.status !== "credited" && <button type="button" className="tv-button-secondary tv-btn-sm" disabled={busy === t.user_id} onClick={() => void recheck(t.user_id)}><RefreshCw size={14} className={busy === t.user_id ? "tv-spin" : ""} /> Re-check</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

type PricingRow = { id: string; name: string; description: string; category: string; price_kobo: number; cost_kobo: number; enabled: boolean };

function MarginChip({ price, cost }: { price: number; cost: number }) {
  if (cost <= 0) return <span className="tv-margin tv-margin-warn">Cost not set</span>;
  const diff = price - cost;
  if (diff < 0) return <span className="tv-margin tv-margin-bad">Below cost: loses {money(Math.round(-diff * 100))} each</span>;
  const pct = price > 0 ? Math.round((diff / price) * 100) : 0;
  return <span className={pct < 15 ? "tv-margin tv-margin-warn" : "tv-margin tv-margin-good"}>Profit {money(Math.round(diff * 100))} each ({pct}%)</span>;
}

function PricingTab({ onRefresh, onNotice }: { onRefresh: () => void; onNotice: Notice }) {
  const { data, loading, error, reload } = useAdminData<{ services: PricingRow[] }>("view=pricing");
  const { confirm, dialog } = useConfirm();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!data) return;
    setPrices(Object.fromEntries(data.services.map(x => [x.id, String(x.price_kobo / 100)])));
    setCosts(Object.fromEntries(data.services.map(x => [x.id, String(x.cost_kobo / 100)])));
    setEnabled(Object.fromEntries(data.services.map(x => [x.id, x.enabled])));
  }, [data]);

  async function save(service: PricingRow) {
    const price = Number(prices[service.id]);
    const cost = Number(costs[service.id]);
    const on = enabled[service.id] ?? service.enabled;
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(cost) || cost < 0) { onNotice("Enter a valid price and cost.", true); return; }
    if (on && price <= 0) { onNotice("Set a price above zero before enabling a service.", true); return; }
    if (on && cost > 0 && price < cost) {
      const ok = await confirm({
        title: "Price is below your cost",
        message: `${service.name} costs ${money(Math.round(cost * 100))} but sells for ${money(Math.round(price * 100))}. You will lose ${money(Math.round((cost - price) * 100))} on every request.`,
        confirmLabel: "Save anyway", tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(service.id);
    try {
      const result = await adminPost({ action: "save_service", serviceId: service.id, priceNaira: price, costNaira: cost, enabled: on });
      onNotice(result.message ?? "Saved.");
      await reload();
      onRefresh();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Could not save.", true);
    } finally { setBusy(""); }
  }

  if (loading && !data) return <Skeleton rows={6} />;
  if (error || !data) return <Failed message={error || "No data."} retry={reload} />;
  const belowCount = data.services.filter(x => x.enabled && x.cost_kobo > 0 && x.price_kobo < x.cost_kobo).length;

  return (
    <>
      {belowCount > 0 && <div className="tv-alert-card tv-alert-danger"><AlertTriangle size={20} /><div><strong>{belowCount} enabled service{belowCount > 1 ? "s are" : " is"} priced below cost</strong></div></div>}
      <section className="tv-panel tv-pricing-list">
        {data.services.map(service => {
          const on = enabled[service.id] ?? service.enabled;
          const price = Number(prices[service.id] ?? service.price_kobo / 100);
          const cost = Number(costs[service.id] ?? service.cost_kobo / 100);
          return (
            <div className="tv-price-row" key={service.id}>
              <div>
                <strong>{service.name}</strong>
                <span>{service.category}</span>
                <MarginChip price={price} cost={cost} />
              </div>
              <label className="tv-field"><span className="tv-field-label">Price (NGN)</span><input type="number" min="0" inputMode="decimal" value={prices[service.id] ?? ""} onChange={e => setPrices({ ...prices, [service.id]: e.target.value })} /></label>
              <label className="tv-field"><span className="tv-field-label">Your cost (NGN)</span><input type="number" min="0" inputMode="decimal" value={costs[service.id] ?? ""} onChange={e => setCosts({ ...costs, [service.id]: e.target.value })} /></label>
              <label className="tv-switch">
                <input type="checkbox" checked={on} onChange={e => setEnabled({ ...enabled, [service.id]: e.target.checked })} />
                <span className="tv-switch-track" aria-hidden="true" />
                <span>Visible</span>
              </label>
              <button type="button" className="tv-button-primary" disabled={busy === service.id} onClick={() => void save(service)}>
                {busy === service.id ? <><span className="tv-button-spinner" aria-hidden="true" /> Saving</> : <><Check size={16} /> Save</>}
              </button>
            </div>
          );
        })}
      </section>
      {dialog}
    </>
  );
}

function AuditTab() {
  const { data, loading, error, reload } = useAdminData<{ logs: Array<{ id: string; actor_name: string; target_name: string; action: string; entity_type: string; created_at: string }> }>("view=audit");
  if (loading && !data) return <Skeleton rows={6} />;
  if (error) return <Failed message={error} retry={reload} />;
  return (
    <section className="tv-panel tv-history-panel">
      {!data?.logs.length ? <Empty text="No audit entries." /> : (
        <div className="tv-table-scroll">
          <table className="tv-table">
            <thead><tr><th>WHEN</th><th>ACTOR</th><th>ACTION</th><th>TARGET</th></tr></thead>
            <tbody>{data.logs.map(l => (
              <tr key={l.id}>
                <td data-label="WHEN">{dateText(l.created_at)}</td>
                <td data-label="ACTOR">{l.actor_name}</td>
                <td data-label="ACTION" style={{ textTransform: "capitalize" }}>{l.action.replace(/_/g, " ")}</td>
                <td data-label="TARGET">{l.target_name || "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
