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

**Prompt 6.1 — scenario branching.** Built (`28d8d2a`); the pre-PR
`/code-review` returned **11 findings**; the fix pass has landed (`bfaae0f`)
and all gates are green — typecheck 0 errors, lint 0 errors / 1 warning
(baseline), source hygiene green, suite **1736 passed | 34 skipped | 6 todo**,
up from 1720 (sixteen regression tests, each written to fail first).

The **second** review round, over the whole PR diff including that fix pass,
returned **6 further findings**. All six are fixed in the working tree (not yet
committed), each with a regression test written to fail first: suite **1746
passed | 34 skipped | 6 todo**, up from 1736. No new reason code and no new
export; `SCENARIO_OVERRIDE_CONFLICT` gained a second driver at the venue.

The **third** review round returned **4 further findings**, the top one the same
defect class for the third time. All four are fixed in the working tree (not yet
committed), each with a regression test written to fail first: suite **1758
passed | 34 skipped | 6 todo**, up from 1746. No new reason code;
`SCENARIO_DIGEST_ORDER` is replaced by `SCENARIO_DIGEST_EXCLUSIONS` in the
barrel, and `ScenarioMemo.check()` takes an optional fourth argument.

Still to do before merge: **PR**.

### The four findings of round three

1. **`inputs.js` — the digest class, closed rather than the instance.** The
   widened digest covered `schedule.games` only, so on this corpus a bundle with
   all 132 teams removed digested identically (`a3ee968081a5219b`) to the full
   one, as did one carrying an extra travel commitment. Rather than name the
   seven missing fields, `digestSubjectOf()` now walks the bundle's own
   enumerable fields at run time and renders each to full depth;
   `SCENARIO_DIGEST_EXCLUSIONS` names the three it deliberately skips (`id`,
   `label`, `digest`) with a reason each, and an unrenderable field throws. A
   reflection test perturbs every field of the live bundle **and** the live
   `Schedule` and asserts the digest moves for all of them; run against the
   digest it replaced, the same walk reports the nine uncovered `Schedule`
   fields. Cost: the digest 6.0 ms to 21.2 ms, a warm memo hit 8.0 ms to
   19.9 ms, two cold questions 1,646 ms to 1,796 ms.
2. **`scenario.js` — round two's venue-duplicate claim fired down an ancestry.**
   It was built over `composedOverrides()`, so a child broadening its parent's
   `venue-unavailable` was refused at blocking, skipped, and materialised its
   parent's narrower withdrawal — with the message attributing the parent's
   override to the child. The claim is now keyed by the **authoring scenario**.
   Two same-scenario withdrawals over shared days still conflict; disjoint dates
   still compose.
3. **`run.js` — `check()` stopped answering the question it exists for.**
   `resolve()` purges stale entries before its lookup, so after any intervening
   resolve of the same branch a caller still holding the pre-edit result was
   told `[]`. `check()` now takes the results a caller holds and reports
   `SCENARIO_RESULT_STALE` for them whichever way the cache has moved; a held
   result from another branch throws rather than being judged. Round two's
   finding 6 is untouched — the cache half is still answered over every entry.
4. **`run.js` — `forgetStale()` materialised the branch to read a string.** It
   built all four engines only to take `.fingerprint`, on every resolve. It now
   calls `scenarioFingerprint(inputs, composedOverrides(...))`, which returns
   the identical string; a test asserts the two agree. `check()` reads it the
   same way. Saving ~2 ms per resolve, against the ~15 ms finding 1 adds.

### The six findings of round two

1. **`inputs.js` — the baseline digest was incomplete.** It covered the record
   arrays plus the facility and timing inputs, so two bundles differing only in
   one game's kickoff digested identically (`927f6a6a15a16e71`). `schedule`,
   `calendarOptions` and `venueComplexes` are now in `SCENARIO_DIGEST_ORDER`.
2. **`scenario.js` — an in-place record edit never invalidated the memo.**
   `scenarioFingerprint()` read `inputs.digest`, snapshotted at
   `makeSeasonInputs()` time, so the "one fix, five branches" correction the
   sharing guarantee exists for invalidated nothing. Recomputed at question
   time; sharing untouched. Cost: `scenarioFingerprint()` 0.03 ms to 6.7 ms,
   `materialiseScenario()` 1.0 ms to 7.8 ms, a warm memo hit 1.1 ms to 9.0 ms,
   against a ~900 ms derivation. Two cold questions: 1,824 ms to 1,787 ms, i.e.
   unchanged inside the noise.
3. **Two `venue-unavailable` overrides for one venue produced no conflict**, and
   the code comment asserting they were "still caught loudly, by
   `SCENARIO_OVERRIDE_ID_COLLIDES`" was **false** — the second one's removes
   delete the first one's rows before its adds re-add them. The later author's
   reason silently replaced the earlier author's on all seven rows. Now claimed
   at the venue: overlapping scopes are `SCENARIO_OVERRIDE_CONFLICT` at
   blocking, disjoint date scopes still compose. Round one's decision — a
   derived remove does not conflict with rows *another kind* of override wrote —
   is untouched.
4. **`diff.js` — the quality delta was mostly churn.** Scoring the left against
   itself and the right against the left made the delta 1,597,760, of which only
   324,800 was the violation difference. Each side now scores against its own
   games; the delta negates exactly when the sides are swapped, and the test
   asserts that.
