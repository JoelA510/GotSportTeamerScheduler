# Waivers

Phase 2.2. Exceptions to constraints as **records with a lifecycle**, so an
approved exception can be found, explained, applied visibly, and retired when it
stops doing anything.

The incident this answers is number 9 in
[`fixtures/season-2026/README.md`](../fixtures/season-2026/README.md):

> **A board waiver with a lifecycle.** A 60-minute travel floor was waived for
> one coach because two venues are ~5 minutes apart; the waiver then became
> unnecessary when times shifted, then relevant again. It lived in a code
> comment and was lost once across a rebuild.

Four failures in one sentence, and the model answers each:

| Failure | Answer |
| --- | --- |
| It lived in a code comment | a record with a required `reason`, `approval.approvedBy` and `approval.reference` |
| It was lost across a rebuild | `reconcileWaiverLedger()` — a waiver whose constraint the registry no longer holds is `blocking` |
| It became unnecessary | `detectDormantWaivers()` — computed per solve, never stored |
| It became relevant again | dormancy is computed, so nothing has to be un-cached |

The model answers [GAP-26](MODEL_GAPS.md#gap-26) and depends on
[GAP-12](MODEL_GAPS.md#gap-12) — a waiver is an exception *to* a constraint, so
the [constraint registry](CONSTRAINT_REGISTRY.md) is a prerequisite.

Code: `packages/core/src/waivers/` (barrel at `index.js`). In-memory only —
there is no SQL home for waiver records and this phase deliberately does not
create one.

---

## 1. What a waiver record carries

| Field | Meaning |
| --- | --- |
| `id` | Stable identity. |
| `constraintId` | The constraint this excepts. Must exist, and must be `waivable`. |
| `scope` | Which person / team / game / venues / surface / division / date(s). **Several dimensions at once**, composing as a conjunction. |
| `reasonCodes` | The codes it excuses. Empty means "everything the constraint governs". |
| `reason` | Why the exception was granted. Required. |
| `approval` | `approvedBy`, `approvedAt` (nullable), `reference` (required), `note`. |
| `effectiveFrom` / `effectiveTo` | The optional expiry. Inclusive ISO dates. |
| `parameters` | The facts the approval rested on, e.g. `{ observedTravelMinutes: 5 }`. |

**A waiver scope may name several dimensions; a constraint scope may not.** That
is deliberate, not an inconsistency. Constraint precedence rests on a
specificity *rank*, and a two-axis scope has no defensible rank against a
one-axis scope. Waivers never compete for precedence — two that both apply both
apply — so the objection does not transfer, and incident 9's waiver genuinely is
two-dimensional: *this coach*, *between these two venues*.

`venueIds` is the **set the approval covers**: a subject matches when every
venue it touches is in that set. "These two sites are five minutes apart" is a
statement about a pair, and a journey that also visits a third venue is not the
thing the board approved.

**Provenance discipline** mirrors `ConstraintSource`. `approvedBy` and
`reference` are required; `approvedAt` is nullable because incident 9's approval
survives only as a sentence in the log, and the schema then requires a `note`
saying why the date is missing. An invented date would be worse than an admitted
absence.

---

## 2. "Waived, not clean" is an enum, not a boolean

Every waiver-aware result reports **two** values, both derived mechanically:

- **`status`** — the Phase 1 three-state (`allowed` / `compromised` /
  `rejected`), from the finding severities, as everywhere else;
- **`disposition`** — from the 2×2 of *did a waiver fire* and *is a violation
  still uncovered*.

| | no violation left uncovered | a violation left uncovered |
| --- | --- | --- |
| **no waiver fired** | `clean` | `unwaived` |
| **a waiver fired** | `waived` | `waived-partial` |

A violation is any finding at `blocking` or `compromise`; `info` findings are
provenance and never move the disposition.

This is the answer to "a waived violation is closest to `compromised` but must
be distinguishable from an ordinary compromise". A 7v7 on a 9v9-lined pitch and
a board-approved travel breach both report status `compromised`. Only one of
them reports disposition `waived`.

### Three mechanisms make "never silently" mechanical

1. **The violation is kept, not deleted.** It is re-severitied from `blocking`
   to `compromise` and stamped with `details.waived`, `details.waiverId`,
   `details.waivedBy` and `details.severityBeforeWaiver`. Same treatment
   `constraints/severity.js` gives a demoted finding, and for the same reason.
2. **`WAIVER_APPLIED` is a `compromise`, not an `info`.** Because
   `deriveWaiverStatus()` reads severities and nothing else, a subject carrying
   it **cannot** derive `allowed`. Waived and clean are separated by the status
   machinery rather than by anybody's diligence.
3. **A `blocking` waived violation never becomes `allowed`**, only
   `compromised`. There is no path from "signed off" to "fine".

---

## 3. Composition with constraint scope

A waiver reaches a subject when all of:

1. it is **live** on the subject's date (`WAIVER_NOT_YET_EFFECTIVE` /
   `WAIVER_EXPIRED` at `info`; a window with no date in the subject is
   `WAIVER_WINDOW_UNJUDGED` at `compromise` — not a pass);
2. **every dimension it names matches** (a dimension the subject does not carry
   is `WAIVER_SCOPE_UNJUDGED` at `compromise`, never "close enough");
3. it is **no broader than the constraint it excepts** — otherwise
   `WAIVER_BROADER_THAN_CONSTRAINT` at `compromise`. It is still applied; the
   operator wrote it down. Nobody gets to be surprised by it later.

`WAIVER_SCOPE_SPECIFICITY` uses exactly the integers
`CONSTRAINT_SCOPE_SPECIFICITY` uses, so step 3 is a meaningful comparison rather
than a coincidental one.

---

## 4. Dormancy detection

`detectDormantWaivers(subjects, { ledger, registry })` evaluates the solve
**twice per waiver** — once with the ledger and once with the ledger minus that
record — and diffs. That is the shape `whatIfConstraintType()` already uses in
Prompt 2.1, reused rather than reinvented: there should be one way in this
codebase to ask a counterfactual question.

Two verdicts, because one boolean would hide a real distinction:

| Field | Meaning |
| --- | --- |
| `dormant` | It covered **nothing**. There is no violation for it to excuse. Incident 9's middle act. |
| `changesStatus` | Some subject's three-state verdict depends on it. |
| `retirementCandidate` | `!changesStatus` — covers both dormant waivers and ones that fire but decide nothing. |

A waiver can fire (so it is not dormant) and still change no verdict, when the
violation it covers is a `compromise` either way. That is weaker than dormant
and gets its own code, `WAIVER_NOT_STATUS_BEARING`, rather than being rounded
into one of the other answers.

**Computed, never cached.** No field of `WaiverRecord` says whether a waiver is
dormant, and `WaiverRecordSchema` is `.strict()`, so a record that tries to
carry one is rejected rather than believed. Incident 9's waiver was unnecessary
and then necessary again without a character of it changing; a stored flag would
have been wrong twice.

---

## 5. Published output

`annotations.js` supplies row-level annotation data keyed by the subject id the
caller used — structured fields plus a `Notes`-ready one-line `note`. It does
**not** rewire `outputGeneration.js`: `generateScheduleExports()` is the
published-CSV contract, this phase's diff is additive, and the wiring is a
follow-up. The `Notes` column already exists in `MASTER_HEADERS`, and
`waiverNotesBySubject()` returns exactly what belongs in it.

Subjects with no waiver are **absent** from that map rather than present with an
empty string, so a caller can tell "no waiver here" from "a waiver that renders
to nothing".

---

## 6. The coach-travel evaluator, and what it is not

`waivers/coachTravel.js` is a **narrow evaluator**, and the honest statement of
its status matters more than its code.

Prompt 2.1 recorded the 60-minute travel floor as a constraint
(`coach-travel-between-venues`, `soft`, `waivable`, `minimumGapMinutes: 60`) but
recorded it as **`declared-only`**: no module emits a coach-travel reason code,
because the person-centric timeline that would produce one is Prompt 3.1. A
waiver engine with nothing to waive is a waiver engine nobody has tested, so
this module supplies the missing evaluation — narrowly:

- it takes an **explicit list of commitments**; it does not build them (no
  roster join, no identity resolution, no external-commitment ingestion — that
  is GAP-19 and Prompt 3.1);
- it judges **consecutive same-day pairs for one person** and nothing else;
- it reads its numbers from the registry via `resolvePolicy()`, so there is no
  second copy of "60" to find later.

### 6.1 One venue complex, declared

Which floor applies is decided by
[`facility/venueComplex.js`](../packages/core/src/facility/venueComplex.js), not
by `from.venueId === to.venueId`.

Prompt 2.1 seeded the walking rule as *"15 min within one venue complex"*, but
nothing could express **which named venues form one complex**, so name equality
was the whole test and the rule was structurally unreachable for the case it
was written for: it could only ever fire for two commitments at the *identical*
venue. On the published season-2026 schedule that misread produced 18
inter-venue shortfalls across five coaches — 17 of them `Maplewood Back` →
`Maplewood Front`, gaps of 30–50 minutes, a walk across one park judged as a
drive. Incident 9 records the board waiving the floor for **one** coach because
two sites are ~5 minutes apart; one waiver implies one genuine inter-venue
case, not five.

The model lives in `facility/` because that package owns venue identity, and
deliberately **not** on the facility graph: containment and overlap are
intra-venue statements about bookable ground and no check built on them would
be changed by a complex, while a complex answers a different question — how
long a person takes to get across. Putting it on the graph would invite an
occupancy check to read "one complex" as "one patch of ground".

A complex is **declared data**. There is no rule turning `"Maplewood Back"`
into `"Maplewood"`: a shared word is not a fact about geography, and a
heuristic would merge any two sites that happened to share one. The season-2026
complex is seeded in
`facility/adapters/season2026Geometry.js` as an operator statement of standing
practice, with that provenance recorded on the record — the same footing as the
15-minute figure itself, which no corpus file carries either. The builder
throws on a duplicate id, a one-venue complex, or a venue claimed twice.

The map is a parameter of `evaluateCoachTravel()`, defaulting to
`EMPTY_VENUE_COMPLEX_MAP` — which reproduces venue-name equality exactly,
because a venue is always its own site. The rule engine does **not** default:
`coachConflictRule` demands `resources.venueComplexes`, so a season run cannot
silently lose it.

When two venues in one complex are judged as one site, the transition carries an
`info` **`TRAVEL_WITHIN_COMPLEX_CROSS_VENUE`** finding whether or not the gap
passes, naming the complex and the floor that applied. A reader seeing a
30-minute gap measured against 15 minutes needs to be told *why* that was the
applicable rule; silence would leave the 60-minute floor looking forgotten.
`sameVenue` and `sameComplex` are both kept on the transition, and they are not
the same claim — `!sameVenue && sameComplex` is precisely the Maplewood case.

**Severity comes from the constraint record's own `type`**, through
`severityForType()` — the same frozen table `constraints/severity.js` uses. A
`soft` travel record makes a short gap a `compromise`; retype the record to
`hard` and the identical gap becomes `blocking`, with no edit to the evaluator.
`TRAVEL_REASON_SEVERITY` is only the fallback for "no record governs this
policy at all".

**The travel codes are deliberately not registered in `BASE_REASON_SEVERITY`.**
Registering them there is precisely the act of saying "a constraint record may
claim this code", and the seeded coach-travel record must not claim one while
nothing generalises this evaluator to the whole season. The registry does not
enforce coach travel today and this phase does not pretend it does. When Prompt
3.1 lands, the expected disposition is: these codes move to the module that owns
personal timelines, get registered, and the coach-travel constraint stops being
`declared-only` — at which point `travelConstraintIdByCode()` becomes
unnecessary because `registry.idsByReasonCode` answers the same question.

The waiver module's **own** codes stay out of `BASE_REASON_SEVERITY`
permanently, for a different reason: no constraint governs `WAIVER_APPLIED`, and
registering it would let a record claim to set its hardness.

---

## 7. The seeded season-2026 waiver

`waivers/adapters/season2026Waivers.js` transcribes incident 9 — and **takes
arguments**, unlike `season2026Constraints.js`, which takes none.

The log records that a waiver existed, what it was for, why it was granted, who
granted it and that no date survives. It does **not** name the coach or the two
venues. That is not an oversight in the log; it *is* the incident. So the
subject is a parameter: the caller derives it from the corpus, and inventing a
person id inside `packages/core` would be both a fabrication and a needless
piece of PII in the repository.

### The acceptance scenario is real

`tests/waiverLedger.test.js` searches `coach_roster.csv` +
`combined_schedule.csv` for the shape the incident describes — one person, two
venues, one day, a gap under the floor, where the later fixture is one the
external league also published — and asserts the corpus contains **exactly
one**. It does, and it matches the acceptance text exactly: a rec 7v7 ending
11:10 AM at one venue and an 11v11 league fixture at 12:00 PM at another, 50
minutes apart.

The counterfactual is real too. `external_fixtures_published.csv` is the
external league's own publication of that same fixture at **12:30 PM**; the
final agreement moved it to 12:00 (incident 3). So "re-solved with the league
game at 12:30" is a re-solve against a real row in a real file, and the waiver
is reported dormant there.

Both hardnesses are exercised. Under the seeded `soft` record the gap is a
`compromise` with or without the waiver, and only the disposition separates
`waived` from `unwaived` — the case where a boolean would hide everything. Under
the same record retyped `hard`, the gap is `rejected` without the waiver and
`compromised` + `waived` with it, which is the acceptance text word for word.

---

## 8. Meta-assertions

Every result carries `WaiverMeta` counters and every vacuous path is a loud
failure, per incident 4:

- a duplicate waiver id is `blocking`;
- a waiver whose constraint the registry does not hold is `blocking`;
- a waiver of a `waivable: false` constraint is `blocking` and is **not**
  applied;
- an applier handed findings none of whose codes link to any constraint reports
  `WAIVER_APPLY_UNLINKED` at `compromise`;
- a dormancy scan over **zero subjects** reports `WAIVER_SCAN_VACUOUS` at
  `compromise`;
- a travel scan that found no consecutive pair to judge reports
  `TRAVEL_SCAN_VACUOUS` at `compromise`.

One deliberate non-alarm: an **empty ledger** is `info`, not `blocking` — unlike
an empty constraint registry. An empty registry makes every "allowed" answer
true for the wrong reason; an empty ledger makes every "nothing was waived"
answer true for the right one, and most seasons have no waivers at all. Equally,
subjects that carry **no findings** are not vacuous: a clean schedule is the
ordinary reason a waiver goes dormant, and crying incident 4 over the normal
case would bury the real signal.
