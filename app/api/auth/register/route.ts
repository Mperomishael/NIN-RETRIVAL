import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/server/admin";
import { approveProfileIfPending, provisionVirtualAccount } from "@/lib/payments/virtual-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const attempts = new Map<string, number[]>();
function rateLimited(key: string) {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter(t => now - t < 10 * 60 * 1000);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > 6;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = text(body.email, 200).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = text(body.fullName, 120);
  const phone = text(body.phone, 30);
  const businessName = text(body.businessName, 160);
  const businessAddress = text(body.businessAddress, 300);
  const intendedUse = text(body.intendedUse, 160);
  const nin = text(body.nin, 20).replace(/\s/g, "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  if (fullName.length < 2) return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  if (!/^\d{11}$/.test(nin)) return NextResponse.json({ error: "Enter a valid 11-digit NIN." }, { status: 400 });
  if (body.acceptedTerms !== true) return NextResponse.json({ error: "Accept the acceptable-use terms to continue." }, { status: 400 });
  if (body.ninConsent !== true) return NextResponse.json({ error: "Consent is required to verify your NIN." }, { status: 400 });

  let admin: ReturnType<typeof serviceClient>;
  try { admin = serviceClient(); } catch {
    return NextResponse.json({ error: "Registration is temporarily unavailable." }, { status: 503 });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName, phone, business_name: businessName, business_address: businessAddress,
      intended_use: intendedUse, terms_accepted_at: new Date().toISOString(), terms_version: "topverify-acceptable-use-v1",
    },
  });
  if (createError || !created.user) {
    const exists = /already|registered|exists/i.test(createError?.message ?? "");
    return NextResponse.json(
      { error: exists ? "An account with this email already exists. Sign in instead." : "We could not create your account. Please try again." },
      { status: exists ? 409 : 400 }
    );
  }
  const userId = created.user.id;

  const result = await provisionVirtualAccount(admin, { id: userId, email }, { full_name: fullName, phone }, nin);
  if (!result.ok) {
    await admin.from("virtual_accounts").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await approveProfileIfPending(admin, userId);
  return NextResponse.json({ ok: true });
}
