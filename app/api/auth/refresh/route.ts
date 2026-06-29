import { NextResponse } from "next/server";
import { HttpError, jsonError } from "../../../../lib/errors";
import { getMembershipState, publicUser } from "../../../../lib/membership";
import { ensureProfile, getSupabaseAuthClient } from "../../../../lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const refreshToken = String(body.refreshToken || "");
    if (!refreshToken) throw new HttpError(400, "Missing refresh token");

    const { data, error } = await getSupabaseAuthClient().auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data.session || !data.user) {
      throw new HttpError(401, "登录已过期，请重新登录");
    }

    await ensureProfile(data.user);
    const membership = await getMembershipState(data.user.id);

    return NextResponse.json({
      ok: true,
      user: publicUser(data.user),
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at || null
      },
      membership
    });
  } catch (error) {
    return jsonError(error);
  }
}
