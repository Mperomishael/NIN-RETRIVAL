import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function retired() {
  return NextResponse.json(
    { error: "The legacy hot/cold treasury endpoint has been retired. Use Flutterwave merchant settlement and TopVerify customer wallet funding." },
    { status: 410 }
  );
}

export async function GET() { return retired(); }
export async function POST() { return retired(); }
