"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowLeft, MailCheck, ArrowRight, ArrowUpRight, BadgeCheck, Building2, Check, ChevronRight, CircleHelp, Clock3, Copy, FileCheck2, FileImage, FilePenLine, FileSearch,
  FileText, Home, IdCard, Landmark, LogOut, Menu, RefreshCw, ScanFace, Search, ShieldCheck, Smartphone, UserRound, UserRoundCheck, Wallet, X,
} from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { money, dateText, type Service } from "@/lib/format";
import { Select } from "@/components/ui/Select";
import { useConfirm } from "@/components/ui/Confirm";
import { CountUp } from "@/components/ui/CountUp";
import { ServicePreview } from "@/components/ServicePreview";
import { ServiceRequestModal } from "@/components/ServiceRequestModal";
import { AdminConsole } from "@/components/admin/AdminConsole";

type Profile = {
  id: string; full_name: string; phone: string | null; business_name: string | null;
  business_address: string | null; intended_use: string | null; status: "pending" | "approved" | "restricted";
  is_super_admin: boolean; terms_accepted_at: string | null;
};
type WalletRow = { balance_kobo: number; currency: string };
type DepositAccount = { account_number: string; bank_name: string; status: string; created_at?: string };
type RequestRow = { id: string; service_id: string; status: string; fee_kobo: number; request_reference: string; provider_reference?: string | null; created_at: string };

