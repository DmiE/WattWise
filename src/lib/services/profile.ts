import type { createClient } from "@/lib/supabase";
import type { Profile, ProfileInsert, ProfileUpdate } from "@/types";
import type { ProfileEditInput } from "@/lib/profile-edit-schema";

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

/**
 * Update only the six FR-010-editable columns for the caller's own row, scoped
 * by `user_id` under RLS. Touches none of the equipment/FTP/fitness-level/max-HR
 * columns, so the cross-field CHECK constraints can't be violated regardless of
 * the row's equipment branch — no server-side derivation needed (unlike
 * `upsertProfile`, which rebuilds the full row).
 */
export async function updateProfileFields(
  supabase: SupabaseClient,
  userId: string,
  fields: ProfileEditInput,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("profiles").update(fields).eq("user_id", userId);
  return { error: error ? { message: error.message } : null };
}

/**
 * Persist the renewal field subset for the caller's own row under RLS. The
 * column set differs from `updateProfileFields` (FR-010): it omits age/weight
 * and may include the FTP trio (`ftp_watts` / `ftp_source` / `fitness_level`)
 * for power-meter users. The `update` object is built server-side by
 * `applyRenewal`, so the equipment/FTP trust boundary stays in app code and the
 * cross-field CHECK constraints can't be violated.
 */
export async function updateProfileForRenewal(
  supabase: SupabaseClient,
  userId: string,
  update: Partial<ProfileUpdate>,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("profiles").update(update).eq("user_id", userId);
  return { error: error ? { message: error.message } : null };
}
