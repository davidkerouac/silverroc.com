import { NextResponse } from "next/server";
import { HttpError, jsonError } from "../../../../lib/errors";
import { getMembershipState, publicUser } from "../../../../lib/membership";
import { ensureProfile, getSupabaseAdmin, getSupabaseAuthClient } from "../../../../lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();

    if (!email || !email.includes("@")) throw new HttpError(400, "请输入有效邮箱");
    if (password.length < 6) throw new HttpError(400, "密码至少 6 位");

    const auth = getSupabaseAuthClient();
    let signIn = await auth.auth.signInWithPassword({ email, password });

    if (signIn.error) {
      const create = await getSupabaseAdmin().auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: name ? { name } : undefined
      });

      if (create.error && !/already|registered|exists/i.test(create.error.message)) {
        throw new HttpError(500, `注册失败：${create.error.message}`);
      }

      signIn = await auth.auth.signInWithPassword({ email, password });
    }

    if (signIn.error || !signIn.data.session || !signIn.data.user) {
      throw new HttpError(401, "邮箱或密码不对");
    }

    if (name) {
      await getSupabaseAdmin().auth.admin.updateUserById(signIn.data.user.id, {
        user_metadata: { name }
      });
      signIn.data.user.user_metadata = { ...signIn.data.user.user_metadata, name };
    }

    await ensureProfile(signIn.data.user, name);
    const membership = await getMembershipState(signIn.data.user.id);

    return NextResponse.json({
      ok: true,
      user: publicUser(signIn.data.user),
      session: {
        accessToken: signIn.data.session.access_token,
        refreshToken: signIn.data.session.refresh_token,
        expiresAt: signIn.data.session.expires_at || null
      },
      membership
    });
  } catch (error) {
    return jsonError(error);
  }
}
