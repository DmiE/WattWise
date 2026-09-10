---
change_id: onboarding-repost-guard
title: Guard POST /api/onboarding against re-POST by an onboarded user
status: implemented
created: 2026-09-10
updated: 2026-09-10
archived_at: null
---

## Notes

Closes **B3**, the one finding from `testing-equipment-mapping-parity` with a
security dimension. Recorded in `context/foundation/test-plan.md` §7 and owned
by §3 Phase 2's Risks-covered cell.

**B3 answered 2026-09-10: the re-POST is not intended.** Onboarding is once per
account; later profile changes belong to `PATCH /api/profile` (the six FR-010
fields) or to renewal (the FTP trio).

**The defect.** `POST /api/onboarding` (`src/pages/api/onboarding.ts:16-49`) has
one guard — authenticated or 401 — and no already-onboarded check, then calls
`upsertProfile`, which is `.upsert(insert, { onConflict: "user_id" })` and so
rebuilds the entire row. The middleware does not compensate: `PROTECTED_ROUTES`
is `["/dashboard", "/onboarding", "/profile", "/renewal", "/history"]` and
`/api/onboarding` starts with none of them, so its keep-out-of-onboarding
redirect (`middleware.ts:28`) never evaluates.

**Why it matters, and how much.** Not a cross-account issue — the endpoint uses
the cookie-scoped SSR client, so RLS confines the write to the caller's own row.
What an already-onboarded cyclist can do is rewrite their *own* withheld columns:
`equipment_type`, the FTP trio, `max_hr`. The other two write paths treat those
as a trust boundary and say so in comments (`renewal.ts:10`,
`services/profile.ts:35-39`); this one just never got the check, which reads as
an oversight rather than a decision. The concrete damage is coherence, not
privilege escalation: changing `equipment_type` while a plan is active desyncs it
from the frozen `equipment_at_generation` snapshot the legend renders from, while
the segment targets keep the kind they were generated with — **Risk #3 reached
through the write path** instead of the render path.

**Decided shape of the fix** (drafted and reviewed 2026-09-10, uncommitted in the
working tree at the time this folder was opened):

- Already-onboarded check returning **409**, after the 401 and before the body is
  parsed. 409 because "the resource already exists" is the accurate description,
  and the client already renders `body.error` (`OnboardingWizard.tsx:176-177`),
  so a second open tab gets an informative message rather than a red failure.
- **Fails closed** — `getProfile` throws on a genuine read failure, and this path
  returns 500 rather than allowing an overwrite. A deliberate divergence from the
  middleware's fail-open habit, which is why the call is wrapped.
- **`upsertProfile` stays an upsert.** Its docblock documents the idempotency
  against double submits and concurrent tabs as intent. An insert-only write
  would make the invariant structural (no read, no race) but would surface a
  duplicate-key error to a user who merely double-clicked during first
  onboarding. The residual read-then-write race is benign: two requests can both
  pass the guard only when no profile exists yet, which is legitimate first
  onboarding, and there are no withheld-field protections to bypass at that
  point. The abuse case always sees the existing row.

**Landed 2026-09-10** — guard shipped, no production behaviour beyond the
guard changed, `npm run lint` clean and all 120 existing unit assertions green.

**Regression test is deferred to §3 Phase 2, not to this change.** It needs a
request, a session, and a Supabase client, and test-plan §4 records API mocking
as "none yet — see §3 Phase 2", so writing it here would pre-empt that phase's
mocking-policy decision. Assertions it must carry: an onboarded user's POST
returns 409 and the stored `equipment_type` is unchanged; a first-time POST still
returns 200; a failed profile read returns 500 rather than writing — the last is
the hermetic-stub case, since real infra will not trigger it.

**On landing this fix, delete the §7 B3 entry rather than amending it** — §7 is
negative space, and this stops being negative space once the guard ships.
