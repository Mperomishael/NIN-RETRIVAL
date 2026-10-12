"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bell, Building2, Check, ChevronRight, ClipboardList, FileImage,
  CircleHelp, Clock3, CreditCard, FileCheck2, FilePenLine, FileSearch, Fingerprint, Home, IdCard, Landmark, LogOut, Menu,
  ScanFace, Search, ShieldCheck, Smartphone, UserRound, UserRoundCheck, Users, Wallet, X} from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Profile = {
  id: string; full_name: string; phone: string | null; business_name: string | null;
  business_address: string | null; intended_use: string | null; status: "pending" | "approved" | "restricted";
  is_super_admin: boolean; terms_accepted_at: string | null;
};
type Service = { id: string; name: string; description: string; category: string; price_kobo: number; enabled: boolean };
type WalletRow = { balance_kobo: number; currency: string };
type DepositAccount = { account_number: string; bank_name: string; status: string; created_at?: string };
type RequestRow = { id: string; service_id: string; status: string; fee_kobo: number; request_reference: string; provider_reference?: string | null; created_at: string };
type RequestFields = { nin: string; phone: string; bvn: string; firstName: string; lastName: string; gender: string; dateOfBirth: string; slipType: string; trackingId: string; errorType: string; fieldCode: string; modificationValue: string; modificationReason: string };
const money = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
const dateText = (value: string) => new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
const emptyFields: RequestFields = { nin: "", phone: "", bvn: "", firstName: "", lastName: "", gender: "m", dateOfBirth: "", slipType: "Standard Slip", trackingId: "", errorType: "No Record", fieldCode: "032", modificationValue: "", modificationReason: "" };

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [history, setHistory] = useState<RequestRow[]>([]);
  const [section, setSection] = useState("Overview");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [showAuth, setShowAuth] = useState(false);
  const [landingServices, setLandingServices] = useState<Service[]>([
    { id: "nin-lookup", name: "NIN Verification", description: "Verify identity details with an authorized request.", category: "Verification", price_kobo: 35000, enabled: true },
    { id: "bvn-verify", name: "BVN Verification", description: "Validate a BVN for an authorized workflow.", category: "Verification", price_kobo: 40000, enabled: true },
    { id: "nin-slip", name: "NIN Slip Generation", description: "Request an eligible NIN document.", category: "Documents", price_kobo: 120000, enabled: true },
    { id: "ipe-clearance", name: "IPE Clearance", description: "Submit an eligible clearance request.", category: "Clearance", price_kobo: 150000, enabled: true },
  ]);
  const [authLoading, setAuthLoading] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [showPriceReview, setShowPriceReview] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [intendedUse, setIntendedUse] = useState("Customer onboarding and identity verification with consent");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [registrationNin, setRegistrationNin] = useState("");
  const [acceptedNinSharing, setAcceptedNinSharing] = useState(false);
  const [depositAccount, setDepositAccount] = useState<DepositAccount | null>(null);
  const [accountNin, setAccountNin] = useState("");
  const [acceptedAccountNinSharing, setAcceptedAccountNinSharing] = useState(false);
  const [accountSetupLoading, setAccountSetupLoading] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Service | null>(null);
  const [fields, setFields] = useState<RequestFields>(emptyFields);
  const [requestConsent, setRequestConsent] = useState(false);
  const [requestPurpose, setRequestPurpose] = useState("Customer onboarding / KYC with consent");
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [fundAmount, setFundAmount] = useState("");
  const [showFundForm, setShowFundForm] = useState(false);
  const [fundingLoading, setFundingLoading] = useState(false);

  const flash = (message: string, isError = false) => { setNotice(message); setNoticeError(isError); };

  const loadDepositAccount = useCallback(async () => {
    try {
      const response = await fetch("/api/payments/virtual-account", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) setDepositAccount(payload.account?.status === "active" ? payload.account : null);
    } catch { /* Preserve the last known account details during a brief outage. */ }
  }, []);

  async function reconcileDepositAccount() {
    setReconcileLoading(true);
    try {
      const response = await fetch("/api/payments/virtual-account/reconcile", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to check your deposit.");
      flash(payload.message || "Deposit check completed.");
      await refreshData();
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to check your deposit.", true);
    } finally {
      setReconcileLoading(false);
    }
  }

  async function setupDepositAccount(nin: string, consent: boolean) {
    if (!/^\d{11}$/.test(nin.replace(/\s/g, ""))) throw new Error("Enter your 11-digit NIN.");
    if (!consent) throw new Error("Please consent to sending your NIN securely to Flutterwave for permanent account creation.");
    setAccountSetupLoading(true);
    try {
      const response = await fetch("/api/payments/virtual-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nin: nin.replace(/\s/g, ""), consent: true }),
      });
      const payload = await response.json();
      if (!response.ok || payload.account?.status !== "active") throw new Error(payload.error || "Unable to create your permanent deposit account.");
      setDepositAccount(payload.account);
      setAccountNin("");
      setRegistrationNin("");
      setAcceptedAccountNinSharing(false);
      setAcceptedNinSharing(false);
      flash("Your permanent bank-transfer account is ready. Use these details for future wallet deposits.");
    } finally {
      setAccountSetupLoading(false);
    }
  }
  const refreshData = useCallback(async (userId: string) => {
    const [p, w, s, h] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("wallets").select("balance_kobo,currency").eq("user_id", userId).maybeSingle(),
      supabase.from("services").select("id,name,description,category,price_kobo,enabled").order("category").order("name"),
      supabase.from("identity_requests").select("id,service_id,status,fee_kobo,request_reference,provider_reference,created_at").order("created_at", { ascending: false }),
    ]);
    if (p.data) setProfile(p.data as Profile);
    if (w.data) setWallet(w.data as WalletRow);
    if (s.data) setServices(s.data as Service[]);
    if (h.data) setHistory(h.data as RequestRow[]);
  }, [supabase]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      if (data.user) { setUser({ id: data.user.id, email: data.user.email }); await refreshData(data.user.id); }
      if (alive) setChecking(false);
    }).catch(() => { if (alive) setChecking(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user;
      setUser(nextUser ? { id: nextUser.id, email: nextUser.email } : null);
      if (nextUser) void refreshData(nextUser.id);
      else { setProfile(null); setWallet(null); setServices([]); setHistory([]); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [supabase, refreshData]);

  useEffect(() => { if (user?.id) void loadDepositAccount(); else setDepositAccount(null); }, [user?.id, loadDepositAccount]);

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

  useEffect(() => {
    let active = true;
    const loadPublicServices = async () => {
      try {
        const response = await fetch("/api/services", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (active && Array.isArray(payload.services)) setLandingServices(payload.services);
      } catch { /* Keep the display catalogue available during a brief network interruption. */ }
    };
    void loadPublicServices();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadPublicServices(); }, 30000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const sync = () => { if (document.visibilityState === "visible") void refreshData(user.id); };
    const interval = window.setInterval(sync, 15000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", sync); document.removeEventListener("visibilitychange", sync); };
  }, [user?.id, refreshData]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase.channel(`topverify-live-wallet-${user.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}`,
      }, () => { void refreshData(user.id); })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "wallet_ledger", filter: `user_id=eq.${user.id}`,
      }, () => { void refreshData(user.id); })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "identity_requests", filter: `user_id=eq.${user.id}`,
      }, () => { void refreshData(user.id); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, supabase, refreshData]);

  const filteredServices = useMemo(() => services.filter(s => s.enabled && !["nin-lookup", "nin-slip", "nin-image-report"].includes(s.id) && (s.name + " " + s.description + " " + s.category).toLowerCase().includes(query.toLowerCase())), [services, query]);
  const serviceIcon = (id: string) => id === "ipe-clearance" ? BadgeCheck : id === "nin-image-report" ? FileImage : id === "nin-validation" || id === "tracking-id-lookup" ? FileSearch : id === "nin-modification" ? FilePenLine : id === "demographic" ? UserRoundCheck : id.includes("phone") ? Smartphone : id.includes("slip") ? FileCheck2 : id.includes("bvn") ? IdCard : Fingerprint;

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setAuthLoading(true); setNotice("");
    try {
      if (authMode === "signup") {
        if (!acceptedTerms) throw new Error("Please accept the acceptable-use terms and privacy notice to continue.");
        if (!/^\d{11}$/.test(registrationNin.replace(/\s/g, ""))) throw new Error("Enter your 11-digit NIN to set up a permanent deposit account.");
        if (!acceptedNinSharing) throw new Error("Please consent to sending your NIN to Flutterwave for permanent account creation.");
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
          let registrationMessage = "Registration received. Your account is pending TopVerify review.";
          let registrationError = false;
          try { await setupDepositAccount(registrationNin, acceptedNinSharing); }
          catch (accountError) {
            registrationMessage += " Permanent deposit setup needs attention: " + (accountError instanceof Error ? accountError.message : "Please retry in Wallet.") + " You can use hosted payment meanwhile.";
            registrationError = true;
          }
          flash(registrationMessage, registrationError);
        } else {
          flash("Registration received. Check your email to confirm the account, then sign in. For security, TopVerify does not store your NIN while you wait; enter it again in Wallet to create your permanent deposit account.");
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

  function openService(service: Service, fromFormatPicker = false) {
    const formatServiceIds = ["nin-lookup", "nin-slip", "nin-image-report"];
    if (!fromFormatPicker && formatServiceIds.includes(service.id)) {
      setSelected(null); setFields(emptyFields); setRequestConsent(false); setShowPriceReview(false);
      setRequestPurpose("Customer onboarding / KYC with consent"); setResult(null); setSection("Services"); setNotice("");
      return;
    }
    setSelected(service); setFields(emptyFields); setRequestConsent(false); setShowPriceReview(false);
    setRequestPurpose("Customer onboarding / KYC with consent"); setResult(null); setSection("Services"); setNotice("");
  }

  function reviewRequest(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!requestConsent) { flash("Confirm the data subject has authorized this specific identity request.", true); return; }
    setShowPriceReview(true);
    setNotice("");
  }

  async function submitRequest() {
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
      setShowPriceReview(false);
      flash(payload.processing ? "Request accepted for processing. Keep the reference for follow-up." : "Request completed. Your result is shown below.");
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

  if (!user && !showAuth) return <main className="tv-landing">
    <header className="tv-landing-nav">
      <a className="tv-landing-brand" href="/" aria-label="TopVerify home"><span className="tv-landing-mark"><Fingerprint size={24}/></span><span><strong>TopVerify</strong><small>IDENTITY OPERATIONS</small></span></a>
      <nav aria-label="Main navigation"><a href="#services">Services</a><a href="#how-it-works">How it works</a><a href="#for-agents">For agents</a></nav>
      <div className="tv-landing-actions"><button className="tv-nav-signin" onClick={()=>{setAuthMode("signin");setShowAuth(true);setNotice("");}}>Sign in</button><button className="tv-nav-join" onClick={()=>{setAuthMode("signup");setIntendedUse("Professional agent / reseller services");setShowAuth(true);setNotice("");}}>Join as an agent <ArrowUpRight size={15}/></button></div>
    </header>
    <section className="tv-landing-hero">
      <div className="tv-landing-copy">
        <div className="tv-landing-kicker"><span/> IDENTITY WORKFLOWS, BUILT FOR REAL BUSINESS</div>
        <h1>Identity operations.<br/><em>Handled with clarity.</em></h1>
        <p className="tv-landing-lede">A considered workspace for authorized identity checks, document requests and clearance workflows — supported by a single account balance and a clear activity trail.</p>
        <div className="tv-landing-cta"><button className="tv-hero-primary" onClick={()=>{setAuthMode("signup");setIntendedUse("Customer onboarding and identity verification with consent");setShowAuth(true);setNotice("");}}>Start retrieving <ArrowRight size={17}/></button><button className="tv-hero-secondary" onClick={()=>{setAuthMode("signup");setIntendedUse("Professional agent / reseller services");setShowAuth(true);setNotice("");}}><Building2 size={17}/> Sign up as agent</button></div>
        <div className="tv-landing-assurance"><span><ShieldCheck size={16}/> Consent-led access</span><span><Wallet size={16}/> Wallet-backed requests</span><span><Activity size={16}/> Traceable activity</span></div>
      </div>
      <div className="tv-landing-visual" role="img" aria-label="Professional identity verification workspace">
        <div className="tv-visual-wash"/>
        <div className="tv-visual-label"><span className="tv-visual-live"/> WORKSPACE / 01 <span>TOPVERIFY</span></div>
        <div className="tv-id-card"><div className="tv-id-top"><span className="tv-id-emblem"><Fingerprint size={18}/></span><span>IDENTITY RECORD</span><BadgeCheck size={17}/></div><div className="tv-id-main"><div className="tv-id-portrait"><ScanFace size={46}/></div><div><small>SECURE REQUEST</small><strong>Identity verification</strong><span>Consent and purpose recorded</span></div></div><div className="tv-id-lines"><i/><i/><i/></div><div className="tv-id-foot"><span>REFERENCE-READY</span><ShieldCheck size={15}/></div></div>
        <div className="tv-float-note"><span><Check size={14}/></span><div><strong>One connected workflow</strong><small>Wallet · Request · Record</small></div></div>
        <div className="tv-visual-caption"><span>DESIGNED FOR PROFESSIONAL USE</span><span>NG / 01</span></div>
      </div>
    </section>
    <div className="tv-landing-metrics"><div><strong>One wallet</strong><span>Fund once, use across enabled services</span></div><div><strong>Connected services</strong><span>Identity, document and clearance workflows</span></div><div><strong>Accountable access</strong><span>Approval and purpose-specific consent</span></div></div>
    <section className="tv-landing-services" id="services"><div className="tv-landing-section-head"><div><span className="tv-landing-overline">SERVICE DIRECTORY</span><h2>Built around the work<br/>you need to get done.</h2></div><p>Explore available identity workflows. Services requiring provider approval or additional details are clearly identified before you submit a request.</p></div>
      <div className="tv-landing-service-grid">{landingServices.map(service=>{const Icon=service.id==="ipe-clearance"?BadgeCheck:service.id==="nin-image-report"?FileImage:service.id==="nin-validation"||service.id==="tracking-id-lookup"?FileSearch:service.id==="nin-modification"?FilePenLine:service.id.includes("slip")?FileCheck2:service.id.includes("bvn")?IdCard:service.id.includes("phone")?Smartphone:service.id==="demographic"?UserRoundCheck:Fingerprint;return <article className="tv-landing-service" key={service.id}><div className="tv-landing-service-top"><span><Icon size={20}/></span><small>{service.category}</small></div><h3>{service.name}</h3><p>{service.description}</p><div className="tv-landing-service-bottom"><span>Available in workspace</span><button aria-label={"Start "+service.name} onClick={()=>{setAuthMode("signup");setIntendedUse("Customer onboarding and identity verification with consent");setShowAuth(true);}}>Get started <ArrowUpRight size={15}/></button></div></article>})}</div>
      <div className="tv-catalog-footnote"><ShieldCheck size={16}/> Service availability depends on account approval, provider availability and lawful authorization. Current service fees are shown only inside your workspace.</div>
    </section>
    <section className="tv-landing-how" id="how-it-works"><div><span className="tv-landing-overline">A STRAIGHTFORWARD PROCESS</span><h2>From funding to<br/>finished request.</h2><p>Built to keep the important details visible, without making everyday tasks complicated.</p><button className="tv-hero-secondary" onClick={()=>{setAuthMode("signup");setShowAuth(true);}}>Create your account <ArrowRight size={16}/></button></div><div className="tv-step-list"><article><span>01</span><div><h3>Create your account</h3><p>Register with your details and complete the account review process.</p></div><UserRound size={20}/></article><article><span>02</span><div><h3>Fund your TopVerify wallet</h3><p>Pay securely through Flutterwave. Verified payments update your wallet ledger.</p></div><Wallet size={20}/></article><article><span>03</span><div><h3>Choose an enabled service</h3><p>Review the fee, provide required details and confirm authorization.</p></div><Fingerprint size={20}/></article><article><span>04</span><div><h3>Track the outcome</h3><p>Follow request references and see debits or refunds in your history.</p></div><Activity size={20}/></article></div></section>
    <section className="tv-agent-band" id="for-agents"><div className="tv-agent-band-icon"><Landmark size={24}/></div><div><span className="tv-landing-overline">FOR PROFESSIONAL AGENTS</span><h2>Your services. One operational workspace.</h2><p>Manage approved identity workflows, keep a funded wallet and see your activity in one place.</p></div><button onClick={()=>{setAuthMode("signup");setIntendedUse("Professional agent / reseller services");setShowAuth(true);}}>Register as an agent <ArrowRight size={16}/></button></section>
    <footer className="tv-landing-footer"><a className="tv-landing-brand" href="/"><span className="tv-landing-mark"><Fingerprint size={22}/></span><span><strong>TopVerify</strong><small>IDENTITY OPERATIONS</small></span></a><span>Purpose-led identity services for authorized use.</span><div><a href="/privacy">Privacy</a><a href="/acceptable-use">Acceptable use</a><button onClick={()=>{setAuthMode("signin");setShowAuth(true);}}>Sign in</button></div></footer>
  </main>;

  if (!user) return <main className="tv-auth-shell" aria-busy={authLoading}>
    <div className="tv-auth-art">
      <div className="tv-auth-3d-scene" aria-hidden="true"><div className="tv-auth-orbit-ring"/><div className="tv-flip-card tv-flip-card-back"><div className="tv-flip-card-top"><Fingerprint size={18}/><span>TOPVERIFY / SECURE</span></div><div className="tv-flip-chip"/><div className="tv-flip-lines"><i/><i/><i/></div><small>IDENTITY OPERATIONS</small></div><div className="tv-flip-card-front"><div className="tv-flip-card-top"><ShieldCheck size={18}/><span>VERIFIED WORKFLOW</span></div><div className="tv-flip-portrait"><ScanFace size={34}/></div><div className="tv-flip-lines"><i/><i/><i/></div><div className="tv-flip-card-bottom"><span>SECURE ACCESS</span><BadgeCheck size={17}/></div></div></div>
      <div className="tv-brand tv-brand-light"><div className="tv-brand-mark"><Fingerprint size={25}/></div><div><strong>TopVerify</strong><span>IDENTITY OPERATIONS</span></div></div>
      <div className="tv-auth-copy"><span className="tv-kicker"><span/> TRUSTED WORKFLOWS. ACCOUNTABLE ACCESS.</span><h1>Identity services,<br/><em>under your control.</em></h1><p>A workspace for authorized agents to request identity checks, manage dedicated funds, and keep accountable records.</p>
        <div className="tv-trust-row"><div><ShieldCheck size={17}/><span>Consent-first access</span></div><div><Wallet size={17}/><span>Dedicated wallets</span></div><div><Activity size={17}/><span>Auditable requests</span></div></div>
      </div>
      <div className="tv-auth-bottom"><span>TOPVERIFY / SECURE AGENT NETWORK</span><span>BUILT FOR RESPONSIBLE IDENTITY OPERATIONS</span></div>
    </div>
    <div className="tv-auth-panel">
      <div className="tv-auth-mobile-brand"><div className="tv-brand-mark"><Fingerprint size={23}/></div><strong>TopVerify</strong></div>
      <div className="tv-auth-form-wrap">
        <button className="tv-back-home" type="button" onClick={()=>{setShowAuth(false);setNotice("");}}><ArrowLeft size={15}/> Back to TopVerify</button>
        <span className="tv-form-eyebrow">{authMode === "signin" ? "SECURE WORKSPACE" : intendedUse === "Professional agent / reseller services" ? "AGENT ENROLMENT" : "CUSTOMER ACCOUNT"}</span>
        <h2>{authMode === "signin" ? "Welcome back." : "Create your account."}</h2>
        <p className="tv-muted">{authMode === "signin" ? "Sign in to manage your identity requests and wallet." : "Register to get started. Live identity services unlock after account review."}</p>
        <form onSubmit={handleAuth} className="tv-form">
          {authMode === "signup" && <>
            <label>Full name<input required autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your legal name"/></label>
            <div className="tv-two-fields"><label>Phone number<input required autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="080…"/></label><label>Business / agency<input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Optional"/></label></div>
            <label>Business address<input value={businessAddress} onChange={e=>setBusinessAddress(e.target.value)} placeholder="Business location (if applicable)"/></label>
            <label>National Identification Number (NIN)<input required inputMode="numeric" autoComplete="off" maxLength={11} value={registrationNin} onChange={e=>setRegistrationNin(e.target.value.replace(/\D/g,"").slice(0,11))} placeholder="Enter your 11-digit NIN"/></label>
            <label className="tv-terms"><input type="checkbox" checked={acceptedNinSharing} onChange={e=>setAcceptedNinSharing(e.target.checked)}/><span>I consent to TopVerify sending my NIN to Flutterwave solely to create my permanent bank-transfer deposit account. TopVerify will not store the NIN in its database. I can use hosted payment instead if I do not want to create a permanent account.</span></label>
            <label>Intended use<select value={intendedUse} onChange={e=>setIntendedUse(e.target.value)}><option>Customer onboarding and identity verification with consent</option><option>Internal compliance checks with consent</option><option>Professional agent / reseller services</option><option>Other lawful business purpose</option></select></label>
          </>}
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label>
          <label>Password<input required minLength={8} type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label>
          {authMode === "signup" && <label className="tv-terms"><input type="checkbox" checked={acceptedTerms} onChange={e=>setAcceptedTerms(e.target.checked)}/><span>I agree to TopVerify’s <a href="/acceptable-use" target="_blank" rel="noreferrer">acceptable-use rules</a> and <a href="/privacy" target="_blank" rel="noreferrer">privacy notice</a>. I will only request identity information for a lawful, disclosed purpose with the data subject’s authorization; I will not use or disclose it for fraud, harassment, discrimination, impersonation, or any other misuse.</span></label>}
          {notice && <div className={noticeError ? "tv-alert tv-alert-error" : "tv-alert"}>{notice}</div>}
          <button className="tv-primary-btn tv-auth-submit" type="submit" disabled={authLoading} aria-busy={authLoading}><span className={authLoading ? "tv-button-spinner" : "tv-button-spinner tv-button-spinner-hidden"} aria-hidden="true"/>{authLoading ? "Authenticating…" : authMode === "signin" ? "Sign in securely" : "Create account"} {!authLoading && <ArrowRight size={17}/>}</button>
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
      {profile?.is_super_admin && <><span className="tv-nav-label tv-nav-spaced">ADMINISTRATION</span><button className={section==="Agents"?"tv-nav-item tv-nav-active":"tv-nav-item"} onClick={()=>{setSection("Agents");setSelected(null);setMobileMenu(false);}}><Users size={18}/><span>Agent oversight</span></button><button className={section==="Pricing"?"tv-nav-item tv-nav-active":"tv-nav-item"} onClick={()=>{setSection("Pricing");setSelected(null);setMobileMenu(false);}}><CreditCard size={18}/><span>Service pricing</span></button> </>}
      </nav>
      <div className="tv-sidebar-foot"><div className="tv-help-box"><div className="tv-help-icon"><CircleHelp size={18}/></div><strong>Need a hand?</strong><p>Contact support for account, wallet or service issues.</p><button className="tv-contact-support" type="button" onClick={()=>flash("Add your verified TopVerify support contact before launch.",true)}>Contact support <ArrowRight size={13}/></button></div><button className="tv-logout" onClick={signOut}><LogOut size={17}/> Sign out <span>{user.email}</span></button></div>
    </aside>
    <section className="tv-main">
      <header className="tv-topbar"><div className="tv-top-left"><button className="tv-icon-btn tv-menu-btn" onClick={()=>setMobileMenu(true)} aria-label="Open menu"><Menu size={20}/></button><div className="tv-breadcrumb"><span>TopVerify</span><ChevronRight size={14}/><strong>{activeService?.name || section}</strong></div></div><div className="tv-top-actions"><div className="tv-security-pill"><span/> {isApproved ? "SECURE WORKSPACE" : "ACCOUNT UNDER REVIEW"}</div><button className="tv-icon-btn" aria-label="Notifications" onClick={()=>flash("You are up to date.")}><Bell size={18}/></button><div className="tv-profile-mini"><div className="tv-avatar">{(profile?.full_name || "TV").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase()}</div><div><strong>{profile?.full_name || "Agent"}</strong><span>{profile?.is_super_admin ? "Administrator" : "Agent"}</span></div></div></div></header>
      <div className="tv-content">
        {notice && <div className={noticeError ? "tv-toast tv-toast-error" : "tv-toast"}><span>{noticeError ? <X size={16}/> : <Check size={16}/>}</span>{notice}<button onClick={()=>setNotice("")} aria-label="Dismiss"><X size={15}/></button></div>}
        {!isApproved && <div className="tv-review-banner"><Clock3 size={19}/><div><strong>Your account is awaiting review</strong><p>Your KYC details have been submitted. Identity requests remain locked until TopVerify approves your account.</p></div><span>Pending</span></div>}
        {section === "Overview" && !selected && <>
          <div className="tv-page-heading"><div><span className="tv-eyebrow"><Activity size={13}/> YOUR IDENTITY WORKSPACE</span><h1>Good to see you, {(profile?.full_name || "Agent").split(" ")[0]}</h1><p>One place for your identity workflows, wallet and request history.</p></div><button className="tv-button-primary" onClick={()=>{setSection("Services");setSelected(null);setShowPriceReview(false);}}><FileCheck2 size={16}/> New request</button></div>
          <div className="tv-stat-grid"><div className="tv-stat-card"><div><span>Available balance</span><div className="tv-stat-icon tv-blue"><Wallet size={18}/></div></div><strong>{money(Number(wallet?.balance_kobo || 0))}</strong><small>Dedicated agent wallet</small></div><div className="tv-stat-card"><div><span>Total requests shown</span><div className="tv-stat-icon tv-purple"><Activity size={18}/></div></div><strong>{history.length}</strong><small>Recent account activity</small></div><div className="tv-stat-card"><div><span>Account status</span><div className="tv-stat-icon tv-green"><ShieldCheck size={18}/></div></div><strong className="tv-status-word">{profile?.status || "Pending"}</strong><small>{isApproved ? "Live services enabled" : "Awaiting admin review"}</small></div><div className="tv-stat-card"><div><span>Available services</span><div className="tv-stat-icon tv-amber"><Fingerprint size={18}/></div></div><strong>{services.filter(s=>s.enabled).length}</strong><small>Provider-enabled catalogue</small></div></div>
          <div className="tv-home-grid"><section className="tv-panel tv-service-panel"><div className="tv-panel-heading"><div><h2>Start with a service</h2><p>Choose a verified workflow for an authorized request.</p></div><button className="tv-text-btn" onClick={()=>setSection("Services")}>All services <ArrowRight size={14}/></button></div><div className="tv-service-grid">{services.filter(s=>s.enabled).slice(0,4).map(service=>{const Icon=serviceIcon(service.id);return <button className="tv-service-card" key={service.id} onClick={()=>openService(service)}><div className="tv-service-top"><span className="tv-service-icon"><Icon size={20}/></span><ArrowRight size={15}/></div><strong>{service.name}</strong><p>{service.description}</p><div className="tv-service-bottom"><span>{service.category}</span><span className="tv-service-action">Select service <ArrowRight size={13}/></span></div></button>})}</div></section>
          <section className="tv-panel tv-wallet-panel"><div className="tv-panel-heading"><div><h2>Your wallet</h2><p>Account-specific funds</p></div><span className="tv-wallet-mark"><Wallet size={19}/></span></div><span className="tv-balance-label">AVAILABLE BALANCE</span><strong className="tv-wallet-amount">{money(Number(wallet?.balance_kobo || 0))}</strong><div className="tv-wallet-footer"><span><i/> NGN wallet</span><button onClick={()=>setSection("My wallet")}>Manage <ArrowRight size={14}/></button></div><div className="tv-wallet-info"><ShieldCheck size={16}/><span>Wallet balances change only through verified payment events or audited administrator adjustments.</span></div></section>
          <section className="tv-panel tv-history-panel"><div className="tv-panel-heading"><div><h2>Recent requests</h2><p>Latest service activity</p></div><button className="tv-text-btn" onClick={()=>setSection("Request history")}>View history <ArrowRight size={14}/></button></div><RequestTable history={history} services={services}/></section>
          <section className="tv-panel tv-responsibility"><div className="tv-responsibility-mark"><ShieldCheck size={22}/></div><h3>Responsible access, every time.</h3><p>Only request information for a lawful purpose with the data subject’s authorization. TopVerify records request references and limits access to your account.</p><div><span><Check size={14}/> Consent-first workflow</span><span><Check size={14}/> Account review</span><span><Check size={14}/> Private history</span></div></section></div>
        </>}
        {section === "Services" && <><div className="tv-page-heading"><div><span className="tv-eyebrow"><Fingerprint size={13}/> SERVICE CATALOGUE</span><h1>{selected ? selected.name : "Identity services"}</h1><p>{selected ? selected.description : "Choose the output you need. The exact fee appears after you enter the required details and review your request."}</p></div>{selected && <button className="tv-button-secondary" onClick={()=>{setSelected(null);setResult(null);}}>Back to catalogue</button>}</div>
          {!selected ? <><section className="tv-output-picker"><div className="tv-output-heading"><span className="tv-eyebrow"><ClipboardList size={13}/> NIN REQUEST FORMAT</span><h2>Choose how you need the result</h2><p>Select a format first. No service fee is displayed until you have entered the required details and reviewed the request.</p></div><div className="tv-output-grid">
              <button className="tv-output-option" onClick={()=>{const service=services.find(s=>s.id==="nin-lookup"&&s.enabled);if(service)openService(service,true);else flash("NIN verification is not currently available.",true);}}><span className="tv-output-icon"><ScanFace size={22}/></span><span className="tv-output-tag">01 / VERIFICATION</span><strong>Normal verification</strong><p>Receive the available verification details from the provider in a clean report.</p><span className="tv-output-action">Choose this format <ArrowRight size={14}/></span></button>
              <button className="tv-output-option" onClick={()=>{const service=services.find(s=>s.id==="nin-slip"&&s.enabled);if(service)openService(service,true);else flash("NIN slip generation is not currently available.",true);}}><span className="tv-output-icon"><IdCard size={22}/></span><span className="tv-output-tag">02 / DOCUMENT</span><strong>NIN slip card</strong><p>Request the provider-generated NIN slip PDF where the provider supports it.</p><span className="tv-output-action">Choose this format <ArrowRight size={14}/></span><span className="tv-output-mini-doc" aria-hidden="true"><i/><i/><i/></span></button>
              <button className="tv-output-option" onClick={()=>{const service=services.find(s=>s.id==="nin-image-report"&&s.enabled);if(service)openService(service,true);else flash("Image and written report is not currently configured.",true);}}><span className="tv-output-icon"><FileImage size={22}/></span><span className="tv-output-tag">03 / IMAGE + REPORT</span><strong>Image and written report</strong><p>Present the provider-returned image, when supplied, alongside a readable verification summary.</p><span className="tv-output-action">Choose this format <ArrowRight size={14}/></span></button>
            </div></section><div className="tv-searchbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search other services…"/><span>{filteredServices.length} services</span></div><div className="tv-catalog-grid">{filteredServices.map(service=>{const Icon=serviceIcon(service.id);return <button className="tv-service-card tv-service-card-large" key={service.id} onClick={()=>openService(service)}><div className="tv-service-top"><span className="tv-service-icon"><Icon size={20}/></span><ArrowRight size={15}/></div><strong>{service.name}</strong><p>{service.description}</p><div className="tv-service-bottom"><span>{service.category}</span><span className="tv-service-action">Select service <ArrowRight size={13}/></span></div></button>})}</div><div className="tv-soft-note"><ShieldCheck size={17}/><span>Validation, clearance and modification workflows remain hidden until their specific authorization, pricing and provider behavior have been reviewed.</span></div></>
          : <div className="tv-request-layout"><section className="tv-panel tv-request-panel"><div className="tv-panel-heading"><div><h2>Request details</h2><p>Enter only details required for this authorized request.</p></div><span className="tv-secure-label"><ShieldCheck size={14}/> Protected</span></div>
            {!isApproved ? <div className="tv-locked"><Clock3 size={25}/><h3>Approval required</h3><p>Your account must be approved before live identity requests can be submitted.</p></div> : <form className="tv-form tv-request-form" onSubmit={reviewRequest}>
              {selected.id==="nin-lookup" && <label>NIN<input inputMode="numeric" maxLength={11} required value={fields.nin} onChange={e=>setFields({...fields,nin:e.target.value.replace(/\D/g,"")})} placeholder="Enter 11-digit NIN"/></label>}
              {(selected.id==="phone-lookup" || selected.id==="phone-slip") && <label>Phone number<input inputMode="tel" required value={fields.phone} onChange={e=>setFields({...fields,phone:e.target.value})} placeholder="08012345678"/></label>}
              {selected.id==="tracking-id-lookup" && <label>Tracking ID<input required value={fields.trackingId} onChange={e=>setFields({...fields,trackingId:e.target.value.trim()})} placeholder="Enter provider-issued tracking ID"/></label>}
              {(selected.id==="bvn-verify" || selected.id==="bvn-slip") && <label>BVN<input inputMode="numeric" maxLength={11} required value={fields.bvn} onChange={e=>setFields({...fields,bvn:e.target.value.replace(/\D/g,"")})} placeholder="Enter 11-digit BVN"/></label>}
              {selected.id==="ipe-clearance" && <label>Tracking ID<input required value={fields.trackingId} onChange={e=>setFields({...fields,trackingId:e.target.value.trim()})} placeholder="Enter the provider tracking ID"/></label>}
              {selected.id==="nin-validation" && <><label>NIN<input inputMode="numeric" maxLength={11} required value={fields.nin} onChange={e=>setFields({...fields,nin:e.target.value.replace(/\D/g,"")})} placeholder="Enter 11-digit NIN"/></label><label>Validation issue<input required maxLength={80} value={fields.errorType} onChange={e=>setFields({...fields,errorType:e.target.value})} placeholder="Use the issue label provided by NINSlip, e.g. No Record"/></label></>}
              {selected.id==="nin-modification" && <><label>NIN<input inputMode="numeric" maxLength={11} required value={fields.nin} onChange={e=>setFields({...fields,nin:e.target.value.replace(/\D/g,"")})} placeholder="Enter 11-digit NIN"/></label><label>Modification type<select value={fields.fieldCode} onChange={e=>setFields({...fields,fieldCode:e.target.value,modificationValue:""})}><option value="032">Correction of name</option><option value="033">Phone number update</option><option value="034">Gender update</option><option value="035">Date of birth correction (subject to provider rules)</option><option value="037">Residential address update</option></select></label><label>{fields.fieldCode==="032"?"Correct full name":fields.fieldCode==="033"?"Correct phone number":fields.fieldCode==="034"?"Correct gender":fields.fieldCode==="035"?"Correct date of birth":"Correct residential address"}<input required value={fields.modificationValue} onChange={e=>setFields({...fields,modificationValue:e.target.value})} placeholder="Enter the correct details"/></label><label>Reason for correction<input required value={fields.modificationReason} onChange={e=>setFields({...fields,modificationReason:e.target.value})} placeholder="Briefly explain the correction"/></label></>}
              {selected.id==="demographic" && <><div className="tv-two-fields"><label>First name<input required value={fields.firstName} onChange={e=>setFields({...fields,firstName:e.target.value})}/></label><label>Last name<input required value={fields.lastName} onChange={e=>setFields({...fields,lastName:e.target.value})}/></label></div><div className="tv-two-fields"><label>Gender<select value={fields.gender} onChange={e=>setFields({...fields,gender:e.target.value})}><option value="m">Male</option><option value="f">Female</option></select></label><label>Date of birth<input required value={fields.dateOfBirth} onChange={e=>setFields({...fields,dateOfBirth:e.target.value})} placeholder="DD-MM-YYYY"/></label></div></>}
              {(selected.id==="nin-slip" || selected.id==="bvn-slip" || selected.id==="phone-slip") && <label>Slip type<select value={fields.slipType} onChange={e=>setFields({...fields,slipType:e.target.value})}><option>Standard Slip</option><option>Premium Slip</option><option>Regular Slip</option><option>Information Slip</option></select></label>}
              <label>Purpose for this request<select required value={requestPurpose} onChange={e=>setRequestPurpose(e.target.value)}><option>Customer onboarding / KYC with consent</option><option>Data subject requested their own record</option><option>Compliance verification with lawful basis</option></select></label>
              <label className="tv-terms"><input type="checkbox" checked={requestConsent} onChange={e=>setRequestConsent(e.target.checked)}/><span>I confirm I have the data subject’s authorization for this specific request, have explained the purpose, and will only use or share the result for that purpose.</span></label>
              {!showPriceReview ? <button className="tv-primary-btn" type="submit" disabled={requestLoading} aria-busy={requestLoading}>{requestLoading && <span className="tv-button-spinner" aria-hidden="true"/>}{requestLoading ? "Preparing review…" : "Review amount and continue"} {!requestLoading && <ArrowRight size={17}/>}</button> : <div className="tv-price-confirmation"><div className="tv-price-confirmation-top"><div><span>AMOUNT TO PAY</span><strong>{money(selected.price_kobo)}</strong></div><span className="tv-confirmation-check"><ShieldCheck size={18}/></span></div><p>This is the exact TopVerify fee for <strong>{selected.name}</strong>. Your wallet will be charged only after you confirm. Current wallet balance: <strong>{money(Number(wallet?.balance_kobo || 0))}</strong>.</p><div className="tv-confirmation-actions"><button className="tv-button-secondary" type="button" onClick={()=>setShowPriceReview(false)} disabled={requestLoading}>Edit details</button><button className="tv-primary-btn" type="button" onClick={()=>void submitRequest()} disabled={requestLoading} aria-busy={requestLoading}>{requestLoading && <span className="tv-button-spinner" aria-hidden="true"/>}{requestLoading ? "Submitting securely…" : "Confirm and generate"} {!requestLoading && <ArrowRight size={17}/>}</button></div></div>}
              <p className="tv-form-footnote"><ShieldCheck size={14}/> TopVerify checks account approval and wallet balance on the server. Your service fee is refunded if a recorded provider failure occurs.</p>
            </form>}
          </section><aside className="tv-panel tv-order-panel"><span className="tv-order-eyebrow">REQUEST SUMMARY</span><div className="tv-order-service"><span className="tv-service-icon"><SelectedIcon size={21}/></span><div><strong>{selected.name}</strong><span>{selected.category}</span></div></div>{showPriceReview ? <><div className="tv-order-line"><span>TopVerify service fee</span><strong>{money(selected.price_kobo)}</strong></div><div className="tv-order-total"><span>Amount to pay</span><strong>{money(selected.price_kobo)}</strong></div><div className="tv-order-balance"><span>Wallet balance</span><strong>{money(Number(wallet?.balance_kobo || 0))}</strong></div><p className="tv-order-note">Your wallet is charged only after you confirm the amount.</p></> : <div className="tv-order-note tv-order-price-hidden"><ShieldCheck size={15}/><span>Enter the required details and choose “Review amount” to see your exact fee before confirming.</span></div>}</aside>
          {result && <section className="tv-panel tv-result-panel"><div className="tv-panel-heading"><div><h2>{result.processing ? "Request submitted" : "Request result"}</h2><p>Reference: {String(result.reference || "")}</p></div><span className={result.processing ? "tv-table-status tv-table-pending" : "tv-complete-tag"}>{result.processing ? "Processing" : <><Check size={14}/> Completed</>}</span></div>{typeof result.message === "string" ? <p>{result.message}</p> : null}{result.processing === true ? <p className="tv-form-footnote">The provider accepted this request. It may take time to complete; keep the reference for follow-up. Your wallet fee has been charged for the accepted submission. Provider reference: {String(result.providerReference || "pending")}</p> : null}{result.slip !== null && typeof result.slip === "object" ? <button className="tv-primary-btn tv-download-btn" onClick={()=>downloadSlip(result.slip as Record<string,unknown>)}><ArrowDownToLine size={17}/> Download provider PDF slip</button> : null}{result.result !== null && typeof result.result === "object" ? selected?.id === "nin-image-report" ? <NinImageReport data={result.result as Record<string, unknown>} reference={String(result.reference || "")}/> : <pre className="tv-result-json">{JSON.stringify(result.result,null,2)}</pre> : null}<p className="tv-form-footnote"><ShieldCheck size={14}/> This is sensitive personal information. Download or share it only for the authorized purpose.</p></section>}
          </div>}
        </>}
        {section === "Request history" && <><div className="tv-page-heading"><div><span className="tv-eyebrow"><Clock3 size={13}/> AUDITABLE ACTIVITY</span><h1>Request history</h1><p>All your identity-service requests, including those still queued or processing.</p></div><button className="tv-button-primary" onClick={()=>setSection("Services")}><FileCheck2 size={16}/> New request</button></div><section className="tv-panel tv-history-panel"><RequestTable history={history} services={services}/></section></>}
        {section === "My wallet" && <><div className="tv-page-heading"><div><span className="tv-eyebrow"><Wallet size={13}/> WALLET & PAYMENTS</span><h1>My wallet</h1><p>Your individual TopVerify wallet is created automatically when you register.</p></div></div><div className="tv-wallet-page-grid"><section className="tv-wallet-hero"><span><Wallet size={16}/> AVAILABLE BALANCE</span><strong>{money(Number(wallet?.balance_kobo || 0))}</strong><p>NGN · Nigerian naira</p><div><button type="button" disabled={fundingLoading} onClick={()=>setShowFundForm(true)}>{fundingLoading && <span className="tv-button-spinner" aria-hidden="true"/>}Fund wallet {!fundingLoading && <ArrowRight size={15}/>}</button><span>{depositAccount ? "Permanent bank transfer + hosted checkout" : "Choose bank transfer or hosted payment"}</span></div></section>{depositAccount && <section className="tv-panel tv-fund-panel"><div className="tv-panel-heading"><div><h2>Your permanent deposit account</h2><p>Transfer to this account anytime. Credits are applied after Flutterwave confirms the transfer.</p></div><span className="tv-table-status tv-table-success">Active</span></div><div className="tv-account-details"><div><span>BANK</span><strong>{depositAccount.bank_name}</strong></div><div><span>ACCOUNT NUMBER</span><strong>{depositAccount.account_number}</strong><button type="button" className="tv-text-btn" onClick={()=>{void navigator.clipboard.writeText(depositAccount.account_number);flash("Account number copied.");}}>Copy account number</button></div><div><span>ACCOUNT NAME</span><strong>{profile?.full_name || "Your registered name"}</strong><small>Beneficiary display is controlled by Flutterwave and the receiving bank.</small></div></div><div className="tv-funding-actions"><button type="button" className="tv-button-primary" disabled={reconcileLoading} onClick={reconcileDepositAccount}>{reconcileLoading ? "Checking transfer…" : "I have transferred — check wallet"} {!reconcileLoading && <ArrowRight size={15}/>}</button></div></section>}{showFundForm && <section className="tv-panel tv-fund-panel"><div className="tv-panel-heading"><div><h2>Fund your wallet</h2><p>Choose a permanent bank-transfer account or continue with hosted payment.</p></div><button type="button" className="tv-text-btn" onClick={()=>{setShowFundForm(false);setFundAmount("");}}>Cancel</button></div>{!depositAccount && <div className="tv-account-setup"><h3><Landmark size={17}/> Set up permanent bank deposits</h3><p>Enter your NIN and give consent to request a permanent Flutterwave account. Your NIN is sent directly to Flutterwave and is not stored by TopVerify.</p><label>National Identification Number (NIN)<input value={accountNin} onChange={e=>setAccountNin(e.target.value.replace(/\D/g,"").slice(0,11))} inputMode="numeric" autoComplete="off" maxLength={11} placeholder="11-digit NIN"/></label><label className="tv-terms"><input type="checkbox" checked={acceptedAccountNinSharing} onChange={e=>setAcceptedAccountNinSharing(e.target.checked)}/><span>I consent to sending my NIN to Flutterwave to create my permanent deposit account.</span></label><button type="button" disabled={accountSetupLoading} className="tv-button-primary" onClick={async()=>{try{await setupDepositAccount(accountNin,acceptedAccountNinSharing);}catch(error){flash(error instanceof Error?error.message:"Unable to set up account.",true);}}}>{accountSetupLoading?"Creating account…":"Create permanent account"} {!accountSetupLoading&&<ArrowRight size={15}/>}</button><div className="tv-soft-note"><ShieldCheck size={17}/><span>Prefer not to provide your NIN? You can skip this and use hosted payment below.</span></div></div>}<div className="tv-hosted-payment"><h3><CreditCard size={17}/> Or use hosted payment</h3><p>Choose an amount and pay through Flutterwave checkout.</p><label>Amount (NGN)<input value={fundAmount} onChange={e=>setFundAmount(e.target.value.replace(/\D/g,""))} inputMode="numeric" min="500" max="1000000" type="number" placeholder="Enter amount (minimum ₦500)"/></label><div className="tv-quick-amounts">{["500","2000","5000","10000","20000"].map(n=><button type="button" key={n} className={fundAmount===n?"tv-quick-active":""} onClick={()=>setFundAmount(n)}>{money(Number(n)*100)}</button>)}</div><div className="tv-soft-note"><ShieldCheck size={17}/><span>Hosted wallet funding: ₦500–₦1,000,000 per transaction. Payments are credited only after Flutterwave verifies them.</span></div><div className="tv-funding-actions"><button type="button" className="tv-button-primary" disabled={fundingLoading} onClick={fundWallet}>{fundingLoading ? "Opening checkout…" : "Continue to secure payment"} {!fundingLoading && <ArrowRight size={15}/>}</button></div></div></section>}</div><section className="tv-panel tv-history-panel"><div className="tv-panel-heading"><div><h2>Wallet ledger</h2><p>Verified credits, service debits and refunds</p></div></div><LedgerTable userId={user.id}/></section><section className="tv-panel tv-history-panel"><div className="tv-panel-heading"><div><h2>Wallet funding transactions</h2><p>Pending deposits and verified top-ups</p></div></div><FundingTable userId={user.id}/></section></>}
        {section === "Agents" && profile?.is_super_admin && <AdminAgents supabase={supabase} onNotice={flash}/>}
        {section === "Pricing" && profile?.is_super_admin && <AdminPricing supabase={supabase} services={services} onRefresh={()=>user && refreshData(user.id)} onNotice={flash}/>}
        {profile?.is_super_admin && section === "Overview" && <div className="tv-admin-callout"><Users size={18}/><div><strong>Platform administrator</strong><p>Use Agent oversight to review new agent accounts. Keep approval and pricing changes auditable.</p></div></div>}
        <footer className="tv-footer"><span>© {new Date().getFullYear()} TopVerify</span><span><ShieldCheck size={13}/> Secure, accountable identity workflows</span><button className="tv-footer-support" type="button" onClick={()=>flash("Add your verified TopVerify support contact before launch.",true)}>Support</button></footer>
      </div>
    </section>
  </main>;
}

function NinImageReport({ data, reference }: { data: Record<string, unknown>; reference: string }) {
  const imageKeys = ["photo_url", "image_url", "photo", "image", "picture", "portrait", "face_image"];
  const rawImage = imageKeys.map(key => data[key]).find(value => typeof value === "string" && value.length > 80) as string | undefined;
  const imageSrc = rawImage
    ? rawImage.startsWith("data:image/") || rawImage.startsWith("https://")
      ? rawImage
      : /^[A-Za-z0-9+/=]+$/.test(rawImage) && rawImage.length > 1000
        ? `data:image/jpeg;base64,${rawImage}`
        : null
    : null;
  const entries = Object.entries(data).filter(([key, value]) =>
    !imageKeys.includes(key) && !["signature", "signature_url", "signature_base64"].includes(key) &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
    String(value).trim().length > 0
  );
  return <div className="tv-image-report">
    <div className="tv-image-report-head"><div><span>TOPVERIFY / VERIFICATION REPORT</span><h3>Identity verification summary</h3><p>Reference: {reference || "Available in request history"}</p></div><span className="tv-image-report-seal"><ShieldCheck size={20}/></span></div>
    <div className="tv-image-report-body">
      <div className="tv-image-report-photo">{imageSrc ? <img src={imageSrc} alt="Image returned by the identity provider" referrerPolicy="no-referrer"/> : <div className="tv-image-report-no-photo"><FileImage size={28}/><span>No image was supplied by the provider</span></div>}</div>
      <dl>{entries.length ? entries.map(([key, value]) => <div key={key}><dt>{key.replace(/[_-]+/g, " ")}</dt><dd>{String(value)}</dd></div>) : <div><dt>Report</dt><dd>The provider returned no displayable fields. Check the request reference and provider response.</dd></div>}</dl>
    </div>
    <p className="tv-image-report-foot">Provider-supplied information only. This report is not a government-issued identity document. Keep it private and use it only for the authorized purpose.</p>
  </div>;
}

function RequestTable({ history, services }: { history: RequestRow[]; services: Service[] }) {
  if (!history.length) return <div className="tv-empty"><div><Clock3 size={21}/></div><strong>No requests yet</strong><span>Your completed and failed requests will appear here.</span></div>;
  return <div className="tv-table-scroll"><table className="tv-table"><thead><tr><th>SERVICE</th><th>REFERENCE</th><th>DATE</th><th>FEE</th><th>STATUS</th></tr></thead><tbody>{history.map(row=><tr key={row.id}><td><strong>{services.find(s=>s.id===row.service_id)?.name || row.service_id}</strong></td><td className="tv-ref">{row.request_reference}{row.provider_reference && row.provider_reference !== row.request_reference ? <small>{row.provider_reference}</small> : null}</td><td>{dateText(row.created_at)}</td><td>{money(row.fee_kobo)}</td><td><span className={row.status==="completed"?"tv-table-status tv-table-success":row.status==="failed"||row.status==="refunded"?"tv-table-status tv-table-failed":"tv-table-status tv-table-pending"}>{row.status}</span></td></tr>)}</tbody></table></div>;
}

function LedgerTable({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Array<{id:string;entry_type:string;amount_kobo:number;description:string;reference:string;created_at:string}>>([]);
  useEffect(()=>{
    const client=createClient();
    const load=()=>client.from("wallet_ledger").select("id,entry_type,amount_kobo,description,reference,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(100).then(({data})=>setRows(data||[]));
    void load();
    const channel=client.channel(`topverify-ledger-${userId}`).on("postgres_changes",{event:"*",schema:"public",table:"wallet_ledger",filter:`user_id=eq.${userId}`},()=>{void load();}).subscribe();
    return ()=>{void client.removeChannel(channel);};
  },[userId]);
  if (!rows.length) return <div className="tv-empty"><div><Wallet size={21}/></div><strong>No wallet activity</strong><span>Verified credits, service debits and refunds will be listed here.</span></div>;
  return <div className="tv-table-scroll"><table className="tv-table"><thead><tr><th>TYPE</th><th>REFERENCE</th><th>DESCRIPTION</th><th>DATE</th><th>AMOUNT</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.entry_type}</td><td className="tv-ref">{row.reference}</td><td>{row.description}</td><td>{dateText(row.created_at)}</td><td>{money(row.amount_kobo)}</td></tr>)}</tbody></table></div>;
}

