import type { createClient } from "@/lib/supabase";
import type { Profile, ProfileInsert } from "@/types";

// Thin profile data-access layer shared by the onboarding API route (writes)
// and middleware gating (reads). All calls go through the caller's SSR client
// so Supabase RLS applies under their session — never a service-role client.

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** Fetch the caller's own profile, or null when they haven't onboarded yet. */
export async function getProfile(supabase: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  // maybeSingle returns {data:null,error:null} for an absent row; a non-null
  // error means the read actually failed — propagate so callers can fail open.
  if (error) {
    throw new Error(`getProfile failed: ${error.message}`);
  }
  return data ?? null;
}

/**
 * Upsert a profile on its `user_id` primary key. Idempotent against double
 * submits and concurrent tabs (PK conflict → update, not duplicate-key error).
 */
export async function upsertProfile(
  supabase: SupabaseClient,
  insert: ProfileInsert,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("profiles").upsert(insert, { onConflict: "user_id" });
  return { error: error ? { message: error.message } : null };
}
