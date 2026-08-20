# The minimal-diff objective, the change budget and the dry run

Phase 4.2. What a re-solve optimises **for**, what it is allowed to spend, and
why nothing it produces is a schedule until somebody says so a second time.

The sentence the phase turns on is in the build plan:

> Today the objective optimises quality alone, so a re-solve returns the best
> schedule it can find rather than the nearest acceptable one. **Once a schedule
> is published, "nearest" almost always beats "best."**

Phase 4.1 answered the first half of that — [`FREEZE_SCOPES.md`](FREEZE_SCOPES.md),
incident 1's 366-game reshuffle — with a **hold rule**: a legal game is never
moved, because nothing in the pipeline could reward moving it. That is a policy
expressed as an absence. This phase gives it a number, so that "nearest beats
best" becomes something the solver trades against quality rather than something
it cannot express.

Code: `packages/core/src/resolve/objective.js` (the objective),
`report.js` (the dry run), `commit.js` (the second step). Tests:
`tests/minimalDiff.test.js`. In-memory only, exactly as Phases 1–4.1: there is
still no SQL home for a resolve run or a committed schedule, and this work
deliberately does not create one.

---

## 1. One objective, and the reason the file is shaped that way

[`ARCHITECTURE.md`](ARCHITECTURE.md) §6.10 records that this repository already
carries **two** fitness functions — `autoScheduler.computeFitness()` and a
diverged hand-port inside `supabase/functions/auto-scheduler/index.ts` — with
different coefficients, different terms, and nothing that detects the drift
between them. A third would not be a feature. It would be the same defect a
third time.

So `objective.js` is arranged around one guarantee: **`scoreObjective()` is the
only function in `resolve/` that multiplies a count by a weight.** Everything
else counts. `candidateObjectiveCounts()` counts what one candidate slot would
cost; `objectiveCountsForSchedule()` counts what a whole schedule costs against
a reference; both hand a bag of counted terms to the one scorer with the one
table.

`tests/minimalDiff.test.js` asserts that structurally rather than trusting it:

- exactly one file declares `RESOLVE_OBJECTIVE_WEIGHTS`;
- exactly one file multiplies by a weight, **and** exactly one file reads a
  single term's weight out of the table at all;
- neither `resolve/` nor `freeze/` contains the string `fitness`, imports
  `autoScheduler.js`, `gameMetrics.js` or `gameScheduling.js`;
- and — the check that catches the failure an import graph cannot see — the term
  names `changedGame` and `compromiseViolation` appear **nowhere else in the
  repository**: not in the rest of `packages/core`, not in
  `supabase/functions/`, not in `frontend/src/`. A hand-port is a copy, not an
  import, and the existing hand-port says so in its own header comment.

### The terms

| family | term | counted |
| --- | --- | --- |
| change | `changedGame` | one game whose slot differs from the reference |
| change | `driftMinute` | one minute of kickoff drift, **same date only** |
| change | `changedSurface` | one game standing on different ground |
| quality | `unplacedGame` | one game left with no time (incident 10) |
| quality | `blockingViolation` | one blocking violation or placement finding |
| quality | `compromiseViolation` | one compromise violation or placement finding |

Weights are **policy, not data** — nothing in the corpus can supply them — so
what the tests pin is the ordering they express, and every one of them is
overridable per run:

```text
unplacedGame > blockingViolation > changedGame > compromiseViolation > driftMinute = changedSurface
```

Read as sentences: a game with no time is worse than an illegal one; an illegal
game is worse than ten moved ones; **a moved game is worse than ten
compromises**, which is the whole of "nearest beats best"; and how far a game
moved only separates slots that are otherwise equal.

`driftMinute` is counted only when the two slots fall on the same date. Minutes
past midnight on two different days are not a distance, and this package
constructs no `Date` and holds no season calendar that could make them one
(GAP-32). A game that changed date pays `changedGame`, and no invented drift.

### It replaced two hand-written orderings

`candidateSlotsFor()` used to carry `'baseline-first'` (nearest to the anchor,
for a change request) and `'earliest-first'` (for a global re-solve). Those were
the minimal-diff policy and its absence, written as two sort comparators. Both
are now the same comparator asking the objective what a candidate costs, and
`chooseSlot()` in `stages.js` — the single place a slot is chosen, shared by
`initial-assignment`, `local-search` and `pair-repair` — walks that ordering and
scores each candidate through the same one function.

