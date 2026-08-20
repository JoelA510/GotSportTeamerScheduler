# The standing rule engine

Phase 2.3. The whole [constraint registry](CONSTRAINT_REGISTRY.md) run against a
whole schedule, returning **structured violations** — and, more importantly,
refusing to return a clean answer it cannot justify.

The incident this answers is number 4 in
[`fixtures/season-2026/README.md`](../fixtures/season-2026/README.md):

> **The validator that checked nothing.** A team-name format change
> (`U12B04` → `12B9v904`-style codes) made the coach validator's join match zero
> person-pairs. It reported zero conflicts — a perfect score meaning "I looked
> at nothing." A second checker misread placeholder labels as team codes and
> reported phantom violations.

**Two failures, and they need different cures.** The first is a question about
*how much* was matched; the second is a question about *what* was matched, and
no count can answer it — the broken checker matched more rows, not fewer.

Code: `packages/core/src/ruleEngine/` (barrel at `index.js`). In-memory only —
there is no SQL home for rules or reports and this phase deliberately does not
create one.

---

## 1. A rule is a record with an evaluator attached

| Field | Meaning |
| --- | --- |
| `id` | Stable identity. |
| `title` | Display label. |
| `constraintIds` | The registry constraints it enforces. **May be empty**, which is reported, not assumed. |
| `reasonCodes` | Every code it may emit. |
| `constraintIdByCode` | Optional narrowing: which of the rule's constraints each code belongs to. An **empty list** means "none of them, so no waiver may excuse it". |
| `exercise` | **Required.** What the rule must have examined before its verdict counts. See §2. |
| `rationale` | Why the rule exists. Required. |
| `evaluate` | `(schedule, context) => { subjects, findings, counters, matched }`. |

`RuleDefinitionSchema` is `.strict()` and **refuses a rule with no exercise
expectation**, and refuses one whose every declared minimum is zero. A rule that
promises nothing about what it examined cannot be registered, let alone run.

---

## 2. The exercise expectation is data, on the rule

```js
exercise: {
  minimums: { personPairsCompared: 1, peopleExamined: 1 },
  coverage: { divisionsExamined: 'division' },
  identifierKinds: ['team', 'person'],
  rationale: 'why these are the right numbers to demand',
}
```

Three claims, checked by `exercise.js`, each with its own reason code:

| Claim | Checked by | Fails with | Catches |
| --- | --- | --- | --- |
| A counter is at or above a floor | `checkMinimums()` | `RULE_EXERCISE_BELOW_MINIMUM` | the coach validator that matched **zero** person-pairs |
| A counter equals the **whole** size of a universe | `checkCoverage()` | `RULE_EXERCISE_COVERAGE_SHORT` | the round-robin rule that examined **one** division of fifteen |
| Every identifier matched is real, and is not a placeholder label | `checkIdentifiers()` | `RULE_MATCHED_PLACEHOLDER` / `RULE_MATCHED_UNKNOWN_IDENTIFIER` | the checker that read `Select Game 7` as a team code |

All of them are **`blocking`**. A rule that cannot prove it examined the right
data has not produced a weak verdict; it has produced no verdict, and the engine
must not let its silence be counted as a pass. A rule that meets every claim
emits `RULE_EXERCISE_SATISFIED` at `info`, with its counters on the finding, so
the run carries the evidence rather than the assumption.

**Why coverage is not just a bigger minimum.** A minimum above zero is satisfied
by a rule that read one division. A round robin is a claim about a *whole*
division set; a rule that skipped one has not made the claim. `coverage` names a
universe on the schedule and demands the counter equal its size.

**Why the shape check exists at all.** The corpus is full of cells that are not
identifiers: `Away === '-'`, `MinisA`..`MinisD`, `Select Game 1`..`Select Game
10`, `Scrimmage - teams TBD`, and non-member opponents like `Visiting Club A -
U14B South`. Every one of those is a real cell in `combined_schedule.csv`. A
rule that treats them as team codes matches *more* data than the correct rule
and reports phantom violations at a higher rate, so every count-based
expectation passes. Only a claim about the shape of the match catches it, and
that claim is checked against the schedule's own `teamUniverse`,
`personUniverse`, … and `placeholderLabels`.

