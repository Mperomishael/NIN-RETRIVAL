import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const types = ["email", "signup", "recovery", "invite", "magiclink", "email_change"] as const;
type VerifyType = (typeof types)[number];

const hits = new Map<string, number[]>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  if (recent.length > 30) return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });

  let body: { token_hash?: unknown; type?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 }); }
  const tokenHash = typeof body.token_hash === "string" ? body.token_hash : "";
  const type = body.type as VerifyType;
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(tokenHash) || !types.includes(type)) {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  try {
    const client = type === "recovery"
      ? await createServerClient()
      : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      const expired = error.code === "otp_expired" || /expired/i.test(error.message);
      return NextResponse.json({ ok: false, reason: expired ? "expired" : "invalid" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ok: true, type }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 });
  }
}
