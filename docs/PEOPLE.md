# People, timelines and identity

Phase 3.1. The coach model reworked from **pairwise team comparison** to
**person-centric timelines**, plus the four things a timeline needs to be
trustworthy: external commitments that arrive before the solve, must-attend
derived rather than named, a fallback priority with a rule, and identity
resolution that proposes without merging.

Two incidents in
[`fixtures/season-2026/README.md`](../fixtures/season-2026/README.md) are what
this phase encodes:

> 5. **The stranded coach.** Scrimmages were appended after solving, so the
>    optimizer never saw one coach's evening commitment and left him a 6.5-hour
>    gap.
>
> 6. **"Nate" vs "Nathaniel".** One person's two roster entries differed only in
>    given-name form, hiding a real two-team coaching link across roster
>    versions — and he was the sole coach of both teams, so the hidden link had
>    no fallback.

It answers [GAP-19](MODEL_GAPS.md#gap-19) (person-centric commitment timeline),
[GAP-20](MODEL_GAPS.md#gap-20) (multi-coach teams and coach slots),
[GAP-21](MODEL_GAPS.md#gap-21) (identity resolution),
[GAP-22](MODEL_GAPS.md#gap-22) (a person entity distinct from `Profile`) and
[GAP-23](MODEL_GAPS.md#gap-23) (coach-assignment status).

Code: `packages/core/src/people/` (barrel at `index.js`). In-memory only — there
is no SQL home for a person, an assignment or a timeline, and this phase
deliberately does not create one.

---

## 1. Why a timeline and not pairwise comparison

Pairwise team comparison asks: *for a person coaching teams A and B, is every
cross pair of A's games and B's games far enough apart?* It is wrong in two
directions at once, and both arrive the moment one team plays twice in a day.

**It misses real conflicts.** A pairwise scan only looks at pairs from
*different* teams, so the transition between A's own two games — the drive from
A's 09:00 kickoff at one venue to A's 10:20 kickoff at another — is never judged.
Same team, therefore not a pair, therefore invisible.

**It invents conflicts nobody has.** It also judges pairs that are not
neighbours. With A at 09:00–10:00, A again at 10:20–11:20 and B at 10:45, a
pairwise scan measures the 45 minutes from A's *first* game to B's and reports a
travel shortfall. Nobody makes that journey: A's second game sits between them.

A timeline has neither failure mode because it asks one question — *what did this
person do next?* — of neighbours in a single sorted list, across every team and
every source.

| | pairwise | timeline |
| --- | --- | --- |
| A's 09:00 → A's 10:20, 20 min, cross-town | not judged (same team) | `TRAVEL_BETWEEN_VENUES_TOO_SHORT` |
| A's 09:00 → B's 10:45, with A's 10:20 between | `TRAVEL_BETWEEN_VENUES_TOO_SHORT` | not a transition |

`tests/people.test.js` runs both models over one constructed day and asserts both
answers, because "the timeline is better" is a claim, and a claim with no
counter-example is decoration.

**On the season-2026 corpus the two models cannot disagree**, and that is a fact
about the corpus rather than a defence of pairwise: no team plays twice on any
date (0 of 1,764 team-days), and no person coaches more than two teams, so every
person-day holds at most two commitments and *consecutive* and *cross-team* name
the same pair. The test asserts that precondition explicitly, so the day a
fixture gains a double-header the claim fails loudly instead of quietly ceasing
to be true.

### What this did *not* replace

`waivers/coachTravel.js` (Prompt 2.2) predicted in its own docstring that this
phase would absorb it. It did not, and the reason is recorded there: that
evaluator was **already** person-centric and already judged *consecutive*
same-day pairs. What it lacked was somebody to build the commitment list, which
is what `people/timeline.js` supplies through `toTravelCommitments()`. Moving the
judgement would have relocated the waiver seam — incident 9's board exception and
the ledger that excepts it — into a module with no waivers in it.

The pairwise model the build plan condemns is
`gameValidation.checkCoachConflict()`, the drag-and-drop check, which inspects
`homeTeam.coachId` / `awayTeam.coachId` and nothing else. It is untouched by this
phase and remains correct for what it does: validating a single drag against a
single other assignment.

---

## 2. The timeline, and why it can be incomplete on purpose

Incident 5 is not "a scrimmage was missing". It is *"scrimmages were appended
after solving"*. The distinguishing fact is **when**, and a plain array of
commitments cannot carry it: a timeline missing its evening looks exactly like a
timeline whose evening is genuinely free.

So a `TimelineSet` records what it was built from, and completeness is an
explicit property a consumer can require:

| Operation | What it does |
| --- | --- |
| `createTimelineSet()` | empty, unsealed |
| `ingestCommitments(set, batch, { source })` | returns a **new** set with the source declared |
| `sealTimelines(set, { requiredSources })` | seals, and reports every required source that was never ingested |
| `requireSealedTimelines(set)` | the findings a solver should refuse on |

| Reason code | Severity | When |
| --- | --- | --- |
| `TIMELINE_SOURCE_NOT_INGESTED` | `blocking` | a required source was never ingested — *the optimiser never saw it* |
| `TIMELINE_SEALED_APPEND` | `blocking` | commitments offered to a sealed set — *appended after the solve* |
| `TIMELINE_NOT_SEALED` | `blocking` | a consumer required completeness and nothing states what was required |
| `TIMELINE_SOURCE_EMPTY` | `compromise` | a source was ingested and contributed nothing — "we read it" ≠ "it had rows" |
| `COMMITMENT_FOOTPRINT_UNKNOWN` | `compromise` | GAP-14: a row with no known end, so the day around it cannot be measured |
| `TIMELINE_SCAN_VACUOUS` | `compromise` | the scan examined zero person-days |
| `FIXTURE_TEAM_UNCOACHED` | `blocking` | a fixture names a team the roster carries with no active coach, so no timeline holds it |

The four sources are `club-fixture`, `external-fixture`, `scrimmage` and
`non-club`. The last is for a commitment no schedule produced — an obligation a
person declared — and it is the reason `teamId` is nullable on a commitment.

A commitment id is `<personId>|<teamId>|<gameId>`. The team is in it because one
person can coach **both sides** of an intra-club fixture — this corpus already
carries intra-club rows — and `<personId>|<gameId>` gives that person's two
duties one id.

Unknown ends are carried rather than guessed, and every measurement across one
says so instead of returning a number:

- a person-day's `lastEndMinutes` is the **latest end**, not the end of whatever
  started last, and it is `null` when any commitment that day has no known end;
- an `AttendanceClash` whose later commitment has no known end has
  `overlapMinutes: null`. The clash is certain — it begins before the other one
  ends — but its magnitude is not, and `0` is what "no overlap" looks like.

### The 6.5-hour hole, both ways

```js
// The way it went wrong: solve on club fixtures, add the scrimmage after.
const partial = sealTimelines(
  ingestCommitments(createTimelineSet(), clubFixtures, { source: CLUB_FIXTURE }),
  { requiredSources: [CLUB_FIXTURE, SCRIMMAGE] }
);
partial.status;                       // 'rejected'
requireSealedTimelines(partial);      // [TIMELINE_SOURCE_NOT_INGESTED]
evaluatePersonDays(partial, { registry }).findings;  // no gap: there is no transition to see

// The way it should go: ingest, then seal, then judge.
const complete = sealTimelines(
  ingestCommitments(partial_before_seal, scrimmages, { source: SCRIMMAGE }),
  { requiredSources: [CLUB_FIXTURE, SCRIMMAGE] }
);
requireSealedTimelines(complete);     // []
// PERSON_DAY_GAP_EXCEEDED, gapMinutes 390, maximumGapMinutes 180
```

The corpus's own instance is 265 minutes, not 390 — an 11:50–12:55 rec game
followed by a 17:20 scrimmage at the same park — and it is visible only when the
scrimmages are on the timeline. The exact 6.5-hour figure the incident records is
constructed in the test, and labelled as constructed.

`PERSON_DAY_GAP_EXCEEDED` reads its number from the `coach-maximum-gap`
constraint record through `resolvePolicy()`, and its **severity from that
record's `type`**. The seeded record is a `preference`, so a long hole is an
`info` the optimiser should shorten; retype it to `soft` and the identical hole
becomes a `compromise`, with no code change. That is [GAP-12](MODEL_GAPS.md#gap-12)
working as intended, and it is why this module registers no severity of its own
for the code in `constraints/baseSeverity.js`.

### A fixed loader bug of the same shape

`fixtures/season2026Loader.js` `buildCoachTimelines()` used to skip rows with
`durationMinutes === null`. Since the corpus's only unknown-footprint rows are its
four `Scrimmage` entries, that skip **reproduced incident 5 inside our own
loader**: every consumer of that timeline, the rule engine included, was blind to
exactly the evening commitments the incident is about. They are now carried with
`endMinutes: null`. The rule engine's coach counters moved (`personPairsCompared`
136 → 137, `peopleExamined` 190 → 196, +9 commitments, +8 person-days) and its
accepted-exceptions baseline did not move at all: the one new transition is
judged, and it clears the walking floor.

---

## 3. Roster, coach slots and the sole-coach risk register

`Team.coachId` + `assistantCoachIds[]` loses the slot number and, worse, loses the
question. Requirement 4 needs the slot as an **order**, because "the person stays
with the team where they hold the lower coach slot" is a comparison, and a boolean
`isAssistant` cannot answer it when somebody is slot 2 on both teams.

A `CoachAssignment` carries `personId`, `teamId`, `slot` (≥ 1), `status` and an
effective window. `status` is [GAP-23](MODEL_GAPS.md#gap-23): the corpus's `Status`
column is single-valued (`Assigned`) and obviously an enum position. Only
`assigned` is active — `pending` deliberately is not, because a coach who has not
accepted is not fallback capacity, and counting them would make a sole-coach team
look covered.

`effectiveFrom`/`effectiveTo` are **applied, not merely stored**.
`buildCoachRoster(input, { asOf })` treats an assignment whose window does not
cover `asOf` as inactive, exactly as it treats a declined one, so a coach who
left in August stops being fallback capacity in September — in the sole-coach
register, in the must-attend derivation and in the co-coach search alike, none
of which needed a change, because all three read the roster's own answer about
who is active. With no `asOf` the window cannot be applied at all; the
assignment stays active and `ASSIGNMENT_WINDOW_UNJUDGED` (`compromise`) says so,
because a field that reads as enforced and is not is how incident 9's waiver got
lost. The corpus's 215 rows carry no window, so it never fires there.

**Every team the roster names is indexed, coached or not.** Indexing teams from
the active assignments alone made a team whose coaches had all declined vanish:
no `TEAM_UNCOACHED` finding, because the register never saw the team, and — since
the season adapter contributes nothing for a side it does not recognise — every
one of that team's fixtures left the timelines with nothing said about it. That
is incident 10, and `FIXTURE_TEAM_UNCOACHED` is the other half of the answer:
`season2026UncoachedFixtures()` names each fixture that lost its coaches, and
`buildSeason2026Timelines()` carries those findings into the sealed set.

`soleCoachRiskRegister(roster)` reports:

| Reason code | Severity | Corpus count |
| --- | --- | --- |
| `TEAM_SOLE_COACH` | `info` | 50 of 132 teams |
| `PERSON_SOLE_COACH_OF_MULTIPLE_TEAMS` | `compromise` | 2 people |
| `TEAM_UNCOACHED` | `blocking` | 0 — reachable from ordinary roster input, and asserted from it |
| `ASSIGNMENT_WINDOW_UNJUDGED` | `compromise` | 0 — no corpus row carries a window |

One coach is not a violation — 50 teams were in that position and the season ran —
so it is `info` and the register is a report. Being the sole coach of *two* teams
is a `compromise`, because that is a must-attend with no fallback at either end.

A `Person` ([GAP-22](MODEL_GAPS.md#gap-22)) is not a `Profile`: no auth UUID, no
email, no organization id. A coach who exists on a roster and has never logged in
is a first-class citizen, and the data-minimisation rule in `CLAUDE.md` means the
model must not require a field the club has no reason to hold.

---

## 4. Derived must-attend, and fallback priority

There are exactly two bases, and neither is a name:

| Basis | Derived from |
| --- | --- |
| `sole-coach-of-multiple-teams` | the roster: the **only** active coach of two or more teams |
| `declared-personal-constraint` | a record an operator entered — the single-car family, who could not split |

The declared-constraint policy **ships empty**, exactly as
`facility/venueComplex.js` ships `EMPTY_VENUE_COMPLEX_MAP`. The corpus carries no
such record, and seeding one would put a real family's domestic arrangement into a
repository forbidden from holding PII. `PERSONAL_CONSTRAINT_POLICY_EMPTY` (`info`)
says out loud that one of the two bases had nothing to contribute.

Both constraint kinds are consumed, and both honour `fromDate`/`toDate`:

| Kind | Consumer | What the window does |
| --- | --- | --- |
| `cannot-split` | `deriveMustAttend({ roster, policy, date })` | a record that expired in August does not make somebody must-attend in September |
| `unavailable` | `resolveAttendance({ …, policy })` | a person declared unavailable that day is **not fallback capacity**, on the same reasoning that a coach who has not accepted is not |

`deriveMustAttend()` with no `date` cannot apply a window. It honours the record
anyway — silently dropping a declared must-attend is the worse of the two
failures — and reports `PERSONAL_CONSTRAINT_WINDOW_UNJUDGED` (`compromise`), on
the same contract as `ASSIGNMENT_WINDOW_UNJUDGED`.

**No person id, name or team code from the corpus appears anywhere under
`packages/core/src/people/`**, and `tests/people.test.js` proves it: it greps
every source file in the package for all 329 person keys, display names and team
codes in the two roster revisions and requires zero hits, with a positive control
over a file that *does* name the corpus. A second test appoints a co-coach to one
of the two must-attend people's teams and asserts the flag disappears.

### Fallback priority

When a person cannot make both, they stay where their coach slot is **lower**;
the other team is released, and that release is recorded as a conflict for that
team.

| Reason code | Severity | Meaning |
| --- | --- | --- |
| `ATTENDANCE_RESOLVED_BY_SLOT` | `info` | slot order decided; who stays and who is released |
| `ATTENDANCE_SLOT_TIE` | `compromise` | same slot on both teams; broken by commitment id **and reported** |
| `TEAM_FALLBACK_TO_CO_COACH` | `compromise` | a free co-coach covers the released team |
| `TEAM_FALLBACK_CONTESTED` | `compromise` | the co-coaches are clashing too; the pair must split |
| `TEAM_NO_FALLBACK_AVAILABLE` | `blocking` | no other active coach exists |
| `ATTENDANCE_MUST_ATTEND_UNRESOLVABLE` | `blocking` | a must-attend person is wanted in two places |
| `ATTENDANCE_TEAM_LINK_MISSING` | `compromise` | the roster gives the person no active slot on a clashing commitment's team, so slot order could not decide |

A commitment with **no team** — a declared non-club obligation — ranks as slot
**0**. Not because such an obligation is more important, but because no co-coach
can stand in for it, so releasing it is not a move that exists.
`CoachAssignmentSchema` forbids a slot below 1, so 0 cannot collide with a real
one.

A commitment whose team the roster gives the person no active slot on ranks
*behind* every real slot, which is the right ordering — that is the one to
release — but the rank is **not a slot** and never leaves the module as one:
`retainedSlot`/`releasedSlot` are `null` and `ATTENDANCE_TEAM_LINK_MISSING`
reports the missing link, rather than `9007199254740991` travelling downstream
dressed as a very low-priority coach slot.

On the corpus this finds 3 clashes, matching the README's *"3 rec games are
single-coach (a co-coach covered)"* and the loader's own `findSingleCoachGames()`.
All three are genuine **ties** — each person holds the same slot on both of their
teams — so the corpus exercises the tie path and not the ordering path; the
ordering case is constructed in the test and labelled as constructed.

Overlap detection is deliberately **not** a consecutive-pair scan. Gaps are a
question about neighbours; overlap is a question about intervals, and a
neighbours-only sweep misses a long commitment straddling two short ones — the
same blind spot as pairwise team comparison, one level down.

---

## 5. Identity resolution: propose, never merge

`Person Key` is a lower-cased name string, so any name-derived key silently splits
or merges people. Incident 6 is the split: the earlier roster revision carries 197
identities where there are 196 people, and the hidden identity hid a two-team link
with no fallback behind it.

The obvious fix is the wrong one. Auto-merging on a name heuristic is how two
genuinely different people with one surname become one person, and this corpus has
53 shared surnames and 205 same-surname pairs to do it with. So the module
**scores and queues**. A merge exists only because a human moved a queue entry to
`accepted`, and `applyIdentityDecisions()` is the only function that produces one.

### The signals

Nothing in the module names a given name, a nickname table, or a person.

| Signal | Weight | What it observes |
| --- | --- | --- |
| `SURNAME_EXACT` | 0.35 | family names identical once normalised — also the blocking key |
| `GIVEN_NAME_CONTRACTION` | 0.30 | the shorter given name is a **subsequence** of the longer, shares its first letter, is strictly shorter, and is ≥ 3 characters |
| `GIVEN_NAME_PREFIX` | 0.10 | shared prefix ≥ 3 characters |
| `GIVEN_NAME_SIMILARITY` | 0.15 | Jaro-Winkler, as a strength rather than a gate |
| `GIVEN_NAME_INITIAL` | 0.05 | same first letter |
| `TEAM_DISJOINT` | 0.05 | no team in common |

Weights are frozen and sum to 1, so a confidence is a weighted mean in [0,1] and
adding a signal cannot inflate every existing proposal.

The contraction signal is the general shape of a hypocorism formed by deletion —
the family containing Tom/Thomas, Kate/Katherine, Dan/Daniel, Ben/Benjamin. It is
a rule about string structure, and it is what discriminates: on the corrected
roster **none** of the 205 same-surname pairs is a contraction, has a
three-character shared prefix, or reaches the 0.85 similarity gate (the highest is
0.783). On the earlier revision, exactly one pair does, at confidence 0.968.

### The veto

Two identities assigned to the **same team** are two people: a team's slot 1 and
slot 2 are, by construction, not one person wearing two spellings. That pair is
refused before it is scored, and the refusal is reported as
`IDENTITY_MATCH_VETOED` (`info`) rather than dropped, so a surprising absence from
the queue has an explanation.

### The queue

| Reason code | Severity | Meaning |
| --- | --- | --- |
| `IDENTITY_REVIEW_PENDING` | `compromise` | probably one person; queued, not merged |
| `IDENTITY_MERGE_APPLIED` | `info` | a named human accepted a proposal |
| `IDENTITY_DECISION_UNKNOWN_ENTRY` | `blocking` | a decision names an entry the queue does not hold |
| `IDENTITY_MATCH_VETOED` | `info` | two identities coach the same team |
| `IDENTITY_SCAN_VACUOUS` | `compromise` | zero pairs compared — an empty queue that means nothing |

`applyIdentityDecisions(queue, [])` leaves the identity count where it was; only an
`accepted` decision moves it. The surviving id is the lexicographically smaller of
the pair (arbitrary, and stated to be arbitrary), the other becomes an alias, and
chains are collapsed so the mapping is idempotent.

A decision pass **accumulates**, as every other module here does. It carries the
queue's own findings and merges its counters, so a vacuous queue does not come
back `allowed` with zeroed counters and a veto's explanation is not lost; the one
code it does not carry is `IDENTITY_REVIEW_PENDING`, which the pass restates
itself. The alias index is rebuilt from the *collapsed* mapping rather than
pair-by-pair: with `a::b` and `b::c` both accepted, filing `c` under `b` would
leave it under an id that is itself no longer a survivor.

---

## 6. Meta-assertion discipline

Every result carries a `PeopleMeta` counter set, and every vacuity check is on the
**input** rather than the output. `ATTENDANCE_SCAN_VACUOUS` fires when zero
timelines were handed in, not when zero clashes were found — a clean season is a
legitimate answer, a broken roster join is not, and a check that cannot tell them
apart is the shape Phase 2's own review criticised (a coverage set compared
against itself; a subject set derived from the data a break would corrupt).

The tests give the load-bearing meta-assertions explicit **positive controls** — a
mutated input that makes the check fail — and label them as such: withdrawing a
co-coach to move a team into the sole-coach register, appointing one to remove a
must-attend flag, an empty registry to produce `PERSON_DAY_GAP_UNGOVERNED`, an
unfiled row kind to prove a whole layer cannot silently leave the timeline, and
the name grep run over a file that does name the corpus.