const intendedOptions = [
  "Customer onboarding and identity verification with consent",
  "Internal compliance checks with consent",
  "Professional agent / reseller services",
  "Other lawful business purpose",
].map(value => ({ value, label: value }));

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [history, setHistory] = useState<RequestRow[]>([]);
  const [section, setSection] = useState("Overview");
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [forgotSent, setForgotSent] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [landingServices, setLandingServices] = useState<Service[]>([
    { id: "nin-lookup", name: "NIN Verification", description: "Verify identity details with an authorized request.", category: "Verification", price_kobo: 35000, enabled: true },
    { id: "bvn-verify", name: "BVN Verification", description: "Validate a BVN for an authorized workflow.", category: "Verification", price_kobo: 40000, enabled: true },
    { id: "nin-slip", name: "NIN Slip Generation", description: "Request an eligible NIN document.", category: "Documents", price_kobo: 120000, enabled: true },
    { id: "ipe-clearance", name: "IPE Clearance", description: "Submit an eligible clearance request.", category: "Clearance", price_kobo: 150000, enabled: true },
  ]);
  const [authLoading, setAuthLoading] = useState(false);
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
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [checking, setChecking] = useState(true);
  const [fundAmount, setFundAmount] = useState("");
  const [showFundForm, setShowFundForm] = useState(false);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [returnCheck, setReturnCheck] = useState(false);
  const { confirm, dialog } = useConfirm();

  const flash = (message: string, isError = false) => { setNotice(message); setNoticeError(isError); };

  const loadDepositAccount = useCallback(async () => {
    try {
      const response = await fetch("/api/payments/virtual-account", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) setDepositAccount(payload.account?.status === "active" ? payload.account : null);
    } catch {}
  }, []);

  const lastPaymentCheck = useRef(0);
  async function checkPayments(silent = false) {
    if (!user?.id) return;
    lastPaymentCheck.current = Date.now();
    if (!silent) setReconcileLoading(true);
    try {
      const response = await fetch("/api/payments/reconcile", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to check your payment.");
      if (!silent || payload.credited > 0) flash(payload.message || "Payment check completed.");
      await refreshData(user.id);
    } catch (error) {
      if (!silent) flash(error instanceof Error ? error.message : "Unable to check your payment.", true);
    } finally {
      if (!silent) setReconcileLoading(false);
    }
  }

  async function setupDepositAccount(nin: string, consent: boolean) {
    if (!/^\d{11}$/.test(nin.replace(/\s/g, ""))) throw new Error("Enter your 11-digit NIN.");
    if (!consent) throw new Error("Please give consent to verify your NIN.");
    setAccountSetupLoading(true);
    try {
      const response = await fetch("/api/payments/virtual-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nin: nin.replace(/\s/g, ""), consent: true }),
      });
      const payload = await response.json();
      if (!response.ok || payload.account?.status !== "active") throw new Error(payload.error || "Unable to verify your NIN.");
      setDepositAccount(payload.account);
      if (user?.id) await refreshData(user.id);
      setAccountNin("");
      setRegistrationNin("");
      setAcceptedAccountNinSharing(false);
      setAcceptedNinSharing(false);
      flash("NIN verified. Your account is active.");
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
    if (paymentState !== "failed") setReturnCheck(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!returnCheck || !user?.id) return;
    setReturnCheck(false);
    void checkPayments(true);
  }, [returnCheck, user?.id]);

  useEffect(() => {
    if (section !== "My wallet" || !user?.id) return;
    if (Date.now() - lastPaymentCheck.current < 60000) return;
    void checkPayments(true);
  }, [section, user?.id]);

  useEffect(() => {
    let active = true;
    const loadPublicServices = async () => {
      try {
        const response = await fetch("/api/services", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (active && Array.isArray(payload.services)) setLandingServices(payload.services);
      } catch {}
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

  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get("auth");
    if (mode === "signin" || mode === "signup" || mode === "forgot") {
      setAuthMode(mode);
      setShowAuth(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resendVerification(address: string) {
    if (cooldown > 0) return;
    try {
      const response = await fetch("/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: address }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not send the email.");
      setCooldown(60);
      flash("A new verification email is on its way.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not send the email.", true);
    }
  }

  const filteredServices = useMemo(() => services.filter(s => s.enabled && !["nin-lookup", "nin-slip", "nin-image-report"].includes(s.id) && (s.name + " " + s.description + " " + s.category).toLowerCase().includes(query.toLowerCase())), [services, query]);
  const serviceIcon = (id: string) => id === "ipe-clearance" ? BadgeCheck : id === "nin-image-report" ? FileText : id === "nin-validation" || id === "tracking-id-lookup" ? FileSearch : id === "nin-modification" ? FilePenLine : id === "demographic" ? UserRoundCheck : id.includes("phone") ? Smartphone : id.includes("slip") ? FileCheck2 : id.includes("bvn") ? Landmark : IdCard;

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setAuthLoading(true); setNotice("");
    try {
      if (authMode === "signup") {
        if (!acceptedTerms) throw new Error("Please accept the terms to continue.");
        if (!/^\d{11}$/.test(registrationNin.replace(/\s/g, ""))) throw new Error("Enter your 11-digit NIN.");
        if (!acceptedNinSharing) throw new Error("Please give consent to verify your NIN.");
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email, password, fullName, phone, businessName, businessAddress, intendedUse,
            nin: registrationNin.replace(/\s/g, ""), ninConsent: acceptedNinSharing, acceptedTerms,
          }),
        });
        const created = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(created.error || "Unable to create your account.");
        if (created.needsEmailConfirmation) {
          setRegistrationNin("");
          setPassword("");
          setPendingEmail(email);
          setCooldown(60);
          if (created.emailSent === false) flash("Your account is created, but the email could not be sent. Tap Resend.", true);
          return;
        }
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) {
          setUser({ id: data.user.id, email: data.user.email });
          setRegistrationNin("");
          await refreshData(data.user.id);
          flash("NIN verified. Your account is active.");
        }
      } else if (authMode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error && !/rate|limit/i.test(error.message)) throw error;
        if (error) throw new Error("Please wait a minute before requesting another link.");
        setForgotSent(true);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (/not confirmed/i.test(error.message)) { setPendingEmail(email); throw new Error("Verify your email first. We can send the link again."); }
          throw error;
        }
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

  const openService = (service: Service) => setSelected(service);

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


  if (!isSupabaseConfigured()) return <main className="tv-config-screen"><div className="tv-brand-mark"><ShieldCheck size={25}/></div><span className="tv-form-eyebrow">TOPVERIFY SETUP</span><h1>One last connection step.</h1><p>Add the Supabase URL and publishable key in your deployment environment to activate secure authentication, KYC profiles and agent wallets.</p><code>NEXT_PUBLIC_SUPABASE_URL</code><code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code><small>Server-side NINSlip and wallet operations also require SUPABASE_SERVICE_ROLE_KEY and NINSLIP_API_KEY.</small></main>;

  if (checking) return <main className="tv-loading"><div className="tv-orbit"><IdCard size={30}/></div><strong>TopVerify</strong><span>Preparing your secure workspace…</span></main>;

  if (!user && !showAuth) return <main className="tv-landing">
    <header className="tv-landing-nav">
      <a className="tv-landing-brand" href="/" aria-label="TopVerify home"><span className="tv-landing-mark"><ShieldCheck size={24}/></span><span><strong>TopVerify</strong><small>IDENTITY OPERATIONS</small></span></a>
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
        <div className="tv-id-card"><div className="tv-id-top"><span className="tv-id-emblem"><IdCard size={18}/></span><span>IDENTITY RECORD</span><BadgeCheck size={17}/></div><div className="tv-id-main"><div className="tv-id-portrait"><ScanFace size={46}/></div><div><small>SECURE REQUEST</small><strong>Identity verification</strong><span>Consent and purpose recorded</span></div></div><div className="tv-id-lines"><i/><i/><i/></div><div className="tv-id-foot"><span>REFERENCE-READY</span><ShieldCheck size={15}/></div></div>
        <div className="tv-float-note"><span><Check size={14}/></span><div><strong>One connected workflow</strong><small>Wallet · Request · Record</small></div></div>
        <div className="tv-visual-caption"><span>DESIGNED FOR PROFESSIONAL USE</span><span>NG / 01</span></div>
      </div>
    </section>
    <div className="tv-landing-metrics"><div><strong>One wallet</strong><span>Fund once, use across enabled services</span></div><div><strong>Connected services</strong><span>Identity, document and clearance workflows</span></div><div><strong>Accountable access</strong><span>Approval and purpose-specific consent</span></div></div>
    <section className="tv-landing-services" id="services"><div className="tv-landing-section-head"><div><span className="tv-landing-overline">SERVICE DIRECTORY</span><h2>Built around the work<br/>you need to get done.</h2></div><p>Explore available identity workflows. Services requiring provider approval or additional details are clearly identified before you submit a request.</p></div>
      <div className="tv-landing-service-grid">{landingServices.map(service=>{const Icon=service.id==="ipe-clearance"?BadgeCheck:service.id==="nin-image-report"?FileImage:service.id==="nin-validation"||service.id==="tracking-id-lookup"?FileSearch:service.id==="nin-modification"?FilePenLine:service.id.includes("slip")?FileCheck2:service.id.includes("bvn")?IdCard:service.id.includes("phone")?Smartphone:service.id==="demographic"?UserRoundCheck:IdCard;return <article className="tv-landing-service" key={service.id}><div className="tv-landing-service-top"><span><Icon size={20}/></span><small>{service.category}</small></div><h3>{service.name}</h3><p>{service.description}</p><div className="tv-landing-service-bottom"><span>Available in workspace</span><button aria-label={"Start "+service.name} onClick={()=>{setAuthMode("signup");setIntendedUse("Customer onboarding and identity verification with consent");setShowAuth(true);}}>Get started <ArrowUpRight size={15}/></button></div></article>})}</div>
      <div className="tv-catalog-footnote"><ShieldCheck size={16}/> Service availability depends on account approval, provider availability and lawful authorization. Current service fees are shown only inside your workspace.</div>
    </section>
    <section className="tv-landing-how" id="how-it-works"><div><span className="tv-landing-overline">A STRAIGHTFORWARD PROCESS</span><h2>From funding to<br/>finished request.</h2><p>Built to keep the important details visible, without making everyday tasks complicated.</p><button className="tv-hero-secondary" onClick={()=>{setAuthMode("signup");setShowAuth(true);}}>Create your account <ArrowRight size={16}/></button></div><div className="tv-step-list"><article><span>01</span><div><h3>Create your account</h3><p>Register with your details and complete the account review process.</p></div><UserRound size={20}/></article><article><span>02</span><div><h3>Fund your TopVerify wallet</h3><p>Pay securely through Flutterwave. Verified payments update your wallet ledger.</p></div><Wallet size={20}/></article><article><span>03</span><div><h3>Choose an enabled service</h3><p>Review the fee, provide required details and confirm authorization.</p></div><IdCard size={20}/></article><article><span>04</span><div><h3>Track the outcome</h3><p>Follow request references and see debits or refunds in your history.</p></div><Activity size={20}/></article></div></section>
    <section className="tv-agent-band" id="for-agents"><div className="tv-agent-band-icon"><Landmark size={24}/></div><div><span className="tv-landing-overline">FOR PROFESSIONAL AGENTS</span><h2>Your services. One operational workspace.</h2><p>Manage approved identity workflows, keep a funded wallet and see your activity in one place.</p></div><button onClick={()=>{setAuthMode("signup");setIntendedUse("Professional agent / reseller services");setShowAuth(true);}}>Register as an agent <ArrowRight size={16}/></button></section>
    <footer className="tv-landing-footer"><a className="tv-landing-brand" href="/"><span className="tv-landing-mark"><ShieldCheck size={22}/></span><span><strong>TopVerify</strong><small>IDENTITY OPERATIONS</small></span></a><span>Purpose-led identity services for authorized use.</span><div><a href="/privacy">Privacy</a><a href="/acceptable-use">Acceptable use</a><button onClick={()=>{setAuthMode("signin");setShowAuth(true);}}>Sign in</button></div></footer>
  </main>;

  if (!user) return <main className="tv-auth-shell" aria-busy={authLoading}>
    <div className="tv-auth-art">
      <div className="tv-auth-3d-scene" aria-hidden="true"><div className="tv-auth-orbit-ring"/><div className="tv-flip-card tv-flip-card-back"><div className="tv-flip-card-top"><IdCard size={18}/><span>TOPVERIFY / SECURE</span></div><div className="tv-flip-chip"/><div className="tv-flip-lines"><i/><i/><i/></div><small>IDENTITY OPERATIONS</small></div><div className="tv-flip-card-front"><div className="tv-flip-card-top"><ShieldCheck size={18}/><span>VERIFIED WORKFLOW</span></div><div className="tv-flip-portrait"><ScanFace size={34}/></div><div className="tv-flip-lines"><i/><i/><i/></div><div className="tv-flip-card-bottom"><span>SECURE ACCESS</span><BadgeCheck size={17}/></div></div></div>
      <div className="tv-brand tv-brand-light"><div className="tv-brand-mark"><ShieldCheck size={25}/></div><div><strong>TopVerify</strong><span>IDENTITY OPERATIONS</span></div></div>
      <div className="tv-auth-copy"><span className="tv-kicker"><span/> TRUSTED WORKFLOWS. ACCOUNTABLE ACCESS.</span><h1>Identity services,<br/><em>under your control.</em></h1><p>A workspace for authorized agents to request identity checks, manage dedicated funds, and keep accountable records.</p>
        <div className="tv-trust-row"><div><ShieldCheck size={17}/><span>Consent-first access</span></div><div><Wallet size={17}/><span>Dedicated wallets</span></div><div><Activity size={17}/><span>Auditable requests</span></div></div>
      </div>
      <div className="tv-auth-bottom"><span>TOPVERIFY / SECURE AGENT NETWORK</span><span>BUILT FOR RESPONSIBLE IDENTITY OPERATIONS</span></div>
    </div>
    <div className="tv-auth-panel">
      <div className="tv-auth-mobile-brand"><div className="tv-brand-mark"><ShieldCheck size={23}/></div><strong>TopVerify</strong></div>
      <div className="tv-auth-form-wrap">
        <button className="tv-back-home" type="button" onClick={()=>{setShowAuth(false);setNotice("");}}><ArrowLeft size={15}/> Back to TopVerify</button>
        {pendingEmail ? (
          <div className="tv-pending">
            <div className="tv-pending-icon"><MailCheck size={34} /></div>
            <h2>Check your email</h2>
            <p className="tv-muted">We sent a verification link to <strong>{pendingEmail}</strong>. Open it to finish and sign in.</p>
            {notice && <div className={noticeError ? "tv-alert tv-alert-error" : "tv-alert"}>{notice}</div>}
            <button type="button" className="tv-primary-btn tv-auth-submit" disabled={cooldown > 0} onClick={() => void resendVerification(pendingEmail)}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}</button>
            <div className="tv-auth-switch"><button type="button" onClick={() => { setPendingEmail(null); setAuthMode("signin"); setNotice(""); }}>Back to sign in</button></div>
          </div>
        ) : <>
        <h2>{authMode === "signin" ? "Welcome back." : authMode === "forgot" ? "Reset your password." : "Create your account."}</h2>
        <p className="tv-muted">{authMode === "signin" ? "Sign in to continue." : authMode === "forgot" ? "We will email you a reset link." : "Your NIN is verified when you register."}</p>
        <form onSubmit={handleAuth} className="tv-form">
          {authMode === "signup" && <>
            <label>Full name<input required autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your legal name"/></label>
            <div className="tv-two-fields"><label>Phone number<input required autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="080…"/></label><label>Business / agency<input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Optional"/></label></div>
            <label>Business address<input value={businessAddress} onChange={e=>setBusinessAddress(e.target.value)} placeholder="Business location (if applicable)"/></label>
            <label>NIN<input required inputMode="numeric" autoComplete="off" maxLength={11} value={registrationNin} onChange={e=>setRegistrationNin(e.target.value.replace(/\D/g,"").slice(0,11))} placeholder="Enter your 11-digit NIN"/></label>
            <label className="tv-terms"><input type="checkbox" checked={acceptedNinSharing} onChange={e=>setAcceptedNinSharing(e.target.checked)}/><span>I consent to sending my NIN to Flutterwave for verification. It is not stored by TopVerify.</span></label>
            <Select label="Intended use" value={intendedUse} onChange={setIntendedUse} options={intendedOptions}/>
          </>}
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label>
          {authMode !== "forgot" && <label>Password<input required minLength={8} type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label>}
          {authMode === "signin" && <button type="button" className="tv-forgot-link" onClick={()=>{setAuthMode("forgot");setForgotSent(false);setNotice("");}}>Forgot password?</button>}
          {authMode === "signup" && <label className="tv-terms"><input type="checkbox" checked={acceptedTerms} onChange={e=>setAcceptedTerms(e.target.checked)}/><span>I agree to the <a href="/acceptable-use" target="_blank" rel="noreferrer">acceptable-use rules</a> and <a href="/privacy" target="_blank" rel="noreferrer">privacy notice</a>.</span></label>}
          {forgotSent && <div className="tv-alert">If that email has an account, a reset link is on its way.</div>}
          {notice && <div className={noticeError ? "tv-alert tv-alert-error" : "tv-alert"}>{notice}</div>}
          <button className="tv-primary-btn tv-auth-submit" type="submit" disabled={authLoading} aria-busy={authLoading}><span className={authLoading ? "tv-button-spinner" : "tv-button-spinner tv-button-spinner-hidden"} aria-hidden="true"/>{authLoading ? (authMode === "signup" ? "Verifying NIN…" : authMode === "forgot" ? "Sending…" : "Signing in…") : authMode === "signin" ? "Sign in" : authMode === "forgot" ? "Send reset link" : "Create account"} {!authLoading && <ArrowRight size={17}/>}</button>
        </form>
        <div className="tv-auth-switch">{authMode === "signin" ? "New to TopVerify?" : authMode === "forgot" ? "Remembered it?" : "Already have an account?"} <button onClick={()=>{setAuthMode(authMode==="signin"?"signup":"signin");setNotice("");setForgotSent(false);}}>{authMode === "signin" ? "Create account" : authMode === "forgot" ? "Back to sign in" : "Sign in instead"}</button></div>
        </>}
      </div>
    </div>
  </main>;

  const isApproved = Boolean(profile?.status === "approved" || profile?.is_super_admin);
  const isAdmin = Boolean(profile?.is_super_admin);
  const navItems = [
    { label: "Overview", icon: Home },
    { label: "Services", icon: IdCard },
    { label: "Request history", icon: Clock3 },
    { label: "My wallet", icon: Wallet },
    ...(isAdmin ? [{ label: "Admin", icon: ShieldCheck }] : []),
  ];
  const shortLabel = (label: string) => label === "Request history" ? "History" : label === "My wallet" ? "Wallet" : label;
  const goTo = (label: string) => { setSection(label); setSelected(null); setMobileMenu(false); setNotice(""); };
  const balanceKobo = Number(wallet?.balance_kobo || 0);
  const firstName = (profile?.full_name || "there").split(" ")[0];
  const initials = (profile?.full_name || user.email || "TV").split(" ").map(x => x[0]).join("").slice(0, 2).toUpperCase();
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const nin3 = ["nin-lookup", "nin-slip", "nin-image-report"];
  const formatCards = [
    { id: "nin-lookup", title: "Normal verification", tag: "Verification" },
    { id: "nin-slip", title: "NIN slip card", tag: "Document" },
    { id: "nin-image-report", title: "Image and report", tag: "Image + report" },
  ];

  async function confirmSignOut() {
    const ok = await confirm({ title: "Sign out?", message: "You will need to sign in again to continue.", confirmLabel: "Sign out" });
    if (ok) await signOut();
  }

  const verifyPanel = !depositAccount && (
    <section className="tv-panel tv-fund-panel tv-rise">
      <div className="tv-panel-heading"><div><h2>Verify your NIN</h2><p>Activates your account and creates your deposit account.</p></div><IdCard size={22} className="tv-panel-icon" /></div>
      <div className="tv-account-setup">
        <label className="tv-field"><span className="tv-field-label">NIN</span><input value={accountNin} onChange={e => setAccountNin(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" autoComplete="off" maxLength={11} placeholder="11-digit NIN" /></label>
        <label className="tv-terms"><input type="checkbox" checked={acceptedAccountNinSharing} onChange={e => setAcceptedAccountNinSharing(e.target.checked)} /><span>I consent to sending my NIN to Flutterwave for verification. It is not stored by TopVerify.</span></label>
        <button type="button" disabled={accountSetupLoading} className="tv-button-primary" onClick={async () => { try { await setupDepositAccount(accountNin, acceptedAccountNinSharing); } catch (error) { flash(error instanceof Error ? error.message : "Unable to verify your NIN.", true); } }}>
          {accountSetupLoading && <span className="tv-button-spinner" aria-hidden="true" />}{accountSetupLoading ? "Verifying" : "Verify NIN"}
        </button>
      </div>
    </section>
  );

  return <main className="tv-app">
    {mobileMenu && <button className="tv-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <aside className={mobileMenu ? "tv-sidebar tv-sidebar-open" : "tv-sidebar"}>
      <div className="tv-brand"><div className="tv-brand-mark"><ShieldCheck size={22} /></div><div><strong>TopVerify</strong><span>IDENTITY OPERATIONS</span></div><button className="tv-icon-btn tv-close-menu" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="tv-workspace-card"><div className="tv-avatar">{initials}</div><div><strong>{profile?.business_name || profile?.full_name || "Workspace"}</strong><span>{isAdmin ? "Administrator" : isApproved ? "Verified" : "Not verified"}</span></div><span className={isApproved ? "tv-status-dot" : "tv-status-dot tv-status-dot-off"} /></div>
      <nav className="tv-nav">
        <span className="tv-nav-label">MENU</span>
        {navItems.filter(i => i.label !== "Admin").map(item => <button key={item.label} className={section === item.label ? "tv-nav-item tv-nav-active" : "tv-nav-item"} onClick={() => goTo(item.label)}><item.icon size={18} /><span>{item.label}</span>{item.label === "Request history" && <small>{history.length}</small>}</button>)}
        {isAdmin && <><span className="tv-nav-label tv-nav-spaced">ADMIN</span><button className={section === "Admin" ? "tv-nav-item tv-nav-active" : "tv-nav-item"} onClick={() => goTo("Admin")}><ShieldCheck size={18} /><span>Admin console</span></button></>}
      </nav>
      <div className="tv-sidebar-foot">
        {supportEmail && <a className="tv-contact-support" href={`mailto:${supportEmail}`}><CircleHelp size={15} /> Contact support</a>}
        <button className="tv-logout" onClick={() => void confirmSignOut()}><LogOut size={17} /> Sign out <span>{user.email}</span></button>
      </div>
    </aside>
    <section className="tv-main">
      <header className="tv-topbar"><div className="tv-top-left"><button className="tv-icon-btn tv-menu-btn" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={20} /></button><div className="tv-breadcrumb"><span>TopVerify</span><ChevronRight size={14} /><strong>{section}</strong></div></div><div className="tv-top-actions"><button className="tv-balance-chip" onClick={() => goTo("My wallet")} aria-label="Open wallet"><Wallet size={15} /><CountUp kobo={balanceKobo} /></button><div className={isApproved ? "tv-security-pill" : "tv-security-pill tv-security-pill-warn"}><span /> {isApproved ? "VERIFIED" : "NOT VERIFIED"}</div><div className="tv-profile-mini"><div className="tv-avatar">{initials}</div><div><strong>{profile?.full_name || "Account"}</strong><span>{isAdmin ? "Administrator" : "Member"}</span></div></div></div></header>
      <div className="tv-content">
        {notice && <div className={noticeError ? "tv-toast tv-toast-error" : "tv-toast"} role="status"><span>{noticeError ? <X size={14} /> : <Check size={14} />}</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        {!isApproved && <div className="tv-review-banner tv-rise"><IdCard size={19} /><div><strong>Verify your NIN to activate your account</strong></div><button type="button" className="tv-button-primary tv-btn-sm" onClick={() => goTo("My wallet")}>Verify NIN</button></div>}
        <div className="tv-view" key={section}>
          {section === "Overview" && <>
            <div className="tv-page-heading"><div><h1>Hi, {firstName}</h1></div><button className="tv-button-primary" onClick={() => goTo("Services")}><FileCheck2 size={16} /> New request</button></div>
            <div className="tv-stat-grid">
              <div className="tv-stat-card tv-rise"><div><span>Balance</span><div className="tv-stat-icon tv-blue"><Wallet size={18} /></div></div><strong><CountUp kobo={balanceKobo} /></strong></div>
              <div className="tv-stat-card tv-rise" style={{ animationDelay: ".06s" }}><div><span>Requests</span><div className="tv-stat-icon tv-purple"><Activity size={18} /></div></div><strong>{history.length}</strong></div>
              <div className="tv-stat-card tv-rise" style={{ animationDelay: ".12s" }}><div><span>Account</span><div className="tv-stat-icon tv-green"><ShieldCheck size={18} /></div></div><strong className="tv-status-word">{isApproved ? "Verified" : "Not verified"}</strong></div>
              <div className="tv-stat-card tv-rise" style={{ animationDelay: ".18s" }}><div><span>Services</span><div className="tv-stat-icon tv-amber"><IdCard size={18} /></div></div><strong>{services.filter(s => s.enabled).length}</strong></div>
            </div>
            <div className="tv-home-grid">
              <section className="tv-panel tv-service-panel tv-rise"><div className="tv-panel-heading"><div><h2>Start a request</h2></div><button className="tv-text-btn" onClick={() => goTo("Services")}>All services <ArrowRight size={14} /></button></div><div className="tv-service-grid">{services.filter(s => s.enabled).slice(0, 4).map(service => { const Icon = serviceIcon(service.id); return <button className="tv-service-card" key={service.id} onClick={() => openService(service)}><div className="tv-service-top"><span className="tv-service-icon"><Icon size={20} /></span><ArrowRight size={15} /></div><strong>{service.name}</strong><p>{service.description}</p><div className="tv-service-bottom"><span>{service.category}</span><span className="tv-service-action">Select <ArrowRight size={13} /></span></div></button>; })}</div></section>
              <section className="tv-panel tv-wallet-panel tv-rise"><div className="tv-panel-heading"><div><h2>Wallet</h2></div><span className="tv-wallet-mark"><Wallet size={19} /></span></div><span className="tv-balance-label">AVAILABLE BALANCE</span><strong className="tv-wallet-amount"><CountUp kobo={balanceKobo} /></strong><div className="tv-wallet-footer"><span><i /> NGN</span><button onClick={() => goTo("My wallet")}>Fund <ArrowRight size={14} /></button></div></section>
              <section className="tv-panel tv-history-panel tv-rise"><div className="tv-panel-heading"><div><h2>Recent requests</h2></div><button className="tv-text-btn" onClick={() => goTo("Request history")}>View all <ArrowRight size={14} /></button></div><RequestTable history={history.slice(0, 6)} services={services} /></section>
            </div>
          </>}

          {section === "Services" && <>
            <div className="tv-page-heading"><div><h1>Services</h1></div></div>
            <section className="tv-output-picker">
              <div className="tv-output-grid">
                {formatCards.map((card, i) => (
                  <button key={card.id} className="tv-output-option tv-rise" style={{ animationDelay: `${i * 0.07}s` }} onClick={() => { const service = services.find(s => s.id === card.id && s.enabled); if (service) openService(service); else flash(`${card.title} is not available right now.`, true); }}>
                    <ServicePreview serviceId={card.id} compact />
                    <span className="tv-output-tag">{card.tag}</span>
                    <strong>{card.title}</strong>
                    <span className="tv-output-action">Open <ArrowRight size={14} /></span>
                  </button>
                ))}
              </div>
            </section>
            <div className="tv-searchbar"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search services" aria-label="Search services" /></div>
            <div className="tv-catalog-grid">{filteredServices.map((service, i) => { const Icon = serviceIcon(service.id); return <button className="tv-service-card tv-service-card-large tv-rise" style={{ animationDelay: `${Math.min(i, 8) * 0.05}s` }} key={service.id} onClick={() => openService(service)}><ServicePreview serviceId={service.id} compact /><div className="tv-service-top"><span className="tv-service-icon"><Icon size={20} /></span><ArrowRight size={15} /></div><strong>{service.name}</strong><p>{service.description}</p><div className="tv-service-bottom"><span>{service.category}</span><span className="tv-service-action">Open <ArrowRight size={13} /></span></div></button>; })}</div>
          </>}

          {section === "Request history" && <>
            <div className="tv-page-heading"><div><h1>Request history</h1></div><button className="tv-button-primary" onClick={() => goTo("Services")}><FileCheck2 size={16} /> New request</button></div>
            <section className="tv-panel tv-history-panel"><RequestTable history={history} services={services} /></section>
          </>}

          {section === "My wallet" && <>
            <div className="tv-page-heading"><div><h1>Wallet</h1></div></div>
            <div className="tv-wallet-page-grid">
              <section className="tv-wallet-hero"><span><Wallet size={16} /> AVAILABLE BALANCE</span><strong><CountUp kobo={balanceKobo} /></strong><p>Nigerian naira</p><div className="tv-wallet-hero-actions"><button type="button" className="tv-hero-fund" disabled={fundingLoading} onClick={() => setShowFundForm(true)}>Fund wallet <ArrowRight size={16} /></button><button type="button" className="tv-hero-check" disabled={reconcileLoading} onClick={() => void checkPayments()}><RefreshCw size={15} className={reconcileLoading ? "tv-spin" : ""} /> Check payment</button></div></section>
              {verifyPanel}
              {depositAccount && <section className="tv-panel tv-fund-panel tv-rise"><div className="tv-panel-heading"><div><h2>Deposit account</h2></div><span className="tv-table-status tv-table-success">Active</span></div><div className="tv-account-details"><div><span>BANK</span><strong>{depositAccount.bank_name}</strong></div><div><span>ACCOUNT NUMBER</span><strong>{depositAccount.account_number}</strong><button type="button" className="tv-text-btn" onClick={() => { void navigator.clipboard.writeText(depositAccount.account_number); flash("Account number copied."); }}><Copy size={14} /> Copy</button></div><div><span>ACCOUNT NAME</span><strong>{profile?.full_name || "Your name"}</strong></div></div></section>}
              {showFundForm && <section className="tv-panel tv-fund-panel tv-rise"><div className="tv-panel-heading"><div><h2>Pay with card or transfer</h2></div><button type="button" className="tv-text-btn" onClick={() => { setShowFundForm(false); setFundAmount(""); }}>Cancel</button></div><div className="tv-hosted-payment"><label className="tv-field"><span className="tv-field-label">Amount (NGN)</span><input value={fundAmount} onChange={e => setFundAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Minimum 500" /></label><div className="tv-quick-amounts">{["500", "2000", "5000", "10000", "20000"].map(n => <button type="button" key={n} className={fundAmount === n ? "tv-quick-active" : ""} onClick={() => setFundAmount(n)}>{money(Number(n) * 100)}</button>)}</div><div className="tv-funding-actions"><button type="button" className="tv-button-primary" disabled={fundingLoading} onClick={fundWallet}>{fundingLoading && <span className="tv-button-spinner" aria-hidden="true" />}{fundingLoading ? "Opening checkout" : "Continue"} {!fundingLoading && <ArrowRight size={15} />}</button></div></div></section>}
            </div>
            <section className="tv-panel tv-history-panel"><div className="tv-panel-heading"><div><h2>Ledger</h2></div></div><LedgerTable userId={user.id} /></section>
            <section className="tv-panel tv-history-panel"><div className="tv-panel-heading"><div><h2>Top-ups</h2></div></div><FundingTable userId={user.id} /></section>
          </>}

          {section === "Admin" && isAdmin && <AdminConsole currentUserId={user.id} onRefreshServices={() => void refreshData(user.id)} onNotice={flash} />}
        </div>
        <footer className="tv-footer"><span>© {new Date().getFullYear()} TopVerify</span>{supportEmail && <a className="tv-footer-support" href={`mailto:${supportEmail}`}>Support</a>}</footer>
      </div>
    </section>
    <nav className="tv-bottom-nav" aria-label="Primary" style={{ gridTemplateColumns: `repeat(${navItems.length}, 1fr)` }}>{navItems.map(item => <button key={item.label} className={section === item.label ? "tv-bottom-item tv-bottom-active" : "tv-bottom-item"} aria-current={section === item.label ? "page" : undefined} onClick={() => goTo(item.label)}><item.icon size={21} /><span>{shortLabel(item.label)}</span></button>)}</nav>
    {selected && <ServiceRequestModal key={selected.id} service={selected} Icon={serviceIcon(selected.id)} isApproved={isApproved} balanceKobo={balanceKobo} onClose={() => setSelected(null)} onFinished={() => void refreshData(user.id)} onFundWallet={() => { goTo("My wallet"); setShowFundForm(true); }} onVerifyNin={() => goTo("My wallet")} />}
    {dialog}
  </main>;
}

function RequestTable({ history, services }: { history: RequestRow[]; services: Service[] }) {
  if (!history.length) return <div className="tv-empty"><div><Clock3 size={21}/></div><strong>No requests yet</strong><span>Your completed and failed requests will appear here.</span></div>;
  return <div className="tv-table-scroll"><table className="tv-table"><thead><tr><th>SERVICE</th><th>REFERENCE</th><th>DATE</th><th>FEE</th><th>STATUS</th></tr></thead><tbody>{history.map(row=><tr key={row.id}><td data-label="SERVICE"><strong>{services.find(s=>s.id===row.service_id)?.name || row.service_id}</strong></td><td className="tv-ref" data-label="REFERENCE">{row.request_reference}{row.provider_reference && row.provider_reference !== row.request_reference ? <small>{row.provider_reference}</small> : null}</td><td data-label="DATE">{dateText(row.created_at)}</td><td data-label="FEE">{money(row.fee_kobo)}</td><td data-label="STATUS"><span className={row.status==="completed"?"tv-table-status tv-table-success":row.status==="failed"||row.status==="refunded"?"tv-table-status tv-table-failed":"tv-table-status tv-table-pending"}>{row.status}</span></td></tr>)}</tbody></table></div>;
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
  return <div className="tv-table-scroll"><table className="tv-table"><thead><tr><th>TYPE</th><th>REFERENCE</th><th>DESCRIPTION</th><th>DATE</th><th>AMOUNT</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td data-label="TYPE" style={{textTransform:"capitalize"}}>{row.entry_type}</td><td className="tv-ref" data-label="REFERENCE">{row.reference}</td><td data-label="DETAILS">{row.description}</td><td data-label="DATE">{dateText(row.created_at)}</td><td data-label="AMOUNT" className={row.entry_type==="debit" ? "tv-amount-debit" : "tv-amount-credit"}>{row.entry_type==="debit" ? "−" : "+"}{money(row.amount_kobo)}</td></tr>)}</tbody></table></div>;
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
      } catch {}
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
  return <div className="tv-table-scroll"><table className="tv-table"><thead><tr><th>REFERENCE</th><th>DATE</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td className="tv-ref" data-label="REFERENCE">{row.tx_ref}</td><td data-label="DATE">{dateText(row.created_at)}</td><td data-label="AMOUNT">{money(row.amount_kobo)}</td><td data-label="STATUS"><span className={row.status==="credited"?"tv-table-status tv-table-success":row.status==="failed"?"tv-table-status tv-table-failed":"tv-table-status tv-table-pending"}>{row.status==="credited"?"Credited":row.status==="failed"?"Failed":"Pending"}</span></td></tr>)}</tbody></table></div>;
}
