import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "silverroc-once-mountain",
    time: new Date().toISOString()
  });
}
