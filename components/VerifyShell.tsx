import type { ReactNode } from "react";

export type VerifyState = "loading" | "success" | "error";

const burst = Array.from({ length: 12 }, (_, i) => i);

export function VerifyShell({ children }: { children: ReactNode }) {
  return (
    <main className="tv-verify">
      <div className="tv-verify-card">
        <div className="tv-verify-brand"><img src="/brand/logo-mark.png" alt="" width={36} height={36} /><span>TopVerify</span></div>
        {children}
      </div>
    </main>
  );
}

export function StateIcon({ state }: { state: VerifyState }) {
  if (state === "loading") {
    return <div className="tv-verify-icon" aria-hidden="true"><div className="vi-spinner" /><div className="vi-core" /></div>;
  }
  const ok = state === "success";
  return (
    <div className={ok ? "tv-verify-icon vi-ok" : "tv-verify-icon vi-bad"} aria-hidden="true">
      {ok && <><span className="vi-pulse" /><span className="vi-pulse vi-pulse-2" />{burst.map(i => <span key={i} className="vi-dot" style={{ ["--a" as string]: `${i * 30}deg`, ["--c" as string]: i % 3 === 0 ? "#34d399" : i % 3 === 1 ? "#5b86ff" : "#fbbf24" }} />)}</>}
      <svg viewBox="0 0 112 112">
        <circle className="vi-fill" cx="56" cy="56" r="45" />
        <circle className="vi-ring" cx="56" cy="56" r="50" />
        {ok
          ? <path className="vi-mark" d="M36 58l14 14 27-30" />
          : <><path className="vi-mark" d="M42 42l28 28" /><path className="vi-mark vi-mark-2" d="M70 42L42 70" /></>}
      </svg>
    </div>
  );
}
