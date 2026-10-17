"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StateIcon, VerifyShell } from "@/components/VerifyShell";

type View = "checking" | "form" | "success" | "expired";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<View>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => { if (active) setView(data.user ? "form" : "expired"); });
    return () => { active = false; };
  }, [supabase]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(/same/i.test(updateError.message) ? "Choose a password you have not used before." : "Could not update your password. Request a new link and try again.");
      setSaving(false);
      return;
    }
    await supabase.auth.signOut();
    setView("success");
    setSaving(false);
  }

  return (
    <VerifyShell>
      {view === "checking" && <><StateIcon state="loading" /><div className="tv-verify-body"><h1>One moment</h1></div></>}
      {view === "expired" && (
        <>
          <StateIcon state="error" />
          <div className="tv-verify-body tv-verify-in">
            <h1>Reset link expired</h1>
            <p>This reset session is no longer active. Request a new link to continue.</p>
            <a className="tv-verify-btn" href="/?auth=forgot">Request a new link <ArrowRight size={18} /></a>
            <a className="tv-verify-link" href="/?auth=signin">Back to login</a>
          </div>
        </>
      )}
      {view === "form" && (
        <div className="tv-verify-body tv-verify-in">
          <div className="tv-verify-lock"><LockKeyhole size={28} /></div>
          <h1>Choose a new password</h1>
          <form className="tv-verify-form" onSubmit={submit}>
            <input type="password" required minLength={8} autoComplete="new-password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)} aria-label="New password" />
            <input type="password" required minLength={8} autoComplete="new-password" placeholder="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)} aria-label="Confirm password" />
            {error && <div className="tv-verify-error" role="alert">{error}</div>}
            <button className="tv-verify-btn" type="submit" disabled={saving}>{saving ? "Saving" : "Save password"}</button>
          </form>
        </div>
      )}
      {view === "success" && (
        <>
          <StateIcon state="success" />
          <div className="tv-verify-body tv-verify-in">
            <h1>Password updated</h1>
            <p>Sign in with your new password.</p>
            <a className="tv-verify-btn" href="/?auth=signin">Continue to login <ArrowRight size={18} /></a>
          </div>
        </>
      )}
    </VerifyShell>
  );
}