5. **`relocation.js` — `UnrelocatableGame.candidatesConsidered` was structurally
   0**: `options.length` on the branch that runs only when `options.length ===
   0`. It now carries the candidates generated before filtering — `[35 x 12]`
   here — and the per-game counts sum to `meta.candidatesConsidered` (2,720),
   which the test reconciles. Siblings: `candidatesRefusedTeamClash` was
   reachable but unasserted, and is now asserted non-zero in the team-clash
   test; `reservedSlotsHonoured` restated its own input and now counts the slots
   actually installed as bookings.
6. **`run.js` — the memo's staleness gate and its writes disagreed on scope.**
   `resolve()` gated on `check()` over every entry for a scenario and overwrote
   one, so a stale entry for another question forced misses for ever on a live
   one. `resolve()` now forgets every entry the branch has moved past.

All six gates green: lint 0 errors / 1 warning (baseline), typecheck clean,
`frontend:build` clean, `check:advisors` PASS, `check:bundle` PASS (217.96 KB gz
against a 244.14 KB budget). One new reason code,
`SCENARIO_ANCESTRY_UNRESOLVED`, in the frozen severity table with a driver entry.

**Acceptance re-established through both paths and both derivation orders** —
the order was what decided which run poisoned which, so both were run. Every
acceptance figure below held in all three: 72 displaced, 11 clean, 49
compromised, 12 TIME TBD, `LINING_MISMATCH` +49, capacity 466 to 340. Both
memos recorded `hits=0 misses=2`. One figure moved, intentionally: the negative
control's status was `allowed` and is now `compromised`, which is finding 2's
whole point.

**Not test-verified, and recorded as such:**

- **Finding 3's second half did not reproduce.** The discarded-findings half is
  fixed and test-verified. The *vanishing* itself could not be triggered through
  any public input — `run.unplaced` was 0 on every attempt — because in
  `runScenario()`'s configuration every game is either frozen or pinned, so the
  only stage that shelves is never handed a pending game. The data flow was
  fixed anyway and the second mechanism made loud, but the vanishing is
  **statically reviewed, not reproduced**.
- Consequently `FIXTURE_DROPPED` / `FIXTURE_DOUBLE_COUNTED` are not reachable on
  this corpus. The accounting merge is test-verified over the whole findings
  list, which is what makes those codes consequential when they do fire.
- `promoteScenario()` refusing over a merged `FIXTURE_DROPPED` is unverified
  end-to-end for the same reason.

**One deliberate behaviour change** (from finding 5): a `venue-unavailable`
derived `remove` no longer raises `SCENARIO_OVERRIDE_CONFLICT` against a record
an earlier override wrote. Two *authors* naming one record id is the
contradiction that guard exists for; an author naming a *venue* whose rows
another override happens to touch is composition. ~~A duplicate
`venue-unavailable` for the same venue is still caught, by
`SCENARIO_OVERRIDE_ID_COLLIDES` on the blackout rows it re-adds.~~ **That last
sentence was false and round two's finding 3 corrected it**: nothing collided,
because the second withdrawal removes the rows before re-adding them. The
duplicate is now claimed at the venue instead.

Correction to finding 11 as filed: the review said 17 applied against 1
declared; on this corpus the withdrawn venue expands to 8 edits (1 base permit
row plus 7 weekday blackouts). Same defect, different arithmetic.

The eleven findings, kept here because the scratchpad copy has been lost twice:

1. **`scenario/run.js` — `ScenarioMemo.resolve()` ignored run options.**
   Reproduced: `relocations: false` then the positive options returned the
   *identical object*. The acceptance run and the negative control differ only
   by a run option, so the memo could serve one as the other. This was a threat
   to 6.1's evidence, not merely a caching bug; the acceptance figures must be
   re-established **through the memo path** and stated per path.
2. **`accountForFixtures()` findings never merged into `result.findings`.**
   A branch that lost a fixture read `ok` and could be promoted.
3. **The `applyChangeRequest()` run's `findings`/`unplaced` were discarded.**
   A game vanished by two mechanisms in sequence.
4. **`scenario.js` — no waiver ledger built, `reservedSlots` never read.**
   Two declared override-able record sets were inert.
5. **`venue-unavailable` expanded against `base`, not the working copy**, so an
   earlier `add` survived the withdrawal.
6. **`relocation.js` — a team double-booked across two replacement surfaces was
   graded `clean`.** A grade issued on a placement that is not legal.
7. **Vacuity decided on violation count**, so a hard-to-soft retype was stamped
   vacuous. A count is not an identity.
8. **`ancestry` never checked against `parentScenarioId`.**
9. **`ScenarioMemo.check()` threw where it should report.**
10. **Fingerprint omitted `by`/`at`/`reason`**, which do reach expanded records.
11. **`overridesApplied` counted primitive edits** (17 against 1 declared).

6.1's acceptance figures, to be confirmed through the memo path rather than
assumed: 72 displaced 7v7 games; 11 clean replacements on Maplewood Front; 49
compromised on Alder's 9v9-lined halves; 12 TIME TBD; `LINING_MISMATCH` 40 to
89; 7v7 capacity 466 to 340 over the nine affected dates.

Round two re-established all of them again — findings 1, 2 and 6 all touch the
memo — through the direct path and the memo path, in both derivation orders.
Every figure held identically in all four runs, and both memos recorded
`hits=0 misses=2` with a re-ask of either question then hitting. One figure
moved, by design: the quality delta, from +1,597,760 to +324,800, and the
control's `quality.right` from 8,305,400 to 1,105,400 against the searched run's
400,300 — the change terms are no longer counted inside a number called quality.

## 3. Remaining

| Prompt | Scope |
|---|---|
| 6.1 | fixes landed; re-run `/code-review`, PR, merge |
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