---

## 3. The schedule carries its own universes

```js
{
  games, commitments, teams,
  teamUniverse, personUniverse, divisionUniverse, surfaceUniverse, venueUniverse,
  placeholderLabels,
}
```

The universes are **not** derived from `games` by the schema: a universe derived
from the rows it is meant to police cannot police them. `adapters/season2026Schedule.js`
supplies them, and is the layer that refuses the loader's lenient `teamId`s —
`season2026Parsers.js` sets `homeTeamId` to the raw `Home` cell unless that cell
announces itself as a placeholder, which is right for a loader that must drop no
rows and wrong for anything that then joins on it. The adapter's rule: **a team
identifier is a member of the roster's team universe or it is not a team
identifier**, and everything else that ever appeared in a `Home` or `Away` cell
becomes `placeholderLabels`.

---

## 4. The standing rule set

Ten rules covering twelve of the fourteen seeded constraints.

| Rule | Enforces | Driven by | Key expectation |
| --- | --- | --- | --- |
| `field-same-ground` | `field-same-ground-exclusive` | `surfacesConflict()` | > 0 concurrent pairs compared |
| `field-adjacency` | `field-overlap-adjacency` | `surfacesConflict()` | **> 0 concurrent field pairs**, > 0 overlap pairs in the graph |
| `field-eligibility` | *(none — reported)* | `checkKickoffAvailability()` | > 0 games, > 0 surfaces |
| `permit-window` | `permit-window` | `checkKickoffAvailability()` | > 0 permit windows consulted |
| `sunset-margin` | `sunset-margin` | `checkKickoffAvailability()` | > 0 **unlit** games examined |
| `turnover-minimum` | the three turnover records | `resolvePolicy()` per venue | > 0 consecutive pairs, > 0 policies resolved |
| `coach-conflict` | both coach-travel records | `evaluateCoachTravel()` | **> 0 person-pairs**, > 0 people, > 0 commitments |
| `round-robin` | `round-robin-completeness` | `resolvePolicy()` | **every division examined** |
| `home-away-balance` | `home-away-balance` | `resolvePolicy()` | > 0 teams, > 0 games counted |
| `conflict-fairness` | `conflict-fairness` | roster + commitments | > 0 groups, > 0 teams, > 0 commitment pairs |

