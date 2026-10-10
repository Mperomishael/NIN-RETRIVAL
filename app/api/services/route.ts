import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ services: [], error: "Service catalogue is temporarily unavailable." }, { status: 503 });
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin
    .from("services")
    .select("id,name,description,category,price_kobo,enabled")
    .eq("enabled", true)
    .order("category")
    .order("name");
  if (error) return NextResponse.json({ services: [], error: "Service catalogue is temporarily unavailable." }, { status: 503 });
  return NextResponse.json(
    { services: data ?? [] },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
