import { NextResponse } from "next/server";
import { jsonError } from "../../../lib/errors";
import { getMembershipState, publicUser } from "../../../lib/membership";
import { ensureProfile, requireSupabaseUser } from "../../../lib/supabase";

export async function GET(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    await ensureProfile(user);
    const membership = await getMembershipState(user.id);

    return NextResponse.json({
      ok: true,
      user: publicUser(user),
      membership
    });
  } catch (error) {
    return jsonError(error);
  }
}