Nothing here re-derives a conflict, a permit window, a sunset or a travel gap.
The five rules with no Phase 1 evaluator behind them read their numbers from the
**constraint record** via `resolvePolicy()`, and take their severity from that
record's `type` via `severityForType()` — so retyping `round-robin-completeness`
to a preference turns every `ROUND_ROBIN_INCOMPLETE` into an `info` with no edit
to any rule. That is [GAP-12](MODEL_GAPS.md#gap-12) working through a third
module without a branch anywhere.

Two codes are deliberately **ungovernable** by a record — `TURNOVER_UNJUDGED`
and `ROUND_ROBIN_DIVISION_UNJUDGED`. They say *"this rule could not decide"*,
which is a fact about the evidence rather than a policy position, and letting a
`preference` record demote them to `info` would let a schedule reach `allowed`
on the strength of questions nobody answered.

---

## 5. What nothing checks is reported, never assumed satisfied

Ten of the fourteen seeded constraints are `declared-only` — the registry's word
for "claims no Phase 1 reason code". The rule engine is a **second enforcement
path**, so eight of those ten now have a rule, and each such pairing is recorded
as `RULE_ENFORCES_DECLARED_ONLY` (`info`) rather than being quietly reconciled.

The remaining two — `coach-maximum-gap` and `kickoff-variety` — have no rule.
Both are `preference`-typed, which by the registry's own definition means
*"optimise toward; no violation concept"*: there is nothing for a validator to
report. They are reported as `RULE_CONSTRAINT_UNENFORCED` at **`compromise`**,
and `unenforcedConstraintIds` is a first-class field of the report.

This is itself an incident-4 class trap. An engine that reported "all
constraints pass" while some of them are unenforceable is the same lie as a
validator that matched nothing, only at the scale of the whole system.

Symmetrically, a rule that enforces **no** constraint is reported too:
`field-eligibility` checks size, line markings, equipment and format timing, and
the club never wrote a constraint record about any of them. Inventing one to
make the coverage table symmetric would be a fabrication.

---

## 6. What a violation reports

```js
{
  ruleId, code, severity, baseSeverity,
  constraintId, constraintIds,
  subjectId,
  entities: [{ kind: 'person', id: '…' }, { kind: 'venue', id: '…' }, …],
  computed: { gapMinutes: 50, minimumGapMinutes: 60, shortfallMinutes: 10 },
  summary: 'gap 50 min, minimum gap 60 min, shortfall 10 min',
  message,
  waived, waiverId, waivedBy,
  details,
}
```

`severity` is the **effective** one — after the registry's severity table has
spoken and after any waiver has demoted a `blocking` to a `compromise`.
`baseSeverity` is what it was before either, because a schedule that is legal
only because a constraint is currently a preference has to be able to say so.
`entities` carries **ids only, never labels**: a violation that names
`Select Game 7` as a team is the phantom incident 4's second checker reported.

---

## 7. Waivers integrate; they do not bypass

The engine hands every rule's subjects to `applyWaivers()` in one call and runs
`detectDormantWaivers()` over the same set. It adds nothing to that machinery
and takes nothing away — [Waivers](WAIVERS.md) §4 already guarantees that a
waived finding is kept, re-severitied, stamped with the approver, and
accompanied by a `compromise`-level `WAIVER_APPLIED` so a waived subject can
never derive `allowed`.

The one thing the engine contributes is the `constraintIdByCode` map the applier
needs for `declared-only` constraints, **derived from the rule definitions**
rather than hand-maintained. A rule that stops claiming a code stops linking it.
And `TRAVEL_COMMITMENTS_OVERLAP` maps to the empty list on purpose: a coach in
two places at once is not a travel policy, and no board signature moves it.

---

## 8. The full-schedule validation report

`buildValidationReport(result)` groups violations by severity with counts, plus
counts by code, by rule and by constraint. Three things it deliberately does
**not** do:

- it does not drop waived violations — they are counted, grouped, and counted
  again under `waivedCount`;
- it does not omit a severity whose count is zero, because a group that vanishes
  when empty makes "no blocking violations" and "blocking was never computed"
  render identically;
- it does not hide `unenforcedConstraintIds` or `underExercisedRuleIds`.

And it carries **its own** meta-assertions. A report is precisely where a
vacuous run stops looking vacuous: every count is a number, every group is
present, the severities all read zero, and the page looks exactly like a clean
season. `REPORT_VACUOUS` and `REPORT_NO_RULE_EXERCISED` are `blocking` for that
reason.

---

## 9. The known-good fixture run

`tests/ruleEngine.test.js` runs the engine over the published season-2026
combined schedule and asserts it produces **exactly** this set of accepted
exceptions — 62 violations, 7 `blocking` and 55 `compromise`, and no others:

| Code | Count | Severity | Why it is expected |
| --- | --- | --- | --- |
| `SIZE_UNKNOWN_FORMAT` | 4 | blocking | The four `Scrimmage` rows have no `game_formats.csv` entry, so the format cannot be ranked against the surface's declared sizes ([GAP-14](MODEL_GAPS.md#gap-14), Prompt 1.3). |
| `FORMAT_TIMING_UNDEFINED` | 4 | compromise | The same four rows: no timing row, so no declared occupancy. |
| `OCCUPANCY_FOOTPRINT_UNKNOWN` | 4 | compromise | The same four rows again: with no known end, concurrency cannot be decided. |
| `LINING_MISMATCH` | 40 | compromise | 36 Minis sessions on ground that is big enough and not lined for Minis, plus the 4 `Scrimmage` rows whose format cannot be checked against lining. |
| `TRAVEL_BETWEEN_VENUES_TOO_SHORT` | 1 | compromise | The 60-minute inter-venue floor is `soft`, and the published season breaks it exactly once: `gray judd` on 2026-08-22, a rec 7v7 at Brookside Park ending 11:10 and an 11v11 at Alder Park at 12:00, 50 minutes apart. That is incident 9's own scenario, and the case its waiver covers. |
| `TRAVEL_COMMITMENTS_OVERLAP` | 3 | blocking | The corpus's own *"3 rec games are single-coach (a co-coach covered)"*. The overlap is real; the corpus records how it was handled, not that it did not happen. |
| `ROUND_ROBIN_DIVISION_UNJUDGED` | 5 | compromise | The Minis division `BB` has no two named teams, so no round robin can be judged in it — and, since the division universe became roster-derived, the four Select divisions (`U14`, `16BS`, `16GS`, `U16G`) join it: rostered teams whose layer is external fixtures and reserved slots, so they have no two-sided counted games either. Reported unjudged rather than never looked at. |
| `TURNOVER_UNJUDGED` | 1 | compromise | One consecutive pair on one surface whose earlier row is a `Scrimmage` of unknown footprint. |

This baseline read **18** across five coaches until `Maplewood Back` and
`Maplewood Front` were declared one venue complex (see
[Waivers §6.1](WAIVERS.md#61-one-venue-complex-declared)). Seventeen of the
eighteen were `Maplewood Back` → `Maplewood Front` moves of 30–50 minutes —
a walk across one park, judged against a drive between two. They are now
measured against the 15-minute walking floor, which every one of them clears,
and each carries an `info` `TRAVEL_WITHIN_COMPLEX_CROSS_VENUE` note saying which
floor applied and why. One board waiver implies one genuine inter-venue case,
not five coaches with eighteen.

The coach rule therefore takes the season's declared complexes as a **required**
resource (`resources.venueComplexes`). A run that supplied none would silently
go back to judging every distinct venue name against the drive floor; a club
with no complexes says so by passing `EMPTY_VENUE_COMPLEX_MAP`.

Every corpus invariant the README states as known-good comes back clean:
adjacency, permits, sunset margin, hosting balance and conflict fairness all
report **zero** violations, with their exercise counters proving they looked.

---

## 10. The deliberate-break tests

Both halves of incident 4, reproduced against the same corpus.

**(a) The join that matches nothing.** The roster's team codes are renamed back
to the old `U12B04` style while the schedule keeps `12B9v904`, and the join
empties. The coach rule reports **zero conflicts** — exactly what the source
project shipped — and the engine reports `RULE_EXERCISE_BELOW_MINIMUM` at
`blocking` with `personPairsCompared: 0, required: 1`. The run's status is
`rejected` even though the silenced rule reports nothing at all and the run
sheds every `blocking` violation the coach timeline carried — the shape of the
original failure: the broken schedule looks better where anybody was looking.
Its *total* violation count actually rises, because the same rename also leaves
all fifteen divisions unjudged, which is the point rather than an
inconvenience: no comparison of counts decides this, the engine's own exercise
verdict does. One rename silences four rules at once, and each of them says
so.

**(b) The join that matches the wrong data.** The schedule is rebuilt taking
team ids straight from the `Home` and `Away` cells. Phantom
`GAMES_PLAYED_OFF_TARGET` and `HOME_AWAY_OUT_OF_RANGE` violations duly appear
that the correct schedule does not have — the broken checker reports *more* —
and every minimum the rules declare is comfortably met. Only the shape check
fires: `RULE_MATCHED_PLACEHOLDER` at `blocking`, naming
`Visiting Club A - U14B South` and its siblings.

Each break test asserts that its own mutation actually applied before asserting
anything about the result. A break test whose break silently failed to apply is
the same bug wearing a test's clothes.