Two exact short-circuits keep it about as cheap as "first legal slot" was: the
candidates arrive ordered by change cost ascending and every quality term is
non-negative, so a scan can stop once a candidate's change cost alone reaches
the best total found so far, and can stop outright at a candidate scoring zero.
Neither changes the answer.

---

## 2. The change budget

```js
applyChangeRequest({ schedule, changes, engines, changeBudget: 12 });
```

An optional hard cap on **games that move — requested and consequential
together**. An operator told "12" who gets 7 they asked for plus 7 nobody asked
about has not been given a budget; they have been given a headline. The report
still splits the two, so a breach says which half drove it.

Exceeding it is `RESOLVE_CHANGE_BUDGET_EXCEEDED` at **blocking**, carrying the
counts and **the registry constraint ids that forced the consequential half** —
not a silent large diff. Coming in under it is `RESOLVE_CHANGE_BUDGET_MET` at
`info`, because a budget nothing reports on cannot be told apart from a budget
nobody checked.

`commitResolve()` refuses a run that breached its budget and **offers no
override**. Every other blocking finding can be accepted by code; this one
cannot. A cap an operator can wave through under pressure is a cap that will be
waved through under pressure, and a caller willing to move more games says so by
naming a bigger number — which leaves a record of the number they agreed to.

---

## 3. Dry run by default; commit is a different verb

This is an **API shape**, not a paragraph of documentation.

```js
const run = applyChangeRequest({ schedule, changes, engines }); // run.committed === false
const committed = commitResolve(run, { acknowledged: true }); // committed.committed === true
```

Neither entry point takes a `commit` flag; neither can produce a committed
result however it is called; both stamp `RESOLVE_DRY_RUN` on every run. The only
function in the package that can produce `committed: true` is `commitResolve()`,
and a structural test asserts exactly that — the same shape, and the same test
idiom, that Prompt 4.1 gave `reoptimiseWholeSeason()` as the one door to a
thawed default.

What `commitResolve()` refuses:

| situation | answer |
| --- | --- |
| `acknowledged` is not the literal `true` | `TypeError` — `1`, `'yes'` and `{}` are truthy and none is somebody saying yes |
| the change budget was exceeded | `ChangeBudgetExceeded`, **no override** |
| any other blocking finding | throws, naming each code, unless listed in `acceptFindingCodes` |
| quality was never measured (`verify: false`) | throws unless `RESOLVE_REPORT_QUALITY_UNMEASURED` is accepted by name |

The last one matters more than it looks. "No quality delta" and "no quality
delta measured" are the same sentence to a tired operator and only one of them
is good news. The accepted codes are recorded on the commit: accepting a finding
is a decision, and a decision that leaves no trace is the shape incident 9's
board waiver went missing in.

---

## 4. The report, and why category (b) is the deliverable

> *"Structure the report as (a) games you asked to change, (b) games that moved
> as a consequence, with the constraint that forced each, and (c) quality
> deltas. Category (b) is the one that matters — it's what nobody notices until
> families complain."*

**(a) is enumerated from the change request**, including the changes that did
*not* happen — `applied`, `displaced`, `refused`, `no-op`, `unplaced`,
`unknown-game`. "We ignored four of your eight fixtures" is the most useful line
a report can carry and a list built from what moved cannot contain it.

**(b) is enumerated from the baseline schedule**, through
`diffAgainstBaseline()`, with (a) subtracted. Never from the move ledger: a
stage that wrote around the mutation gate is absent from the ledger, and a list
assembled from the ledger would report a quiet season while half of it had
moved. Each entry carries:

| field | from |
| --- | --- |
| `codes` | the reason codes that grew, from `checkPlacement()` |
| `constraintId` / `constraintIds` | the Phase 2.1 registry's `idsByReasonCode` |
| `counterpartGameIds` | the **specific other games** it clashed with |
| `bindingKinds` / `slackMinutes` | Phase 1.3's tightness ordering — which edge bound, by how much |
| `forcedByStageId` | the stage that decided |
| `personIds` | whose Saturday changed, from the schedule's own commitments |

Nothing there is re-derived. The deciding stage records a machine-readable
`cause` on the move, and the report reads the **first** cause in each game's
slice of the ledger — the move that lifted it out is the one that knows why it
had to move at all, and everything after that is that decision playing out.

**A consequential move with no cause is a bug**, reported as
`RESOLVE_CONSEQUENTIAL_MOVE_UNEXPLAINED` at blocking, with a positive control in
the test file: a stage that reaches around the writer produces a game that moved
with nothing able to say why, and the report must catch it.

**(c) quality deltas** come from the standing rule engine, per code and per
severity, before against after, alongside the objective's own two totals.

