"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { StateIcon, VerifyShell, type VerifyState } from "@/components/VerifyShell";

const copy: Record<string, { title: string; text: string; cta: string; to: string; seconds: number }> = {
  email: { title: "Email verified", text: "Your account is ready. Sign in to start using TopVerify.", cta: "Continue to login", to: "/?auth=signin", seconds: 6 },
  signup: { title: "Email verified", text: "Your account is ready. Sign in to start using TopVerify.", cta: "Continue to login", to: "/?auth=signin", seconds: 6 },
  magiclink: { title: "You are verified", text: "Your sign-in link is confirmed.", cta: "Continue to login", to: "/?auth=signin", seconds: 6 },
  email_change: { title: "Email updated", text: "Your new email address is confirmed.", cta: "Go to login", to: "/?auth=signin", seconds: 6 },
  invite: { title: "Invitation accepted", text: "Your invitation is confirmed.", cta: "Continue to login", to: "/?auth=signin", seconds: 6 },
  recovery: { title: "Link verified", text: "Choose a new password for your account.", cta: "Set new password", to: "/auth/reset", seconds: 3 },
};

const errors: Record<string, { title: string; text: string }> = {
  expired: { title: "This link has expired", text: "Verification links only work for a limited time. Request a new one below." },
  invalid: { title: "This link can't be used", text: "It may already have been used. If you have already verified your email, just sign in." },
  rate_limited: { title: "Too many attempts", text: "Please wait a few minutes and try again." },
  unavailable: { title: "Something went wrong", text: "We could not reach the server. Please try again in a moment." },
};

export function VerifiedView({ tokenHash, type }: { tokenHash?: string; type?: string }) {
  const [state, setState] = useState<VerifyState>("loading");
  const [reason, setReason] = useState("invalid");
  const [left, setLeft] = useState(0);
  const [resendOpen, setResendOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendError, setResendError] = useState("");
  const ran = useRef(false);
  const info = copy[type ?? ""] ?? copy.email;
  const isRecovery = type === "recovery";

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    window.history.replaceState({}, "", "/auth/verified");
    if (!tokenHash || !type) { setReason("invalid"); setState("error"); return; }
    const started = Date.now();
    const settle = (next: VerifyState, why = "invalid") => {
      setTimeout(() => { setReason(why); setState(next); }, Math.max(0, 1200 - (Date.now() - started)));
    };
    fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token_hash: tokenHash, type }) })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.ok && body.ok) settle("success"); else settle("error", body.reason || "invalid");
      })
      .catch(() => settle("error", "unavailable"));
  }, [tokenHash, type]);

  useEffect(() => {
    if (state !== "success") return;
    setLeft(info.seconds);
    const timer = setInterval(() => setLeft(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [state, info.seconds]);

  useEffect(() => {
    if (state === "success" && left === 0 && info.seconds > 0) {
      const t = setTimeout(() => { window.location.href = info.to; }, 250);
      return () => clearTimeout(t);
    }
  }, [state, left, info.to, info.seconds]);

  async function resend(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setResendError("");
    try {
      const response = await fetch("/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not send the email.");
      setSent(true);
    } catch (error) {
      setResendError(error instanceof Error ? error.message : "Could not send the email.");
    } finally { setSending(false); }
  }

  const failure = errors[reason] ?? errors.invalid;

  return (
    <VerifyShell>
      <StateIcon state={state} />
      {state === "loading" && <div className="tv-verify-body"><h1>Verifying</h1><p>One moment while we confirm your link.</p></div>}

      {state === "success" && (
        <div className="tv-verify-body tv-verify-in">
          <h1>{info.title}</h1>
          <p>{info.text}</p>
          <a className="tv-verify-btn" href={info.to}>{info.cta} <ArrowRight size={18} /></a>
          {info.seconds > 0 && <>
            <div className="tv-verify-progress" aria-hidden="true"><span style={{ animationDuration: `${info.seconds}s` }} /></div>
            <small>Redirecting in {left}s</small>
          </>}
        </div>
      )}

      {state === "error" && (
        <div className="tv-verify-body tv-verify-in">
          <h1>{failure.title}</h1>
          <p>{failure.text}</p>
          {isRecovery ? (
            <a className="tv-verify-btn" href="/?auth=forgot">Request a new reset link <ArrowRight size={18} /></a>
          ) : sent ? (
            <div className="tv-verify-note"><Mail size={18} /><span>If that address has an unverified account, a new link is on its way.</span></div>
          ) : resendOpen ? (
            <form className="tv-verify-form" onSubmit={resend}>
              <input type="email" required autoFocus autoComplete="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email address" />
              {resendError && <div className="tv-verify-error" role="alert">{resendError}</div>}
              <button className="tv-verify-btn" type="submit" disabled={sending}>{sending ? "Sending" : "Send new link"}</button>
            </form>
          ) : (
            <button className="tv-verify-btn" type="button" onClick={() => setResendOpen(true)}><Mail size={18} /> Resend verification email</button>
          )}
          <a className="tv-verify-link" href="/?auth=signin">Back to login</a>
        </div>
      )}
    </VerifyShell>
  );
}
