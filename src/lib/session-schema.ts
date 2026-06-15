import { z } from "zod";

// Server-side trust boundary for the session-status mutation body
// (`POST /api/sessions/[id]`). Discriminated on `status`: the log is required
// and range-checked ONLY on `done`; `skipped` and `pending` carry no log.
//
// The integer ranges mirror the `session_logs` CHECK constraints in
// `supabase/migrations/20260602182721_init_mvp_schema.sql:233-235` exactly
// (actual_duration_min 1–600, rating 1–5) — the DB is the source of truth.
//
// `km_ridden` is `numeric(5,2)`, so it is rounded to 2 decimals BEFORE the
// `> 0 && < 500` refine: this makes the zod boundary match what the column will
// actually store. Without it, 499.999 passes a naive `< 500` but rounds to
// 500.00 at the column (CHECK violation → generic 500), and 0.004 rounds to
// 0.00 likewise. Rounding first turns both edges into clean 400s.
const logSchema = z.object({
  actual_duration_min: z.number().int().min(1).max(600),
  rating: z.number().int().min(1).max(5),
  km_ridden: z
    .number()
    .transform((n) => Math.round(n * 100) / 100)
    .refine((n) => n > 0 && n < 500, { message: "km_ridden must be greater than 0 and less than 500" }),
});

export const sessionStatusUpdateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("done"), log: logSchema }),
  z.object({ status: z.literal("skipped") }),
  z.object({ status: z.literal("pending") }),
]);

export type SessionStatusUpdate = z.infer<typeof sessionStatusUpdateSchema>;