### The commitment fix category (b) needed

`resolvedScheduleOf()` used to hand the rule engine the **baseline's**
commitments alongside the resolved games, so every re-solve was judged on where
the coaches used to be. A knock-on that stranded a coach was invisible, and a
move that repaired one still reported the shortfall. A commitment now follows
its game; a commitment to a game with no time left does not travel, because the
game itself is carried as TIME TBD with a reason and that is where it is
reported.

Category (b) is unreadable without that. It is also why one of Phase 4.1's
assertions moved: the run that raises `FrozenGameUnsatisfiable` on the held
12:30 fixture used to carry one coach-travel violation about the fixture, and
now carries none — because moving the fixture thirty minutes later genuinely
repaired that coach's gap, which the stale commitment had hidden.

---

## 5. What the corpus says

All figures derived at test time from `fixtures/season-2026/`.

| scenario | moved | requested | consequential | note |
| --- | ---: | ---: | ---: | --- |
| The eight external fixtures, maximum freeze (4.1's acceptance test) | 2 | 2 | 0 | nothing outside the two dates moves |
| **08/22 seeding integration**: the 9v9 block asked to move, date thawed, held | 8 | 4 | 4 | each consequential move names `field-same-ground-exclusive`, its counterpart game, and its coaches |
| The same, budgeted at 12 | 8 | 4 | 4 | under the cap; `RESOLVE_CHANGE_BUDGET_MET` |
| **Constructed**: Maplewood Back's middle wave slid onto the late kickoff | 14 | 7 | 7 | over the cap; blocking, naming `field-same-ground-exclusive`; commit refused |
| `reoptimiseWholeSeason()`, default objective | 8 | 4 | 4 | all on the affected dates; four games end TIME TBD |
| `reoptimiseWholeSeason()`, change terms at zero | 311 | — | — | 275 of them outside the two affected dates |

The last two rows are the phase in one comparison. **The same operation, the
same freeze plan, the same 679 rows, and the only difference is the objective**:
under the weights the module ships with a global re-optimisation moves eight
games, and with change minimisation switched off it moves 311. Until 4.2 the
second was the only behaviour available, and "global re-optimisation" was a
synonym for a reshuffle.

The 311/275 figures are exactly what Phase 4.1 recorded for its positive
control, reproduced by setting three weights to zero rather than by a separate
`earliest-first` code path. Being able to rebuild the incident-1 solver out of
the objective, and get the same season back, is the evidence that the objective
replaced the ordering rather than merely joining it.

The default-weight global re-solve is not free, and the objective says so: the
placer runs in one pass with no backtracking, so the four 9v9 games the held
12:30 fixture overlaps find no slot left on the date and are carried as TIME TBD
(incident 10) rather than dropped. An unplaced game is the most expensive thing
the objective knows, so that run scores **worse** than the scoped change request
— which is the correct verdict on it, and the reason the scoped path remains the
one a change request takes.

### The 08/22 scenario is the branch the club did not take

Incident 3 is the externally-published 12:30 fixture whose 90-minute footprint
overlaps the published 9v9 block by exactly ten minutes; it was resolved by
negotiating the external time earlier. The acceptance scenario here is the other
branch — moving the 9v9 games instead — because that is the one the build plan's
acceptance test names. The corpus supplies every part of it: the two 9v9 waves,
the shared ground, the coach timelines the knock-on lands on. What had to be
*chosen* was the freeze plan (the date thawed, so a knock-on is possible at all)
and `holdChanges` (so the requested times are facts rather than preferences).

The knock-on reaches coach assignments exactly as the plan predicts: two coaches
end up short of the between-venues travel floor, reported in category (c) and
visible only because commitments now follow their games.

---

## 6. What this phase still does not do

- **Persist anything.** No SQL home for a resolve run, a report or a committed
  schedule; GAP-29's stored half stays open, along with published-baseline
  versioning.
- **Backtrack.** The placer is greedy and one-pass. When a game's own slot is
  gone it takes the best remaining one, and if none is legal it becomes TIME
  TBD. The objective scores that honestly rather than hiding it.
- **Optimise anything the rule engine owns.** Turnover floors, round-robin
  completeness and coach travel are still *reported* rather than repaired. The
  quality terms let a placer prefer a slot that breaks fewer of them; nothing
  here re-solves a season to improve one.
- **Touch the two shipping solvers.** `gameScheduling.js`, `autoScheduler.js`
  and `gameMetrics.js` are unchanged, and the structural tests keep it that way.
