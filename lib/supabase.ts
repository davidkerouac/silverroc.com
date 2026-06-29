import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getBearerToken, HttpError, requiredEnv } from "./errors";

let adminClient: SupabaseClient | null = null;
let authClient: SupabaseClient | null = null;

export function getSupabaseAdmin() {
  if (!adminClient) {
    adminClient = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }
  return adminClient;
}

export function getSupabaseAuthClient() {
  if (!authClient) {
    authClient = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }
  return authClient;
}

export async function requireSupabaseUser(request: Request) {
  const token = getBearerToken(request);
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);

  if (error || !data.user) {
    throw new HttpError(401, "Invalid or expired auth token");
  }

  return { user: data.user, token };
}

export async function ensureProfile(user: User, name?: string) {
  const email = user.email?.toLowerCase();
  if (!email) throw new HttpError(400, "Supabase user has no email");

  const profile = {
    user_id: user.id,
    email,
    name: name || (user.user_metadata?.name as string | undefined) || null,
    updated_at: new Date().toISOString()
  };

  const { error } = await getSupabaseAdmin()
    .from("profiles")
    .upsert(profile, { onConflict: "user_id" });

  if (error) throw new HttpError(500, `Failed to save profile: ${error.message}`);
  return profile;
}
