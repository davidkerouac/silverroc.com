import { type User } from "@supabase/supabase-js";
import { HttpError } from "./errors";
import { getSupabaseAdmin } from "./supabase";

export type MembershipState = {
  isPaid: boolean;
  tier: "free" | "member";
  expiresAt: string | null;
  source: string | null;
};

const membershipDays = Number(process.env.MEMBERSHIP_DAYS || 30);

export async function getMembershipState(userId: string): Promise<MembershipState> {
  const { data, error } = await getSupabaseAdmin()
    .from("memberships")
    .select("tier,status,current_period_end,source")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new HttpError(500, `Failed to load membership: ${error.message}`);

  const expiresAt = data?.current_period_end || null;
  const isPaid =
    data?.status === "active" &&
    Boolean(expiresAt) &&
    new Date(expiresAt as string).getTime() > Date.now();

  return {
    isPaid,
    tier: isPaid ? "member" : "free",
    expiresAt: isPaid ? (expiresAt as string) : null,
    source: (data?.source as string | null) || null
  };
}

export async function grantMembership(userId: string, source: string) {
  const existing = await getMembershipState(userId);
  const now = new Date();
  const base =
    existing.expiresAt && new Date(existing.expiresAt).getTime() > now.getTime()
      ? new Date(existing.expiresAt)
      : now;
  const nextEnd = new Date(base.getTime() + membershipDays * 24 * 60 * 60 * 1000);

  const { error } = await getSupabaseAdmin()
    .from("memberships")
    .upsert(
      {
        user_id: userId,
        tier: "member",
        status: "active",
        current_period_end: nextEnd.toISOString(),
        source,
        updated_at: now.toISOString()
      },
      { onConflict: "user_id" }
    );

  if (error) throw new HttpError(500, `Failed to grant membership: ${error.message}`);
  return getMembershipState(userId);
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email || "",
    name: (user.user_metadata?.name as string | undefined) || ""
  };
}
