import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { profileEditSchema } from "@/lib/profile-edit-schema";
import { updateProfileFields } from "@/lib/services/profile";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Not authenticated" }, 401);
  }

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const result = profileEditSchema.safeParse(raw);
  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    return json({ error: "Validation failed", fieldErrors }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 500);
  }

  // Only the six editable columns are updated — equipment/FTP/fitness-level/
  // max-HR are untouched (renewal-only). No derivation needed.
  const { error } = await updateProfileFields(supabase, user.id, result.data);
  if (error) {
    // Generic message — don't leak constraint names to the client.
    return json({ error: "Could not save your profile. Please try again." }, 500);
  }

  return json({ ok: true }, 200);
};
