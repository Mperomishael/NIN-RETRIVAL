"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowRight, BadgeCheck, Bell, Check, ChevronRight,
  CircleHelp, Clock3, CreditCard, FileCheck2, Fingerprint, Home, LogOut, Menu,
  Search, ShieldCheck, Smartphone, UserRound, Users, Wallet, X, Zap
} from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Profile = {
  id: string; full_name: string; phone: string | null; business_name: string | null;
  business_address: string | null; intended_use: string | null; status: "pending" | "approved" | "restricted";
  is_super_admin: boolean; terms_accepted_at: string | null;
};
type Service = { id: string; name: string; description: string; category: string; price_kobo: number; enabled: boolean };
type WalletRow = { balance_kobo: number; currency: string };
type RequestRow = { id: string; service_id: string; status: string; fee_kobo: number; request_reference: string; created_at: string };
type RequestFields = { nin: string; phone: string; bvn: string; firstName: string; lastName: string; gender: string; dateOfBirth: string; slipType: string };

const liveServices = ["nin-lookup", "phone-lookup", "bvn-verify", "demographic", "nin-slip", "bvn-slip"];
const money = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
const dateText = (value: string) => new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
const emptyFields: RequestFields = { nin: "", phone: "", bvn: "", firstName: "", lastName: "", gender: "m", dateOfBirth: "", slipType: "Standard Slip" };

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [history, setHistory] = useState<RequestRow[]>([]);
  const [section, setSection] = useState("Overview");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authLoading, setAuthLoading] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [intendedUse, setIntendedUse] = useState("Customer onboarding and identity verification with consent");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Service | null>(null);
  const [fields, setFields] = useState<RequestFields>(emptyFields);
  const [requestConsent, setRequestConsent] = useState(false);
  const [requestPurpose, setRequestPurpose] = useState("Customer onboarding / KYC with consent");
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [fundAmount, setFundAmount] = useState("5000");
  const [fundingLoading, setFundingLoading] = useState(false);

  const flash = (message: string, isError = false) => { setNotice(message); setNoticeError(isError); };
  const refreshData = useCallback(async (userId: string) => {
    const [p, w, s, h] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("wallets").select("balance_kobo,currency").eq("user_id", userId).maybeSingle(),
      supabase.from("services").select("id,name,description,category,price_kobo,enabled").eq("enabled", true).order("category").order("name"),
      supabase.from("identity_requests").select("id,service_id,status,fee_kobo,request_reference,created_at").order("created_at", { ascending: false }).limit(8),
    ]);
    if (p.data) setProfile(p.data as Profile);
    if (w.data) setWallet(w.data as WalletRow);
    if (s.data) setServices((s.data as Service[]).filter(item => liveServices.includes(item.id)));
    if (h.data) setHistory(h.data as RequestRow[]);
  }, [supabase]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      if (data.user) { setUser({ id: data.user.id, email: data.user.email }); void refreshData(data.user.id); }
      setChecking(false);
    }).catch(() => { if (alive) setChecking(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user;
      setUser(nextUser ? { id: nextUser.id, email: nextUser.email } : null);
      if (nextUser) void refreshData(nextUser.id);
      else { setProfile(null); setWallet(null); setServices([]); setHistory([]); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [supabase, refreshData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentState = params.get("wallet_payment");
    if (!paymentState) return;
    if (paymentState === "success") {
      setNotice("Flutterwave verified your payment and your wallet has been credited.");
      setNoticeError(false);
    } else if (paymentState === "pending") {
      setNotice("Your payment is still being verified. Refresh your wallet shortly if the balance has not updated.");
      setNoticeError(true);
    } else {
      setNotice("Payment was not completed. You can start another wallet top-up.");
      setNoticeError(true);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const filteredServices = useMemo(() => services.filter(s => (s.name + " " + s.description + " " + s.category).toLowerCase().includes(query.toLowerCase())), [services, query]);
  const serviceIcon = (id: string) => id.includes("phone") ? Smartphone : id.includes("slip") ? FileCheck2 : id.includes("bvn") ? ShieldCheck : Fingerprint;

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setAuthLoading(true); setNotice("");
    try {
      if (authMode === "signup") {
        if (!acceptedTerms) throw new Error("Please accept the acceptable-use terms and privacy notice to continue.");
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: {
            full_name: fullName.trim(), phone: phone.trim(), business_name: businessName.trim(),
            business_address: businessAddress.trim(), intended_use: intendedUse.trim(),
            terms_accepted_at: new Date().toISOString(), terms_version: "topverify-acceptable-use-v1"
          } }
        });
        if (error) throw error;
        if (data.session && data.user) {
          setUser({ id: data.user.id, email: data.user.email });
          await refreshData(data.user.id);
          flash("Registration received. Your account is pending TopVerify review.");
        } else {
          flash("Registration received. Check your email to confirm the account, then sign in.");
          setAuthMode("signin");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) { setUser({ id: data.user.id, email: data.user.email }); await refreshData(data.user.id); flash("Welcome back to TopVerify."); }
      }
    } catch (error) { flash(error instanceof Error ? error.message : "Unable to complete authentication.", true); }
    finally { setAuthLoading(false); }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setWallet(null); setSelected(null); setSection("Overview");
    flash("You have signed out.");
  }

  function openService(service: Service) {
    setSelected(service); setFields(emptyFields); setRequestConsent(false); setRequestPurpose("Customer onboarding / KYC with consent"); setResult(null); setSection("Services"); setNotice("");
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!requestConsent) { flash("Confirm the data subject has authorized this specific identity request.", true); return; }
    setRequestLoading(true); setResult(null); setNotice("");
    try {
      const response = await fetch("/api/identity", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: selected.id, purpose: requestPurpose, consent: requestConsent, ...fields })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
      setResult(payload);
      flash("Request completed. Your result is shown below.");
      if (user) await refreshData(user.id);
    } catch (error) { flash(error instanceof Error ? error.message : "Request failed.", true); if (user) await refreshData(user.id); }
    finally { setRequestLoading(false); }
  }

  async function fundWallet() {
    const amount = Number(fundAmount);
    if (!Number.isSafeInteger(amount) || amount < 500 || amount > 1000000) {
      flash("Enter a whole-naira amount between ₦500 and ₦1,000,000.", true);
      return;
    }
    setFundingLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/payments/flutterwave/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountNaira: amount }),
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.checkoutUrl !== "string") {
        throw new Error(payload.error || "Unable to start Flutterwave checkout.");
      }
      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to start wallet funding.", true);
      setFundingLoading(false);
    }
  }

  function downloadSlip(slip: Record<string, unknown>) {
    const base64 = String(slip.base64 || "");
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = String(slip.fileName || "TopVerify-slip.pdf"); anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!isSupabaseConfigured()) return <main className="tv-config-screen"><div className="tv-brand-mark"><Fingerprint size={25}/></div><span className="tv-form-eyebrow">TOPVERIFY SETUP</span><h1>One last connection step.</h1><p>Add the Supabase URL and publishable key in your deployment environment to activate secure authentication, KYC profiles and agent wallets.</p><code>NEXT_PUBLIC_SUPABASE_URL</code><code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code><small>Server-side NINSlip and wallet operations also require SUPABASE_SERVICE_ROLE_KEY and NINSLIP_API_KEY.</small></main>;

  if (checking) return <main className="tv-loading"><div className="tv-orbit"><Fingerprint size={30}/></div><strong>TopVerify</strong><span>Preparing your secure workspace…</span></main>;

  if (!user) return <main className="tv-auth-shell">
    <div className="tv-auth-art">
      <div className="tv-orb tv-orb-one"/><div className="tv-orb tv-orb-two"/>
      <div className="tv-brand tv-brand-light"><div className="tv-brand-mark"><Fingerprint size={25}/></div><div><strong>TopVerify</strong><span>IDENTITY OPERATIONS</span></div></div>
      <div className="tv-auth-copy"><span className="tv-kicker"><span/> TRUSTED WORKFLOWS. ACCOUNTABLE ACCESS.</span><h1>Identity services,<br/><em>under your control.</em></h1><p>A workspace for authorized agents to request identity checks, manage dedicated funds, and keep accountable records.</p>
        <div className="tv-trust-row"><div><ShieldCheck size={17}/><span>Consent-first access</span></div><div><Wallet size={17}/><span>Dedicated wallets</span></div><div><Activity size={17}/><span>Auditable requests</span></div></div>
      </div>
      <div className="tv-auth-bottom"><span>TOPVERIFY / SECURE AGENT NETWORK</span><span>BUILT FOR RESPONSIBLE IDENTITY OPERATIONS</span></div>
    </div>
    <div className="tv-auth-panel">
      <div className="tv-auth-mobile-brand"><div className="tv-brand-mark"><Fingerprint size={23}/></div><strong>TopVerify</strong></div>
      <div className="tv-auth-form-wrap">
        <span className="tv-form-eyebrow">{authMode === "signin" ? "AGENT WORKSPACE" : "NEW AGENT ENROLMENT"}</span>
        <h2>{authMode === "signin" ? "Welcome back." : "Create your workspace."}</h2>
        <p className="tv-muted">{authMode === "signin" ? "Sign in to manage your identity requests and wallet." : "Submit your details for review. Live services remain locked until approval."}</p>
        <form onSubmit={handleAuth} className="tv-form">
          {authMode === "signup" && <>
            <label>Full name<input required autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your legal name"/></label>
            <div className="tv-two-fields"><label>Phone number<input required autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="080…"/></label><label>Business / agency<input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Optional"/></label></div>
            <label>Business address<input value={businessAddress} onChange={e=>setBusinessAddress(e.target.value)} placeholder="Business location (if applicable)"/></label>
            <label>Intended use<select value={intendedUse} onChange={e=>setIntendedUse(e.target.value)}><option>Customer onboarding and identity verification with consent</option><option>Internal compliance checks with consent</option><option>Professional agent / reseller services</option><option>Other lawful business purpose</option></select></label>
          </>}
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label>
          <label>Password<input required minLength={8} type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label>
          {authMode === "signup" && <label className="tv-terms"><input type="checkbox" checked={acceptedTerms} onChange={e=>setAcceptedTerms(e.target.checked)}/><span>I agree to TopVerify’s <a href="/acceptable-use" target="_blank" rel="noreferrer">acceptable-use rules</a> and <a href="/privacy" target="_blank" rel="noreferrer">privacy notice</a>. I will only request identity information for a lawful, disclosed purpose with the data subject’s authorization; I will not use or disclose it for fraud, harassment, discrimination, impersonation, or any other misuse.</span></label>}
          {notice && <div className={noticeError ? "tv-alert tv-alert-error" : "tv-alert"}>{notice}</div>}
          <button className="tv-primary-btn" disabled={authLoading}>{authLoading ? "Please wait…" : authMode === "signin" ? "Sign in securely" : "Submit for review"} <ArrowRight size={17}/></button>
        </form>
        <div className="tv-auth-switch">{authMode === "signin" ? "New to TopVerify?" : "Already have an account?"} <button onClick={()=>{setAuthMode(authMode==="signin"?"signup":"signin");setNotice("");}}>{authMode === "signin" ? "Create agent account" : "Sign in instead"}</button></div>
        <div className="tv-privacy-note"><ShieldCheck size={15}/><span>Identity data is sensitive. Your access is subject to account approval, service permissions and purpose-specific consent.</span></div>
      </div>
    </div>
  </main>;

  const isApproved = profile?.status === "approved" || profile?.is_super_admin;
  const navItems = [{ label: "Overview", icon: Home }, { label: "Services", icon: Fingerprint }, { label: "Request history", icon: Clock3 }, { label: "My wallet", icon: Wallet }];
  const activeService = selected;
  const SelectedIcon = activeService ? serviceIcon(activeService.id) : Fingerprint;

  return <main className="tv-app">
    {mobileMenu && <button className="tv-scrim" aria-label="Close navigation" onClick={()=>setMobileMenu(false)}/>}
    <aside className={mobileMenu ? "tv-sidebar tv-sidebar-open" : "tv-sidebar"}>
      <div className="tv-brand"><div className="tv-brand-mark"><Fingerprint size={24}/></div><div><strong>TopVerify</strong><span>IDENTITY OPERATIONS</span></div><button className="tv-icon-btn tv-close-menu" onClick={()=>setMobileMenu(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="tv-workspace-card"><div className="tv-avatar">{(profile?.full_name || user.email || "TV").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase()}</div><div><strong>{profile?.business_name || profile?.full_name || "Agent workspace"}</strong><span>{profile?.is_super_admin ? "Platform administrator" : "Agent workspace"}</span></div><span className="tv-status-dot"/></div>
      <nav className="tv-nav"><span className="tv-nav-label">WORKSPACE</span>{navItems.map(item=><button key={item.label} className={section===item.label ? "tv-nav-item tv-nav-active" : "tv-nav-item"} onClick={()=>{setSection(item.label);setSelected(null);setMobileMenu(false);setNotice("");}}><item.icon size={18}/><span>{item.label}</span>{item.label==="Request history" && <small>{history.length}</small>}</button>)}
      {profile?.is_super_admin && <><span className="tv-nav-label tv-nav-spaced">ADMINISTRATION</span><button className={section==="Agents"?"tv-nav-item tv-nav-active":"tv-nav-item"} onClick={()=>{setSection("Agents");setSelected(null);setMobileMenu(false);}}><Users size={18}/><span>Agent oversight</span></button><button className={section==="Pricing"?"tv-nav-item tv-nav-active":"tv-nav-item"} onClick={()=>{setSection("Pricing");setSelected(null);setMobileMenu(false);}}><CreditCard size={18}/><span>Service pricing</span></button><button className="tv-nav-item" onClick={()=>window.location.assign("/admin/treasury")}><Wallet size={18}/><span>Treasury &amp; wallets</span></button></>}
      </nav>
      <div className="tv-sidebar-foot"><div className="tv-help-box"><div className="tv-help-icon"><CircleHelp size={18}/></div><strong>Need a hand?</strong><p>Contact support for account, wallet or service issues.</p><button className="tv-contact-support" type="button" onClick={()=>flash("Add your verified TopVerify support contact before launch.",true)}>Contact support <ArrowRight size={13}/></button></div><button className="tv-logout" onClick={signOut}><LogOut size={17}/> Sign out <span>{user.email}</span></button></div>
    </aside>
    <section className="tv-main">
      <header className="tv-topbar"><div className="tv-top-left"><button className="tv-icon-btn tv-menu-btn" onClick={()=>setMobileMenu(true)} aria-label="Open menu"><Menu size={20}/></button><div className="tv-breadcrumb"><span>TopVerify</span><ChevronRight size={14}/><strong>{activeService?.name || section}</strong></div></div><div className="tv-top-actions"><div className="tv-security-pill"><span/> {isApproved ? "SECURE WORKSPACE" : "ACCOUNT UNDER REVIEW"}</div><button className="tv-icon-btn" aria-label="Notifications" onClick={()=>flash("You are up to date.")}><Bell size={18}/></button><div className="tv-profile-mini"><div className="tv-avatar">{(profile?.full_name || "TV").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase()}</div><div><strong>{profile?.full_name || "Agent"}</strong><span>{profile?.is_super_admin ? "Administrator" : "Agent"}</span></div></div></div></header>
      <div className="tv-content">
        {notice && <div className={noticeError ? "tv-toast tv-toast-error" : "tv-toast"}><span>{noticeError ? <X size={16}/> : <Check size={16}/>}</span>{notice}<button onClick={()=>setNotice("")} aria-label="Dismiss"><X size={15}/></button></div>}
        {!isApproved && <div className="tv-review-banner"><Clock3 size={19}/><div><strong>Your account is awaiting review</strong><p>Your KYC details have been submitted. Identity requests remain locked until TopVerify approves your account.</p></div><span>Pending</span></div>}
        {section === "Overview" && !selected && <>
          <div className="tv-page-heading"><div><span className="tv-eyebrow"><Zap size={13}/> YOUR IDENTITY WORKSPACE</span><h1>Good to see you, {(profile?.full_name || "Agent").split(" ")[0]} <span>✦</span></h1><p>One place for your identity workflows, wallet and request history.</p></div><button className="tv-button-primary" onClick={()=>{setSection("Services");setSelected(null);}}><Zap size={16}/> New request</button></div>
          <div className="tv-stat-grid"><div className="tv-stat-card"><div><span>Available balance</span><div className="tv-stat-icon tv-blue"><Wallet size={18}/></div></div><strong>{money(Number(wallet?.balance_kobo || 0))}</strong><small>Dedicated agent wallet</small></div><div className="tv-stat-card"><div><span>Total requests shown</span><div className="tv-stat-icon tv-purple"><Activity size={18}/></div></div><strong>{history.length}</strong><small>Recent account activity</small></div><div className="tv-stat-card"><div><span>Account status</span><div className="tv-stat-icon tv-green"><ShieldCheck size={18}/></div></div><strong className="tv-status-word">{profile?.status || "Pending"}</strong><small>{isApproved ? "Live services enabled" : "Awaiting admin review"}</small></div><div className="tv-stat-card"><div><span>Available services</span><div className="tv-stat-icon tv-amber"><Fingerprint size={18}/></div></div><strong>{services.length}</strong><small>Provider-enabled catalogue</small></div></div>
          <div className="tv-home-grid"><section className="tv-panel tv-service-panel"><div className="tv-panel-heading"><div><h2>Start with a service</h2><p>Choose a verified workflow for an authorized request.</p></div><button className="tv-text-btn" onClick={()=>setSection("Services")}>All services <ArrowRight size={14}/></button></div><div className="tv-service-grid">{services.slice(0,4).map(service=>{const Icon=serviceIcon(service.id);return <button className="tv-service-card" key={service.id} onClick={()=>openService(service)}><div className="tv-service-top"><span className="tv-service-icon"><Icon size={20}/></span><ArrowRight size={15}/></div><strong>{service.name}</strong><p>{service.description}</p><div className="tv-service-bottom"><span>{service.category}</span><b>{money(service.price_kobo)}</b></div></button>})}</div></section>
          <section className="tv-panel tv-wallet-panel"><div className="tv-panel-heading"><div><h2>Your wallet</h2><p>Account-specific funds</p></div><span className="tv-wallet-mark"><Wallet size={19}/></span></div><span className="tv-balance-label">AVAILABLE BALANCE</span><strong className="tv-wallet-amount">{money(Number(wallet?.balance_kobo || 0))}</strong><div className="tv-wallet-footer"><span><i/> NGN wallet</span><button onClick={()=>setSection("My wallet")}>Manage <ArrowRight size={14}/></button></div><div className="tv-wallet-info"><ShieldCheck size={16}/><span>Wallet balances change only through verified payment events or audited administrator adjustments.</span></div></section>
          <section className="tv-panel tv-history-panel"><div className="tv-panel-heading"><div><h2>Recent requests</h2><p>Latest service activity</p></div><button className="tv-text-btn" onClick={()=>setSection("Request history")}>View history <ArrowRight size={14}/></button></div><RequestTable history={history} services={services}/></section>
          <section className="tv-panel tv-responsibility"><div className="tv-responsibility-mark"><ShieldCheck size={22}/></div><h3>Responsible access, every time.</h3><p>Only request information for a lawful purpose with the data subject’s authorization. TopVerify records request references and limits access to your account.</p><div><span><Check size={14}/> Consent-first workflow</span><span><Check size={14}/> Account review</span><span><Check size={14}/> Private history</span></div></section></div>
        </>}
        {section === "Services" && <><div className="tv-page-heading"><div><span className="tv-eyebrow"><Fingerprint size={13}/> SERVICE CATALOGUE</span><h1>{selected ? selected.name : "Identity services"}</h1><p>{selected ? selected.description : "Service fees are set by TopVerify and may differ from upstream provider prices."}</p></div>{selected && <button className="tv-button-secondary" onClick={()=>{setSelected(null);setResult(null);}}>Back to catalogue</button>}</div>
          {!selected ? <><div className="tv-searchbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search available services…"/><span>{filteredServices.length} services</span></div><div className="tv-catalog-grid">{filteredServices.map(service=>{const Icon=serviceIcon(service.id);return <button className="tv-service-card tv-service-card-large" key={service.id} onClick={()=>openService(service)}><div className="tv-service-top"><span className="tv-service-icon"><Icon size={20}/></span><ArrowRight size={15}/></div><strong>{service.name}</strong><p>{service.description}</p><div className="tv-service-bottom"><span>{service.category}</span><b>{money(service.price_kobo)}</b></div></button>})}</div><div className="tv-soft-note"><ShieldCheck size={17}/><span>Validation, clearance and modification workflows remain hidden until their specific authorization, pricing and provider behavior have been reviewed.</span></div></>
          : <div className="tv-request-layout"><section className="tv-panel tv-request-panel"><div className="tv-panel-heading"><div><h2>Request details</h2><p>Enter only details required for this authorized request.</p></div><span className="tv-secure-label"><ShieldCheck size={14}/> Protected</span></div>
            {!isApproved ? <div className="tv-locked"><Clock3 size={25}/><h3>Approval required</h3><p>Your account must be approved before live identity requests can be submitted.</p></div> : <form className="tv-form tv-request-form" onSubmit={submitRequest}>
              {selected.id==="nin-lookup" && <label>NIN<input inputMode="numeric" maxLength={11} required value={fields.nin} onChange={e=>setFields({...fields,nin:e.target.value.replace(/\D/g,"")})} placeholder="Enter 11-digit NIN"/></label>}
              {selected.id==="phone-lookup" && <label>Phone number<input inputMode="tel" required value={fields.phone} onChange={e=>setFields({...fields,phone:e.target.value})} placeholder="08012345678"/></label>}
              {(selected.id==="bvn-verify" || selected.id==="bvn-slip") && <label>BVN<input inputMode="numeric" maxLength={11} required value={fields.bvn} onChange={e=>setFields({...fields,bvn:e.target.value.replace(/\D/g,"")})} placeholder="Enter 11-digit BVN"/></label>}
              {selected.id==="demographic" && <><div className="tv-two-fields"><label>First name<input required value={fields.firstName} onChange={e=>setFields({...fields,firstName:e.target.value})}/></label><label>Last name<input required value={fields.lastName} onChange={e=>setFields({...fields,lastName:e.target.value})}/></label></div><div className="tv-two-fields"><label>Gender<select value={fields.gender} onChange={e=>setFields({...fields,gender:e.target.value})}><option value="m">Male</option><option value="f">Female</option></select></label><label>Date of birth<input required value={fields.dateOfBirth} onChange={e=>setFields({...fields,dateOfBirth:e.target.value})} placeholder="DD-MM-YYYY"/></label></div></>}
              {(selected.id==="nin-slip" || selected.id==="bvn-slip") && <label>Slip type<select value={fields.slipType} onChange={e=>setFields({...fields,slipType:e.target.value})}><option>Standard Slip</option><option>Premium Slip</option><option>Regular Slip</option><option>Information Slip</option></select></label>}
              <label>Purpose for this request<select required value={requestPurpose} onChange={e=>setRequestPurpose(e.target.value)}><option>Customer onboarding / KYC with consent</option><option>Data subject requested their own record</option><option>Compliance verification with lawful basis</option></select></label>
              <label className="tv-terms"><input type="checkbox" checked={requestConsent} onChange={e=>setRequestConsent(e.target.checked)}/><span>I confirm I have the data subject’s authorization for this specific request, have explained the purpose, and will only use or share the result for that purpose.</span></label>
              <button className="tv-primary-btn" disabled={requestLoading}>{requestLoading ? "Submitting securely…" : `Submit request · ${money(selected.price_kobo)}`} <ArrowRight size={17}/></button>
              <p className="tv-form-footnote"><ShieldCheck size={14}/> TopVerify checks account approval and wallet balance on the server. Your service fee is refunded if a recorded provider failure occurs.</p>
            </form>}
          </section><aside className="tv-panel tv-order-panel"><span className="tv-order-eyebrow">REQUEST SUMMARY</span><div className="tv-order-service"><span className="tv-service-icon"><SelectedIcon size={21}/></span><div><strong>{selected.name}</strong><span>{selected.category}</span></div></div><div className="tv-order-line"><span>TopVerify service fee</span><strong>{money(selected.price_kobo)}</strong></div><div className="tv-order-line"><span>Provider</span><strong>NINSlip</strong></div><div className="tv-order-total"><span>Total</span><strong>{money(selected.price_kobo)}</strong></div><div className="tv-order-balance"><span>Wallet balance</span><strong>{money(Number(wallet?.balance_kobo || 0))}</strong></div><p className="tv-order-note">Your service fee is set by TopVerify. Upstream provider pricing may differ.</p></aside>
          {result && <section className="tv-panel tv-result-panel"><div className="tv-panel-heading"><div><h2>Request result</h2><p>Reference: {String(result.reference || "")}</p></div><span className="tv-complete-tag"><Check size={14}/> Completed</span></div>{result.slip !== null && typeof result.slip === "object" ? <button className="tv-primary-btn tv-download-btn" onClick={()=>downloadSlip(result.slip as Record<string,unknown>)}><ArrowDownToLine size={17}/> Download provider PDF slip</button> : null}{result.result !== null && typeof result.result === "object" ? <pre className="tv-result-json">{JSON.stringify(result.result,null,2)}</pre> : null}<p className="tv-form-footnote"><ShieldCheck size={14}/> This is sensitive personal information. Download or share it only for the authorized purpose.</p></section>}
          </div>}
        </>}
        {section === "Request history" && <><div className="tv-page-heading"><div><span className="tv-eyebrow"><Clock3 size={13}/> AUDITABLE ACTIVITY</span><h1>Request history</h1><p>Your latest identity-service requests and provider references.</p></div><button className="tv-button-primary" onClick={()=>setSection("Services")}><Zap size={16}/> New request</button></div><section className="tv-panel tv-history-panel"><RequestTable history={history} services={services}/></section></>}
        {section === "My wallet" && <><div className="tv-page-heading"><div><span className="tv-eyebrow"><Wallet size={13}/> WALLET & PAYMENTS</span><h1>My wallet</h1><p>Your individual TopVerify wallet is created automatically when you register.</p></div></div><div className="tv-wallet-page-grid"><section className="tv-wallet-hero"><span><Wallet size={16}/> AVAILABLE BALANCE</span><strong>{money(Number(wallet?.balance_kobo || 0))}</strong><p>NGN · Nigerian naira</p><div><button disabled={fundingLoading} onClick={fundWallet}>{fundingLoading ? "Opening checkout…" : "Fund wallet"} <ArrowRight size={15}/></button><span>Secure Flutterwave checkout</span></div></section><section className="tv-panel tv-fund-panel"><h2>Fund your wallet</h2><p>Choose an amount and pay through Flutterwave. TopVerify verifies the transaction server-side before crediting your balance.</p><label>Amount (NGN)<input value={fundAmount} onChange={e=>setFundAmount(e.target.value.replace(/\D/g,""))} inputMode="numeric" min="500" max="1000000" type="number"/></label><div className="tv-quick-amounts">{["2000","5000","10000","20000"].map(n=><button type="button" key={n} className={fundAmount===n?"tv-quick-active":""} onClick={()=>setFundAmount(n)}>{money(Number(n)*100)}</button>)}</div><div className="tv-soft-note"><ShieldCheck size={17}/><span>Wallet funding: ₦500–₦1,000,000 per transaction. Payments settle to TopVerify’s configured Flutterwave merchant account; the wallet balance is an internal customer ledger, not a separate bank balance.</span></div></section></div><section className="tv-panel tv-history-panel"><div className="tv-panel-heading"><div><h2>Recent ledger activity</h2><p>Wallet credits, service debits and refunds</p></div></div><LedgerTable userId={user.id}/></section></>}
        {section === "Agents" && profile?.is_super_admin && <AdminAgents supabase={supabase} onNotice={flash}/>}
        {section === "Pricing" && profile?.is_super_admin && <AdminPricing supabase={supabase} services={services} onRefresh={()=>user && refreshData(user.id)} onNotice={flash}/>}
        {profile?.is_super_admin && section === "Overview" && <div className="tv-admin-callout"><Users size={18}/><div><strong>Platform administrator</strong><p>Use Agent oversight to review new agent accounts. Keep approval and pricing changes auditable.</p></div></div>}
        <footer className="tv-footer"><span>© {new Date().getFullYear()} TopVerify</span><span><ShieldCheck size={13}/> Secure, accountable identity workflows</span><button className="tv-footer-support" type="button" onClick={()=>flash("Add your verified TopVerify support contact before launch.",true)}>Support</button></footer>
      </div>
    </section>
  </main>;
}

function RequestTable({ history, services }: { history: RequestRow[]; services: Service[] }) {
  if (!history.length) return <div className="tv-empty"><div><Clock3 size={21}/></div><strong>No requests yet</strong><span>Your completed and failed requests will appear here.</span></div>;
  return <div className="tv-table-scroll"><table className="tv-table"><thead><tr><th>SERVICE</th><th>REFERENCE</th><th>DATE</th><th>FEE</th><th>STATUS</th></tr></thead><tbody>{history.map(row=><tr key={row.id}><td><strong>{services.find(s=>s.id===row.service_id)?.name || row.service_id}</strong></td><td className="tv-ref">{row.request_reference}</td><td>{dateText(row.created_at)}</td><td>{money(row.fee_kobo)}</td><td><span className={row.status==="completed"?"tv-table-status tv-table-success":row.status==="failed"||row.status==="refunded"?"tv-table-status tv-table-failed":"tv-table-status tv-table-pending"}>{row.status}</span></td></tr>)}</tbody></table></div>;
}

function LedgerTable({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Array<{id:string;entry_type:string;amount_kobo:number;description:string;reference:string;created_at:string}>>([]);
  useEffect(()=>{const client=createClient();client.from("wallet_ledger").select("id,entry_type,amount_kobo,description,reference,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(20).then(({data})=>setRows(data||[]));},[userId]);
  if (!rows.length) return <div className="tv-empty"><div><Wallet size={21}/></div><strong>No wallet activity</strong><span>Verified credits, service debits and refunds will be listed here.</span></div>;
  return <div className="tv-table-scroll"><table className="tv-table"><thead><tr><th>TYPE</th><th>REFERENCE</th><th>DESCRIPTION</th><th>DATE</th><th>AMOUNT</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.entry_type}</td><td className="tv-ref">{row.reference}</td><td>{row.description}</td><td>{dateText(row.created_at)}</td><td>{money(row.amount_kobo)}</td></tr>)}</tbody></table></div>;
}

function AdminAgents({ supabase, onNotice }: { supabase: ReturnType<typeof createClient>; onNotice: (message:string,error?:boolean)=>void }) {
  const [agents,setAgents]=useState<Array<Profile & {email?:string}>>([]);
  const [busy,setBusy]=useState("");
  const load=useCallback(async()=>{const {data,error}=await supabase.from("profiles").select("id,full_name,phone,business_name,business_address,intended_use,status,is_super_admin,terms_accepted_at").order("created_at",{ascending:false});if(error)onNotice("Unable to load agent list.",true);else setAgents((data||[]) as Array<Profile & {email?:string}>);},[supabase,onNotice]);
  useEffect(()=>{void load();},[load]);
  async function updateStatus(id:string,status:"pending"|"approved"|"restricted"){setBusy(id);const {error}=await supabase.from("profiles").update({status,authorization_reviewed_at:status==="approved"?new Date().toISOString():null}).eq("id",id);if(error)onNotice("Could not update agent status. Confirm administrator permissions.",true);else{onNotice("Agent status updated.");await load();}setBusy("");}
  return <><div className="tv-page-heading"><div><span className="tv-eyebrow"><Users size={13}/> PLATFORM CONTROL</span><h1>Agent oversight</h1><p>Review onboarding details and approve or restrict agent accounts.</p></div></div><section className="tv-panel tv-admin-list">{agents.map(agent=><div className="tv-admin-agent" key={agent.id}><div className="tv-avatar">{agent.full_name.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase()}</div><div className="tv-admin-agent-copy"><strong>{agent.full_name}</strong><span>{agent.phone || "No phone"} · {agent.business_name || "Independent agent"}</span><small>{agent.intended_use || "No intended use provided"}</small></div><span className={"tv-table-status "+(agent.status==="approved"?"tv-table-success":agent.status==="restricted"?"tv-table-failed":"tv-table-pending")}>{agent.status}</span><select value={agent.status} disabled={busy===agent.id || agent.is_super_admin} onChange={e=>void updateStatus(agent.id,e.target.value as "pending"|"approved"|"restricted")}><option value="pending">Pending</option><option value="approved">Approve</option><option value="restricted">Restrict</option></select></div>)}</section></>;
}

function AdminPricing({ supabase, services, onRefresh, onNotice }: { supabase: ReturnType<typeof createClient>; services: Service[]; onRefresh:()=>void; onNotice:(message:string,error?:boolean)=>void }) {
  const [prices,setPrices]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState("");
  useEffect(() => { setPrices(Object.fromEntries(services.map(s => [s.id, String(s.price_kobo / 100)]))); }, [services]);
  async function save(service:Service){const value=Number(prices[service.id]);if(!Number.isFinite(value)||value<0){onNotice("Enter a valid non-negative price.",true);return;}setBusy(service.id);const {error}=await supabase.from("services").update({price_kobo:Math.round(value*100),updated_at:new Date().toISOString()}).eq("id",service.id);if(error)onNotice("Could not save price. Confirm admin permissions and database policy.",true);else{onNotice("Price updated.");onRefresh();}setBusy("");}
  return <><div className="tv-page-heading"><div><span className="tv-eyebrow"><CreditCard size={13}/> PLATFORM CONTROL</span><h1>Service pricing</h1><p>Set TopVerify’s retail fee separately from the upstream provider cost.</p></div></div><section className="tv-panel tv-pricing-list">{services.map(service=><div className="tv-price-row" key={service.id}><div><strong>{service.name}</strong><span>{service.description}</span></div><label>Retail fee (NGN)<input type="number" min="0" value={prices[service.id]??String(service.price_kobo/100)} onChange={e=>setPrices({...prices,[service.id]:e.target.value})}/></label><button disabled={busy===service.id} onClick={()=>void save(service)}>{busy===service.id?"Saving…":"Save price"}</button></div>)}</section></>;
}
