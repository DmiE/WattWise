import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { onboardingInputSchema } from "@/lib/onboarding-schema";
import { toProfileInsert } from "@/lib/onboarding";
import { upsertProfile } from "@/lib/services/profile";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const POST: APIRoute = async (context) => {
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

  const result = onboardingInputSchema.safeParse(raw);
  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    return json({ error: "Validation failed", fieldErrors }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 500);
  }

  // Derive authoritative FTP / ftp_source / fitness_level / max_hr server-side
  // so a tampered body can never violate the profiles CHECK constraints.
  const insert = toProfileInsert(result.data, user.id);
  const { error } = await upsertProfile(supabase, insert);
  if (error) {
    // Generic message — don't leak constraint names to the client.
    return json({ error: "Could not save your profile. Please try again." }, 500);
  }

  return json({ ok: true }, 200);
};