function FundingTable({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Array<{id:string;tx_ref:string;amount_kobo:number;currency:string;status:string;created_at:string;updated_at:string;credited_at:string|null;provider_reference:string|null}>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try {
        const response=await fetch("/api/payments/wallet-history",{cache:"no-store"});
        const payload=await response.json();
        if(active && response.ok && Array.isArray(payload.topups)) setRows(payload.topups);
      } catch { /* Keep the last known transaction list visible while offline. */ }
      finally { if(active) setLoading(false); }
    };
    void load();
    const interval=window.setInterval(()=>{if(document.visibilityState==="visible") void load();},10000);
    const onFocus=()=>void load();
    window.addEventListener("focus",onFocus);
    return ()=>{active=false;window.clearInterval(interval);window.removeEventListener("focus",onFocus);};
  },[userId]);
  if (loading && !rows.length) return <div className="tv-empty"><div><Clock3 size={21}/></div><strong>Loading funding history…</strong><span>Checking your latest wallet top-ups.</span></div>;
  if (!rows.length) return <div className="tv-empty"><div><Wallet size={21}/></div><strong>No funding transactions yet</strong><span>Once you start a deposit, its status will appear here.</span></div>;
  return <div className="tv-table-scroll"><table className="tv-table"><thead><tr><th>REFERENCE</th><th>DATE</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td className="tv-ref">{row.tx_ref}</td><td>{dateText(row.created_at)}</td><td>{money(row.amount_kobo)}</td><td><span className={row.status==="credited"?"tv-table-status tv-table-success":row.status==="failed"?"tv-table-status tv-table-failed":"tv-table-status tv-table-pending"}>{row.status==="credited"?"Credited":row.status==="failed"?"Failed":"Pending"}</span></td></tr>)}</tbody></table></div>;
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
  const [enabledValues,setEnabledValues]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState("");
  useEffect(() => {
    setPrices(Object.fromEntries(services.map(s => [s.id, String(s.price_kobo / 100)])));
    setEnabledValues(Object.fromEntries(services.map(s => [s.id, s.enabled])));
  }, [services]);
  async function save(service:Service) {
    const value=Number(prices[service.id]);
    const enabled=enabledValues[service.id] ?? service.enabled;
    if(!Number.isFinite(value)||value<0){onNotice("Enter a valid non-negative price.",true);return;}
    if(enabled && value<=0){onNotice("Set a positive retail fee before enabling a service.",true);return;}
    setBusy(service.id);
    const {error}=await supabase.from("services").update({price_kobo:Math.round(value*100),enabled,updated_at:new Date().toISOString()}).eq("id",service.id);
    if(error)onNotice("Could not save service settings. Confirm administrator permissions and database policy.",true);
    else{onNotice("Service settings saved.");onRefresh();}
    setBusy("");
  }
  return <><div className="tv-page-heading"><div><span className="tv-eyebrow"><CreditCard size={13}/> PLATFORM CONTROL</span><h1>Service pricing</h1><p>Set TopVerify’s retail fee separately from the upstream provider cost. New services stay hidden until you set a fee and enable them.</p></div></div><section className="tv-panel tv-pricing-list">{services.map(service=><div className="tv-price-row" key={service.id}><div><strong>{service.name}</strong><span>{service.description}</span><small className={service.enabled?"tv-table-status tv-table-success":"tv-table-status tv-table-pending"}>{enabledValues[service.id] ?? service.enabled ? "Enabled" : "Hidden until configured"}</small></div><label>Retail fee (NGN)<input type="number" min="0" value={prices[service.id]??String(service.price_kobo/100)} onChange={e=>setPrices({...prices,[service.id]:e.target.value})}/></label><label className="tv-service-enable"><input type="checkbox" checked={enabledValues[service.id] ?? service.enabled} onChange={e=>setEnabledValues({...enabledValues,[service.id]:e.target.checked})}/> Visible to customers</label><button disabled={busy===service.id} onClick={()=>void save(service)}>{busy===service.id?<><span className="tv-button-spinner" aria-hidden="true"/> Saving…</>:"Save settings"}</button></div>)}</section></>;
}
