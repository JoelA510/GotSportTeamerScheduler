# Schedule Scenarios

**Module**: [`packages/core/src/scenario/`](../packages/core/src/scenario/) ·
**Tests**: [`tests/scenarioBranching.test.js`](../tests/scenarioBranching.test.js) ·
**Gaps**: [GAP-28](MODEL_GAPS.md#gap-28), [GAP-29](MODEL_GAPS.md#gap-29)

> _"The source project needed parallel schedules for 'with/without venue A',
> 'with/without venue B', and 'with/without equipment at one site on one date'.
> Each was a hand-built duplicate of the entire pipeline, separately verified,
> and impossible to keep in sync."_

A scenario is a **branch of a baseline**, not a copy of one. It holds the edits
and nothing else: no schedule, no records, no stored diff. Everything else is
re-derived on demand from the baseline's own inputs, which is what makes *"a
constraint fix must not need applying five times"* a property of the data
structure rather than a rule somebody has to remember.

---

## 1. What is here

| Piece                     | Entry point                                | What it is                                                                                     |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **Baseline inputs**       | `makeSeasonInputs()`                       | one immutable bundle of *inputs* — never built engines — that every branch re-derives from      |
| **A branch**              | `makeScenario()`                           | id, baseline, optional parent, override list, rationale. **No schedule and no records**         |
| **Materialising**         | `materialiseScenario()`                    | `base ∪ overrides` back into engines, sharing every record set no override touched              |
| **Replacement ground**    | `proposeRelocations()`                     | a search for spare ground under a stated policy — **proposed, never solved**                    |
| **The answer**            | `runScenario()` / `ScenarioMemo`           | lazily derived, fingerprinted, never stored on the scenario                                     |
| **The comparison**        | `diffScenarios()`                          | which games differ, which constraints break, what capacity is lost — and nothing else           |
| **Promotion**             | `promoteScenario()`                        | a new primary plus the recorded diff, in memory, returning a record                             |

Everything follows the conventions of the twelve packages before it: a frozen
severity table (`scenario/reasonCodes.js`), findings as a list, a status derived
mechanically from severities, additive `meta` counters, `.strict()` Zod schemas,
`YYYY-MM-DD` dates and minutes past local midnight, and **no `new Date()`
anywhere** — a structural test asserts it.

---

## 2. A scenario owns edits, not records

`SeasonInputs` is the bundle: the `Schedule`, the facility graph **input**, the
format timing **input**, permit / sunset / lighting rows, equipment windows, the
constraint **record array**, waivers and reserved slots. These are inputs, not
engines. `buildFacilityGraph()`, `buildFormatTimingTable()`,
`buildAvailabilityCalendar()` and `buildConstraintRegistry()` are pure functions
of them, so a branch **re-derives** rather than mutates.

`ScheduleScenario` is `{ id, name, baselineId, parentScenarioId, overrides,
rationale, requestedBy, createdAt }`. A structural test asserts those are its
only keys, because a scenario that could hold a schedule is a scenario somebody
will put one in.

`ScenarioOverride` is a tagged union over one **named record set**:

| kind                 | what it does                                                                        |
| -------------------- | ------------------------------------------------------------------------------------ |
| `add`                | appends a record the baseline does not hold                                          |
| `remove`             | withdraws a record the baseline holds, by id                                         |
| `retype`             | changes a constraint's hardness, **delegating to `retypeConstraint()`**              |
| `venue-unavailable`  | withdraws a venue, wholly or on named dates; the materialiser expands it into permits |

### Sharing is structural, not promised

`materialiseScenario()` rebuilds only the record arrays an override touches.
Every other set is the **same array object** the baseline holds, and
`meta.recordSetsShared` counts them. The falsification is in the test: five
branches are materialised, one constraint record is corrected **once** in the
baseline, and all five see it — while a deliberately record-copying materialiser
built in the same test fails the identical assertion.

### `remove` is not convenience

A blanket permit blackout *does* beat an open window — `restrictiveness()`
returns `+Infinity` for `hasPermit: false` and `resolvePermitWindow()` applies
the more restrictive record. But two equally-specific records that disagree are
`PERMIT_PRECEDENCE_AMBIGUOUS` on **every** consultation for that venue, because
the calendar never picks a winner silently. So withdrawing a venue withdraws its
own rows *and* adds the blackout. The test proves both halves: the branch
resolves unambiguously on every date, and a constructed add-only branch resolves
to the same blackout **and reports the ambiguity**.

### One record with a `venueId`, not five hand-written blackouts

`expandVenueUnavailable()` turns one override into a complete set of permit
edits: withdraw every row the venue has, and lay a blackout on **all seven
weekday codes**, so no date can fall through a weekday nobody enumerated. A
date-scoped withdrawal instead lays one date-exception blackout per named date,
which beats the weekday default by `resolvePermitWindow()`'s existing precedence
rule rather than by a new one.

**The venue stays in the facility graph.** `requireSurface()` throws on an
unknown id and the baseline's own games still carry their surfaces; removal is an
*availability* fact, not a *geometry* one.

### No fourth specificity ladder

Overrides are **set operations on record arrays applied before any engine is
built**. They never compete for precedence at consultation time, so none of
`CONSTRAINT_SCOPE_SPECIFICITY`, `WAIVER_SCOPE_SPECIFICITY` or
`FREEZE_SCOPE_TIE_BREAK` applies and this module forks none of them — a
structural test asserts the package declares no `*_SPECIFICITY` and no
`*_TIE_BREAK` table. Two overrides touching one record id is
`SCENARIO_OVERRIDE_CONFLICT` at **blocking**: a contradiction to remove, not a
precedence to resolve.

---

## 3. Lazily evaluated, with a fingerprinted memo

A `ScenarioResult` is derived on demand and cached by `ScenarioMemo`. Nothing is
stored on the scenario, and the reason is worth stating twice:

- **Not a stored schedule.** That is the source project's failure verbatim.
- **Not a stored diff.** A diff is only meaningful against the baseline it was
  computed from, so fixing a constraint in the baseline leaves every stored diff
  describing a schedule that no longer exists — incident 1's shape in a new
  place. A stored diff also *cannot* answer "which constraints break", because
  breakage is a property of the result rather than of the edit.

The **fingerprint** is a structural digest over the base record arrays plus the
override list — never over scenario metadata such as an `updatedAt`, which would
derive a check's subject from the data a corruption would also change. It reuses
`publication/snapshot.js`'s `publicationDigest()` rather than adding a second
digest. A cached run whose fingerprint no longer matches is re-derived, and
reading one past the check raises `SCENARIO_RESULT_STALE` at **blocking**.

---

## 4. The four steps of a branch, and which machinery each one is

| step                             | machinery                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------- |
| which games the branch displaces | `runRuleEngine()` twice — the baseline's engines and the branch's — and the difference |
| where they could go instead      | `proposeRelocations()` — **proposed, not solved**                                |
| applying that                    | `applyChangeRequest()`, maximum freeze around exactly the displaced set          |
| what has nowhere to go           | `createResolveState()` + `applyMove(TIME_TBD)` + `unplacedFromResolveRun()`      |

Displacement is derived from the rule engine rather than from a private
definition of "illegal", and by **count** rather than presence, exactly as
`newBlockingCodes()` does in `resolve/stages.js`: a game already breaking a code
once and breaking it twice under the branch carries the same code *set* in both
places.

The shelving is a **second, explicit step after the re-solve**, not something the
pipeline did. It goes through `applyMove()` — the one writer — so what it shelves
is ledgered, judged against a freeze that holds every game the branch did not
name, and projected back into a schedule by `resolvedScheduleOf()`, commitments
and all. Doing it in the scenario layer rather than inside the run is what keeps
the report honest: the solver did not decide those games were unplaceable, the
branch did.

---

## 5. The relocation gap: why replacements are *proposed*

The build plan's acceptance test asks the report to name *"the affected format,
the replacement venues, and the added compromises"*. **The re-solver cannot
supply the middle one**, and it is structural rather than a bug:
`resolve/inventory.js` `candidateSlotsFor()` derives a game's candidate venue
from **its own anchor surface** and fixes every candidate at **`anchor.date`**.
That is the anti-slot-inventor guarantee working as designed — a re-solve
re-places games onto slots the baseline already used — and it means a re-solve of
"no venue X" produces TIME TBD fixtures each correctly naming `PERMIT_BLACKOUT`
and **no replacement venue at all**. `tests/scenarioBranching.test.js` asserts
that directly, off the run's own state: every slot `candidateSlotsFor()` offers a
displaced game is at the withdrawn venue, on the same date.

Widening `candidateSlotsFor()` to cross venues was the alternative and was
**rejected**: it changes the anti-slot-inventor guarantee for every caller and
silently redefines `reoptimiseWholeSeason()`, whose 8-games-moved figure is a
headline result of Prompt 4.2.

So `proposeRelocations()` searches. It runs `buildReserveCapacityReport()` under
the **branch's own** engines to find spare ground of the right format on the
right dates, pairs each displaced game with a slot under a **stated policy**, and
emits a change request naming those slots. `changeRequestApply` already accepts
an arbitrary date and surface, and `isSlotAdmissible()` already admits an
out-of-inventory slot for exactly the game the request named. `holdChanges: true`
pins what it proposed, so `local-search` cannot quietly drift a game off a slot
the report says it was proposed onto.

**The sentence that must survive every rewrite of this report**: these
replacements were proposed by `proposeRelocations()` under a stated policy. The
solver did not find them. Every finding this module emits names the policy.

### The policy is data, and it changes the answer

| field                    | where it comes from                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `surfaceIds`             | **no default.** `replacementSurfacesFor()` derives them; the adapter states them      |
| `cadenceMinutes`         | the format's own `blockMinutes` from `game_formats.csv`                               |
| `earliestKickoffMinutes` | the earliest kickoff the published season gives **that format**                       |
| `allowDateChange`        | `false`, and not settable: families have the date                                     |
| `policy`                 | `nearest-kickoff` (drift first) or `prefer-clean` (grade first)                       |

`replacementSurfacesFor()` filters to leaf surfaces (booking a parent pitch takes
both halves with it), not at a withdrawn venue, and **within one size grade of
the format**. The last filter matters: the size policy is downward-closed, so
*every* 11v11 pitch is technically eligible for a 7v7 game and a search that took
the policy literally would offer the stadium.

The **anchor** matters too, and the test asserts why. The club's blanket first
kickoff is 08:00; the earliest 7v7 kickoff in the corpus is 09:00. A grid laid at
the format's 75-minute block from 08:00 falls *between* every published kickoff,
so no relocated game could keep the time families already have.

Running the same branch under `prefer-clean` keeps more games on cleanly-lined
ground and pays for it in drift — asserted in the test, because "under a stated
policy" only means something if the policy changes the answer.

---

## 6. "Undersized" is unreachable by design

The build plan's example names *"games on undersized or wrongly-lined pitches"*.
Only the second half is deliverable, and the reason is a property of the model
rather than of this corpus:

- `SIZE_TOO_SMALL` is **blocking**, and
- the size policy is **downward-closed**,

so a game is *refused* rather than placed on ground too small for it. There is no
`undersized` replacement grade and there will not be one. Retyping the size
constraint to manufacture the case would weaken a hard physical constraint in
order to satisfy a test.

The wrongly-lined half composes with no new code at all: `LINING_MISMATCH` is
already `compromise` in `facility/eligibility.js`, and `REPLACEMENT_GRADE` has
exactly two members because the facility model has exactly two answers for a
size-eligible surface. The test asserts the unreachability rather than assuming
it: every surface the corpus declares too small for the format is absent from
both the policy's candidate set and the proposals.

---

## 7. The diff is optimised for exactly three things

> _"The comparison output I actually needed every time was the same three
> things — which games differ, which constraints break, what capacity is lost.
> Optimise the diff for that, not for generic completeness."_

| the three things            | where it comes from                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| which games differ          | `diffSchedules()`, in `resolve/state.js`'s own `ScheduleChange` shape and `slotChangedFields()` |
| which constraints break     | `runRuleEngine()` both sides, tallied by `resolve/report.js`'s own `violationTally()`       |
| what capacity is lost       | `buildReserveCapacityReport()` under each side's engines, **per stated subject**            |
| the quality delta beside them | `scoreSchedule()` — the one fitness function; nothing here multiplies a count by a weight  |

### Why this is not `compareParityRows()`

`publication/parity.js` already holds a four-bucket comparator, and this module
adopts its **shape** — enumerated from both sides, every game in exactly one
bucket, totals reconciled against both inputs, the reconciliation exported so a
test can make it fail — without calling it.

The reason is vocabulary. `compareParityRows()` compares `ParityRow`s, whose
fields are `outputGeneration.js`'s export columns; routing schedule games through
that adapter would make a scenario diff depend on the column set the club happens
to publish. It would also inherit machinery a schedule does not need — key
ambiguity, input-order pairing and mapping rules all exist because a re-imported
export has no reliable identity, whereas a game id is unique by construction
(`createResolveState()` throws on a duplicate).

`diffAgainstBaseline()` is `ResolveState`-scoped and has **no notion of an added
or a removed game**, because every game exists on both sides of a re-solve by
construction. Two scenarios are not like that: one branch can carry a fixture the
other has shelved. `diffSchedules()` is therefore the same shape one bucket
wider, and the `changedFields` computation for a `Schedule` slot lives in
**exactly one file** — a structural test asserts it, and asserts that this module
imports it rather than copying it.

### "Newly" violated, not "violated"

The published season already carries **62 accepted exceptions**. A diff that
listed every code either side breaks would bury the ones the branch caused, so
`newlyViolated` is the codes whose *count grew*, and the test asserts that codes
whose delta is zero never appear in it.

### There is no single "capacity lost" scalar

`ReserveCapacityInputSchema` requires a stated `format`, `surfaceIds`, `dates`,
`earliestKickoffMinutes` and a `requirement` before it has an answer, so the
delta is per (date-set, format, surface-set) and the caller declares which. A
headline number over "capacity" would be a number over an unstated question, and
a diff asked for capacity with no subject reports
`SCENARIO_CAPACITY_SUBJECT_UNSTATED` at `compromise` rather than a silence.

---

## 8. The three named falsifications

Three "a check that cannot fail" defects have already been caught in fresh code
in this project. Each meta-assertion here has its failing case constructed and
proven in `tests/scenarioBranching.test.js`:

| claim         | the assertion                                                                   | the falsification                                                              |
| ------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **sharing**   | one record corrected in the baseline is seen by five re-materialised branches     | a record-copying materialiser built in the test fails the same assertion         |
| **partition** | `changed + added + removed + unchanged` reconciles against **both** inputs        | a dropped row and a double-counted row are each caught, by totals and by identity |
| **vacuity**   | an override that changes no result is `SCENARIO_OVERRIDE_VACUOUS` at `compromise` | an override for a venue the schedule never uses fires it; the real branch does not |

Alongside them, the **negative control**: the same branch with the proposer
switched off. Every displaced game is TIME TBD naming `PERMIT_BLACKOUT`, **no
replacement venue is named anywhere in the report** (the test scans every finding
detail, not only the ones it expects to be empty), and the result scores strictly
worse under the same objective. "We found replacements" only means something
because the alternative finds none.

---

## 9. Two names this module deliberately does not take

**`field_availability_scenarios`** already exists in SQL
(`supabase/migrations/20260522120000_field_availability_phase1.sql:93-112`) and is
fully orphaned — no scheduler and no evaluator reads it
([`ARCHITECTURE.md`](ARCHITECTURE.md) §6.13). It models **field-availability
profiles**: which fields a club may use in a given configuration. This module
models **schedule branches**, is in memory only, and writes no SQL. Neither reads
the other, and they must not be unified: they are different concepts that share
an English word.

**"Snapshot"** is already spoken for twice. `packages/core/src/teamSnapshot.js`
owns it for teaming, with its own `SnapshotStatus` of `draft | review | published
| locked`; `publication/snapshot.js` qualifies its own as `Publication…`.
`promoteScenario()` reuses the publication snapshot rather than introducing a
third — the recorded diff is frozen as a digest-stamped artifact in its own
column vocabulary — and a structural test asserts this package imports
`teamSnapshot.js` nowhere and names `SnapshotStatus` nowhere.

---

## 10. Promotion

`promoteScenario()` is **in memory and returns a record**. It maintains no second
registry and writes no SQL. It refuses a scenario carrying blocking findings the
caller did not accept **by code** — the same contract `commitResolve()` keeps —
and it refuses a promotion whose recorded diff moves nothing at all, because that
would record a decision about nothing.

What it produces:

- **the new primary**, `withRecords()` over the branch's *effective* arrays, so
  every set the branch did not touch is still the same object the old baseline
  held. Promotion preserves the sharing rather than forking it, and the test
  asserts object identity per shared set.
- **the recorded diff**, travelling on the promotion record, and frozen as a
  `PublicationSnapshot` over `PROMOTION_DIFF_COLUMNS` — bucket, game, label,
  changed fields, before, after — with a content digest, a supplied
  `promotedAt`, a named `promotedBy` and `durability: 'in-memory'` on the record.
  Times go through `naiveDateTime()`, the only GAP-30-safe formatter in this
  repository, and a shelved game records with both TBD tokens.

---

## 11. What this corpus produces

Every figure below is derived at test time from `fixtures/season-2026/`. None is
typed into the test as an expectation, and the withdrawn venue is chosen by a
**stated property** rather than by name: the largest single-format venue whose
format has replacement ground carrying more than one grade.

That is **Brookside Park** — 72 games, all 7v7, across nine Saturdays, 100% of
its own use.

| figure                          | value                                                                    |
| ------------------------------- | ------------------------------------------------------------------------- |
| games displaced                 | **72**, and the affected format is **7v7**, unambiguously and only        |
| candidate slots searched        | 2,720                                                                     |
| replacements proposed           | **60**                                                                    |
| — clean                         | 11, all on Maplewood Front Field 1 (`sizes:["7v7"] lined:["7v7"]`)        |
| — compromised                   | 49, on Alder Pitch 1A/1B/4A/4B (`sizes:["9v9"] lined:["9v9"]`)            |
| no replacement at all           | **12**, on the four latest dates, carried as TIME TBD (incident 10)       |
| games moved in the diff         | 60 changed, 12 removed, 0 added, 607 unchanged                            |
| newly violated                  | `LINING_MISMATCH` +49, `GAMES_PLAYED_OFF_TARGET` +18, `ROUND_ROBIN_SPREAD_EXCEEDED` +6, `HOME_AWAY_OUT_OF_RANGE` +4, `ROUND_ROBIN_INCOMPLETE` +3, `TRAVEL_COMMITMENTS_OVERLAP` +1 |
| no longer violated              | `TRAVEL_BETWEEN_VENUES_TOO_SHORT` −1                                     |
| capacity, 7v7, those nine dates | 466 → 340 slots, **−126** — for that subject and no other                 |

The `LINING_MISMATCH` delta of 49 is exactly the number of compromised
replacements, computed by the rule engine independently of the proposer. The four
round-robin and hosting codes are the cost of the 12 fixtures that have nowhere
to go — a season in which twelve games do not happen is a season whose
round-robin is incomplete, and the diff says so rather than reporting only the
games that moved.

**The negative control**, same branch, proposer off: 72 TIME TBD fixtures all
naming `PERMIT_BLACKOUT`, zero games moved, zero replacement venues named, and a
quality score roughly five times worse.

---

## 12. What this module deliberately is not

- **Not a second solver.** Nothing here places a game. `proposeRelocations()`
  searches for spare ground and hands the slots to `applyChangeRequest()` by
  name.
- **Not a second fitness function.** Quality goes through `scoreSchedule()`. A
  structural test asserts no file in the package multiplies a count by a weight
  and that neither existing fitness function is reached for.
- **Not a second diff, a second digest, a second TIME TBD path or a second
  immutable record.** Each is the one that already exists.
- **Not persisted.** Phase 6 is in-memory only. There is no SQL home for a
  scenario, a materialisation or a promotion, and this work deliberately creates
  none — consistently with Phases 1-5.

---

## 13. Reason codes

| code                                 | severity     | when                                                                    |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------ |
| `SCENARIO_OVERRIDE_APPLIED`          | `info`       | an override edited a base record array. Provenance                       |
| `SCENARIO_OVERRIDE_CONFLICT`         | `blocking`   | two overrides touch one record id                                        |
| `SCENARIO_OVERRIDE_TARGET_MISSING`   | `blocking`   | a `remove` or `retype` names a record the base does not hold             |
| `SCENARIO_OVERRIDE_ID_COLLIDES`      | `blocking`   | an `add` uses an id the base already holds                               |
| `SCENARIO_OVERRIDE_VACUOUS`          | `compromise` | the branch changed no result at all                                      |
| `SCENARIO_BRANCHED_FROM_SCENARIO`    | `info`       | the branch composes a parent's overrides under its own                   |
| `SCENARIO_RESULT_STALE`              | `blocking`   | a cached result's fingerprint no longer matches its inputs and overrides |
| `SCENARIO_GAME_DISPLACED`            | `info`       | games the branch leaves standing where its own engines refuse them       |
| `SCENARIO_RELOCATION_PROPOSED`       | `info`       | replacements were proposed, naming the policy and the ground             |
| `SCENARIO_RELOCATION_COMPROMISED`    | `compromise` | some replacements are legal but wrongly lined                            |
| `SCENARIO_RELOCATION_UNAVAILABLE`    | `compromise` | a displaced game has no replacement slot; TIME TBD with a reason         |
| `SCENARIO_RELOCATIONS_DISABLED`      | `info`       | the negative control ran                                                 |
| `SCENARIO_DIFF_PARTITION_INCOMPLETE` | `blocking`   | the games-moved partition does not reconcile against both inputs         |
| `SCENARIO_DIFF_VACUOUS`              | `compromise` | a diff over no game, or a quality delta neither side measured            |
| `SCENARIO_CAPACITY_DELTA`            | `info`       | capacity for one stated subject, on both sides                           |
| `SCENARIO_CAPACITY_SUBJECT_UNSTATED` | `compromise` | capacity was asked for with no subject, so none is reported              |
| `SCENARIO_PROMOTED`                  | `info`       | a branch became primary, with the diff on the record                     |
| `SCENARIO_PROMOTION_REFUSED`         | `blocking`   | promotion refused over a blocking finding nobody accepted                |

Every one of these is driven from a public entry point in
`tests/reasonCodeReachability.test.js`, which registers `SCENARIO_REASON`
alongside the fourteen vocabularies before it.
