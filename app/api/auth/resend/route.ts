import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hits = new Map<string, number[]>();
function limited(key: string, max: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  let body: { email?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (limited(`ip:${ip}`, 8) || limited(`email:${email}`, 3)) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes and try again." }, { status: 429 });
  }
  try {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.auth.resend({ type: "signup", email });
    if (error) console.error("[TopVerify resend] Failed", { reason: error.message.slice(0, 160) });
  } catch (error) {
    console.error("[TopVerify resend] Failed", { reason: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
  }
  return NextResponse.json({ ok: true });
}
