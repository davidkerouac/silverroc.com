import { NextResponse } from "next/server";
import { getAntomPriceConfig } from "../../../lib/antom";

export async function GET() {
  return NextResponse.json({
    ok: true,
    membership: {
      price: getAntomPriceConfig()
    }
  });
}
