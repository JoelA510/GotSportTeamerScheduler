# Scheduling build plan — status

Running record of the scheduling-engine build plan (`SquadLogic_ClaudeCode_Prompts_2.md`),
which converts a real anonymized season into a regression corpus and builds the
domain model, constraints, solver behaviour and query layers around it.

**Kept in the repo deliberately.** Session scratchpads have been lost twice to
container rollbacks; the repo is the only durable record.

Last updated at the pause described in §4.

## 1. Delivered

Nineteen PRs merged. Test suite **848 → 1720**, season fixture green at every
merge, no regression to the shipping app (bundle entry hash unchanged throughout).

| Prompt | What landed | PR |
|---|---|---|
| setup | Working conventions in `CLAUDE.md` §3 | #334 |
| 0.1 | `docs/ARCHITECTURE.md` — the map, with a "Known gaps" section that drove everything after | #334 |
| 0.2 | `packages/core/src/fixtures/` — read-only corpus loader; `docs/MODEL_GAPS.md` (34 gaps) | #334 |
| 1.1 | `facility/` — venues, sub-pitches, spatial overlap, size vs lining, date-scoped equipment | #335 |
| 1.2 | `timing/` — play time vs occupancy vs block, halftime ranges, warm-up as occupancy | #336 |
| 1.3 | `availability/` — permits with per-date exceptions, lighting, sunset, the binding-constraint answer | #337 |
| M1 | 6 defects from the Phase 1 review | #338 |
| 2.1 | `constraints/` — records with hardness, scope, provenance, effective windows, the what-if query; `placement/` demonstration harness | #339 |
| 2.2 | `waivers/` — records, disposition, dormancy, the narrow coach-travel evaluator | #340 |
| 2.3 | `ruleEngine/` — exercise expectations, identifier-shape checks, the validation report; the venue-complex model | #341 |
| M2 | 11 defects from the Phase 2 review | #342 |
| 3.1 | `people/` — personal timelines, sealed sources, derived must-attend, identity review queue | #343 |
| M3 | 9 defects from the Phase 3 review | #344 |
| — | Review conventions into `CLAUDE.md`; gaps ledger refreshed with verified statuses | #345 |
| 4.1 | `freeze/` + `resolve/` — freeze scopes, eight-stage pipeline, scoped re-solve | #346 |
| 4.2 | Change minimisation as an objective, change budget, dry run by default | #347 |
| 4.3 | `attribution/` — the binding constraint behind every decision | #348 |
| 5.1 | `reserve/` — unnamed fixtures, reservations, unplaced games, capacity | #349 |
| 6.2 | `publication/` — snapshots, four-bucket parity, change notices, sync registry; reason-code reachability audit | #350 |

## 2. In progress

**Prompt 6.1 — scenario branching.** Built and committed (`28d8d2a`); the
pre-PR `/code-review` returned **11 findings** and the fix pass was interrupted
mid-edit. The WIP commit that follows this document carries it.

The findings file lives at
`scratchpad/review-6.1-findings.md` **and may have been lost** — the scratchpad
has been wiped twice. The eleven, in severity order, so they are recoverable:

1. **`scenario/run.js` — `ScenarioMemo.resolve()` ignores run options.**
   Reproduced: `relocations: false` then the positive options returns the
   *identical object*. The acceptance run and the negative control differ only by
   a run option, so the memo can serve one as the other. Fixing it requires
   re-establishing the acceptance and control figures **through the memo path**,
   stated per path.
2. **`scenario/run.js` — `accountForFixtures()` findings never merged into
   `result.findings`.** A branch that lost a fixture reads `ok` and promotes.
3. **`scenario/run.js` — the `applyChangeRequest()` run's `findings`/`unplaced`
   are discarded.** A game vanishes by two mechanisms in sequence.
4. **`scenario/scenario.js` — no waiver ledger built, `reservedSlots` never
   read.** Two declared override-able record sets are inert. Honour or remove.
5. **`scenario/scenario.js` — `venue-unavailable` expands against `base`, not the
   working copy**, so an earlier `add` survives the withdrawal.
