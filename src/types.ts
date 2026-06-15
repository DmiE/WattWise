import type { Database } from "@/db/database.types";
import type { SessionStructure } from "@/lib/plan-schema";

export type { Database };

// Onboarding wizard input DTO (pre server-side derivation). Defined alongside
// the shared zod schema in `@/lib/onboarding-schema`.
export type { OnboardingInput } from "@/lib/onboarding-schema";

// Session-status mutation DTO (done/skipped/pending), validated server-side in
// `POST /api/sessions/[id]`. Defined alongside its zod schema.
export type { SessionStatusUpdate } from "@/lib/session-schema";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

export type Plan = Database["public"]["Tables"]["plans"]["Row"];
export type PlanInsert = Database["public"]["Tables"]["plans"]["Insert"];
export type PlanUpdate = Database["public"]["Tables"]["plans"]["Update"];

export type PlanSession = Database["public"]["Tables"]["plan_sessions"]["Row"];
export type PlanSessionInsert = Database["public"]["Tables"]["plan_sessions"]["Insert"];
export type PlanSessionUpdate = Database["public"]["Tables"]["plan_sessions"]["Update"];

// View types for the dashboard plan island. The DB types `structure` only as
// `Json`; these narrow it to the validated segment shape defined in
// `plan-schema.ts` (every persisted plan passed `validateGeneratedPlan`, so the
// narrowing is sound at the render boundary).
export type { PlanSegment, PlanTarget, SessionStructure } from "@/lib/plan-schema";

/** A `plan_sessions` row with `structure` narrowed to the segment union. */
export type PlanSessionView = Omit<PlanSession, "structure"> & { structure: SessionStructure };

/**
 * A session view plus its embedded log (`session_logs` is 1:1 with
 * `plan_sessions` — the FK is also the PK — so PostgREST returns the embed as a
 * single object or `null`, never an array). `null` when the session was never
 * logged (pending/skipped, or a done session before its log loads).
 */
export type PlanSessionWithLog = PlanSessionView & { log: SessionLog | null };

/** A plan plus its sessions (ordered by day_index), narrowed for rendering. */
export interface PlanWithSessions {
  plan: Plan;
  sessions: PlanSessionWithLog[];
}

export type SessionLog = Database["public"]["Tables"]["session_logs"]["Row"];
export type SessionLogInsert = Database["public"]["Tables"]["session_logs"]["Insert"];
export type SessionLogUpdate = Database["public"]["Tables"]["session_logs"]["Update"];

export type EquipmentType = Database["public"]["Enums"]["equipment_type"];
export type TrainingGoal = Database["public"]["Enums"]["training_goal"];
export type FitnessLevel = Database["public"]["Enums"]["fitness_level"];
export type FtpSource = Database["public"]["Enums"]["ftp_source"];
export type PlanStatus = Database["public"]["Enums"]["plan_status"];
export type SessionStatus = Database["public"]["Enums"]["session_status"];
export type SessionType = Database["public"]["Enums"]["session_type"];
