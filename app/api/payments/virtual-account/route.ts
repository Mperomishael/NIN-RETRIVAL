import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/server/admin";
import { approveProfileIfPending, provisionVirtualAccount } from "@/lib/payments/virtual-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedInUser() {
  const server = await createSupabaseServerClient();
  const { data, error } = await server.auth.getUser();
  return error || !data.user ? null : data.user;
}

export async function GET() {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Sign in to view your deposit account." }, { status: 401 });
  try {
    const admin = serviceClient();
    const { data, error } = await admin.from("virtual_accounts")
      .select("account_number,bank_name,status,created_at").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (data?.status === "active") await approveProfileIfPending(admin, user.id);
    return NextResponse.json({ account: data ?? null }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Unable to load your deposit account." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await signedInUser();
  if (!user || !user.email) return NextResponse.json({ error: "Sign in to verify your NIN." }, { status: 401 });

  let body: { nin?: unknown; consent?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const nin = typeof body.nin === "string" ? body.nin.replace(/\s/g, "") : "";
  if (!/^\d{11}$/.test(nin)) return NextResponse.json({ error: "Enter a valid 11-digit NIN." }, { status: 400 });
  if (body.consent !== true) return NextResponse.json({ error: "Consent is required to verify your NIN." }, { status: 400 });

  let admin: ReturnType<typeof serviceClient>;
  try { admin = serviceClient(); } catch {
    return NextResponse.json({ error: "Service is not configured." }, { status: 503 });
  }
  const { data: profile } = await admin.from("profiles").select("full_name,phone,status").eq("id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Your profile could not be loaded." }, { status: 409 });

  const result = await provisionVirtualAccount(admin, { id: user.id, email: user.email }, profile, nin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const approved = await approveProfileIfPending(admin, user.id);
  return NextResponse.json({ account: result.account, alreadyExists: result.alreadyExists ?? false, approved: approved || profile.status === "approved" });
}