6. **`scenario/relocation.js` — a team double-booked across two replacement
   surfaces is graded `clean`.** Grade issued on a placement that is not legal.
7. **`scenario/run.js` — vacuity decided on violation count**, so a hard→soft
   retype is stamped vacuous.
8. **`scenario/scenario.js` — `ancestry` never checked against `parentScenarioId`.**
9. **`scenario/run.js` — `ScenarioMemo.check()` throws where it should report.**
10. **`scenario/scenario.js` — fingerprint omits `by`/`at`/`reason`** which do
    reach expanded records.
11. **`scenario/scenario.js` — `overridesApplied` counts primitive edits** (17 vs
    1 declared).

State at the pause: 58 scenario tests passing, `npm run typecheck` reporting 2
errors in a typedef mid-extension (`UnrelocatableGame` gaining
`candidatesRefusedTeamClash` / `reservedSlotsHonoured`). **Not mergeable as-is.**

6.1's acceptance figures before the fix pass, to be re-established rather than
assumed: 72 displaced 7v7 games; 11 clean replacements on Maplewood Front; 49
compromised on Alder's 9v9-lined halves; 12 TIME TBD; `LINING_MISMATCH` 40 → 89;
7v7 capacity 466 → 340 over the nine affected dates.

## 3. Remaining

| Prompt | Scope |
|---|---|
| 6.1 | finish the 11 fixes, re-run `/code-review`, PR, merge |
| 7.1 | Read-only feasibility API — the build plan calls this "the highest day-to-day-value item in the whole sequence" |
| 7.2 | Fairness and equity metrics |
| 7.3 | External fixture import with impact analysis |

Follow-ups raised during the build and deliberately not absorbed:

- **A standing warm-up rule.** `timing/` proved the published season has 8 warm-up
  conflicts on its busiest date, but `SEASON_2026_WARMUP_POLICY` ships empty and
  no standing rule books a warm-up, so a season run does not check it. Wiring one
  moves the accepted-exceptions baseline and needs its own PR.
- **`coach-maximum-gap` is still `RULE_CONSTRAINT_UNENFORCED`** even though
  `evaluatePersonDays()` can now answer it.
- **Division is still a label, not a key** (GAP-24). `grep divisionId` over all
  new packages returns nothing.
- **Promote two widened publication codes to first-class** —
  `NOTICE_PARITY_VACUOUS` / `NOTICE_LABEL_AMBIGUOUS`, currently distinguished only
  by `details.reason`.
- **Nothing is persisted.** Every module built here is in-memory. GAP-29's stored
  half stays open, and `z.coerce.date()` in `SlotSchema`/`AssignmentSchema`
  (GAP-30) must be closed before publication snapshots can be persisted safely —
  otherwise the parity checker would cause the divergence it detects.
- **Nothing is wired into the shipping app.** The week-indexed `gameScheduling.js`
  is untouched by design; it now *refuses* a freeze argument rather than ignoring
  one, so the gap is loud rather than silent.

## 4. Working conventions that proved their worth

Recorded because they were learned the hard way and are cheap to keep.

- **`/code-review` on every PR, before it opens.** Moved from per-milestone after
  Phase 3. Across the run it found **~60 defects that the per-step verification
  did not** — and none were broken features. Every one was a *hollow guarantee*
  that passed its own tests.
- **Three "a check that cannot fail" defects reached `main`** before the pattern
  was written into `CLAUDE.md` §3, and more were caught in fresh code afterwards.
  A meta-assertion needs its failing case constructed and proven, not just written.
- **Unknown is not zero.** Folding an unmeasurable overlap into "no clash" has
  recurred four separate times; JavaScript's falsy semantics make it free unless
  actively prevented.
- **Derive figures from the corpus at test time.** Hardcoded copies of derived
  numbers drift, and a suspiciously good result is worth investigating — 6.1's
  grid anchor produced a *better-looking* outcome that was an artifact.
- **The corpus caught our own reproductions of its own incidents**, twice: the
  loader dropping unknown-footprint scrimmages (incident 5) and an uncoached team
  losing its fixtures (incident 10).
