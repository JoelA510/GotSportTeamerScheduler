# Scheduling build plan — status

Running record of the scheduling-engine build plan (`SquadLogic_ClaudeCode_Prompts_2.md`),
which converts a real anonymized season into a regression corpus and builds the
domain model, constraints, solver behaviour and query layers around it.

**Kept in the repo deliberately.** Session scratchpads have been lost twice to
container rollbacks; the repo is the only durable record.

Last updated at the pause described in §4.

## 1. Delivered

Eighteen PRs merged (#334-#351; the table's twenty rows share three prompts
across #334). Test suite **848 → 1776**, season fixture green at every merge, no
regression to the shipping app (bundle entry hash unchanged throughout). Both
figures are measured rather than remembered: 848 at `cd31924`, the merge before
#334, and 1776 at `955eb32`, with everything through #351 in. The 1,720 this
line used to claim was the working tree at the time of writing, with 6.1 built
and not yet merged.

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
| 6.1 | `scenario/` — branch a season without duplicating it; overrides, ancestry, shared record sets, digest-keyed memo | #351 |
| 6.2 | `publication/` — snapshots, four-bucket parity, change notices, sync registry; reason-code reachability audit | #350 |

## 2. In progress

**Prompt 7.1 — the read-only feasibility API.** Built in the working tree, not
committed. `packages/core/src/feasibility/` (`reasonCodes.js`, `schemas.js`,
`types.js`, `verdict.js`, `queries.js`, `index.js`) plus
`tests/feasibilityApi.test.js`; `tests/reasonCodeReachability.test.js` gains the
sixteenth vocabulary and its driver. Suite **1776 -> 1904**, measured at each
commit rather than added up: 62 new cases with the feature (`a393c60`), 25 more
from the first pre-PR review round (`ece79b3`), 5 from the second round below,
9 from the third, 7 from the fourth, 11 from the fifth, 4 from the sixth, 9 from
the seventh, **-4 in the eighth**, which withdrew the seventh's second finding
and the four cases that proved it. All six gates green, season fixture green.

Three queries, one answer shape: `canGameMove()`, `canTeamPlay()`,
`feasibleKickoffBounds()`. A verdict is three-valued
(`feasible`/`infeasible`/`unknown`) and `deriveFeasibilityVerdict()` is its only
producer; `binding` is always a **list**, because 08/22 at Alder Park is a
genuine tie; `marginMinutes` is copied from the owning module's `slackMinutes`
under one stated sign convention and is `null` — never `0` — when nothing
measured a bound.

**The second threshold is the new work.** `latestHard` is the last kickoff that
raises nothing `blocking` (`latestLegalKickoff()`'s own answer, confirmed under
the registry — see round four's finding 1; on this corpus the confirmation
changes nothing and the answer is reproduced exactly); `latestClean` is the last
that raises nothing above `info` at all. The
gap is `tightBandMinutes`. On this corpus: Alder 08/22 18:15/18:15, Alder 11/14
14:50/14:50, Summit 11/14 19:30/19:15.

`tight` is **three-valued and named** — `clean` / `tight` / `no-clean-position`,
from `FEASIBILITY_TIGHTNESS`, `null` when the verdict is not `feasible` — for the
reason the verdict is: as a boolean, `false` meant both "there is room here" and
"no clean position exists at all", and 772 of the corpus's 1,872
surface-date-format combinations reported the second while reading as the first.
`deriveFeasibilityTightness()` is its only producer.

**One design decision worth the review's attention.** Both of the corpus's
unenforced constraints are `preference`, and `CONSTRAINT_TYPE_SEVERITY` maps a
preference to `info`, which moves no status in any derivation in this repo. So
an unenforced *preference* is reported in `unknowns` and compromises the answer's
`status`, but does not flip the verdict; an unenforced `hard` or `soft` one does.
The guard is proved by construction rather than by assertion: `coach-maximum-gap`
retyped to `hard` through `whatIfConstraintType()` — which projects a registry
and adopts nothing — makes the identical query come back `unknown` naming it.

**The first pre-PR review round.** Eight findings, seven of them reproduced against
the season corpus and one (`ATTRIBUTION_CLAIM_CATEGORY_ONLY` forwarded raw into a
feasibility `findings` list) latent rather than live. Three were fixed as classes
rather than as instances: `tight` became the named enum above; every finding now
leaves through `assertFeasibilityFindings()` in `seal()`, so the module cannot
emit a code whose severity it cannot look up; and `candidateAccountingFindings()`
runs from `seal()` on every answer shape, which makes
`FeasibilityMeta.candidatesAnswered === candidatesConsidered` an invariant rather
than a docstring. ~~And moves `FEASIBILITY_CANDIDATE_DROPPED` off the
reachability audit's hole list.~~ **That last clause was false and round two's
finding 2 corrected it**: the code was credited as reachable because the audit
driver called `candidateAccountingFindings()` with a meta built by hand. No
query emits it, and it is back on the hole list with a stated reason. The other
five: the margin's `marginBasis` now names the bound
the number was copied from rather than `binding[0]`; a team asked about the slot
it already holds is answered from the standing schedule instead of refused as a
no-op; `subject.venueId` is the destination surface's venue rather than the
origin's; `canTeamPlay()`'s `format` chooses the carrier fixture, so it is
honoured by every cell or refused with `FEASIBILITY_FORMAT_UNCARRIED`; and
`seal()` no longer writes to a shared meta, which had `unknownsRaised` counting a
grid's unknowns once per cell and again in the roll-up.

**The second pre-PR review round.** Four findings, three of them reproduced
against the season corpus and one — round one's own fix, reviewed — a claim in
this document that did not reconcile.

1. **A blocked slot sealed as feasible and clean.** The standing-position path
   round one added took `blockers` from `explainGame()`, which merges the rule
   engine's violation claims, and `blocked` from facility legality alone. Four
   corpus fixtures (`combined_schedule.csv#534`, `#548`, `#564`, `#575`) carried
   a blocking `TRAVEL_COMMITMENTS_OVERLAP` and reported `feasible` / `clean`.
   The verdict is now derived from the list the answer reports, and the rule —
   no answer may report `feasible` while carrying a blocking blocker — is
   asserted over four sweeps of the corpus with a per-sweep meta-assertion that
   each actually saw one.
2. **`FEASIBILITY_CANDIDATE_DROPPED` was declared reachable on test-authored
   input**, and is back on the audit's hole list with a stated reason. Both its
   emitters stand behind an invariant established one line earlier; making it
   fire would mean introducing the drop it exists to catch. The direct-call test
   stays in `tests/feasibilityApi.test.js` as a falsifiability proof for the
   guard, which is what it honestly is. The audit's header now checks the split
   between its two kinds of hole as well as the totals — that sentence said
   "Five" while six entries claimed it, unchecked.
3. **This document's arithmetic.** Corrected above, by measuring the suite at
   each commit rather than by adding up the deltas: the numbers were wrong in
   both directions.
4. **`feasibleKickoffBounds()` walked the hard result twice** when no clean
   boundary exists, counting every claim again in `meta.claimsCarried` and
   describing the hard boundary's constraints under the clean threshold's name.
   1,620 of the 1,872 combinations reach that branch, 869 with a non-empty claim
   list. A boundary that does not exist now carries nothing.

**The third pre-PR review round.** Three findings, all three reproduced against
the season corpus, and all three the same shape: a guarantee enforced at a call
site rather than in the thing that produces it.

1. **One derivation, for every severity.** Round two's own fix is finding 1 a
   severity down. It took `blocked` from the published blockers and left
   `compromised` on `checkPlacement()`'s facility status, so
   `combined_schedule.csv#7` and `#18` — and the three `canTeamPlay()` cells
   over those two positions — sealed `feasible` / `clean` while publishing a
   compromise-severity `TRAVEL_BETWEEN_VENUES_TOO_SHORT`. A third line about
   `compromise` would have been the same fix a third time and would have left
   the next severity uncovered, so the mapping from a severity to what it does
   is now a frozen table (`FEASIBILITY_SEVERITY_EFFECT`) with one row per member
   of the enum, `deriveFeasibilityEvidence()` is its only reader, and `seal()` —
   which every answer of every shape passes through — folds that answer's own
   `blockers` through it. Nothing decides an answer that the answer does not
   publish: `legal`, `placementStatus` and the tight band are gone from the
   derivation, and a control shows each was already carried as a claim before it
   was derived from. The corpus rule the second round asserted for `blocking` is
   asserted for every severity, over the same four sweeps, with a meta-assertion
   per arm *per severity* and a positive control for the row that must move
   nothing. Eight answers move, all `clean` -> `tight`: the two standing
   positions, the three grid cells over them, and the three roll-ups those cells
   are the only feasible member of. Nothing else moves — no verdict, no margin,
   no basis, no status, on any of the 5,388 answers the corpus produces — and
   the bounds tightness distribution is unchanged at 772 / 848 / 199 / 53.
2. **An answer that denied its own verdict.** With `minimalSet` at its default —
   which is the answer an operator actually gets, and not what the round-two
   sweep asked for — nine answers came back `infeasible` beside
   `minimalSet.blocked === false` and `ATTRIBUTION_PLACEMENT_NOT_BLOCKED`: *"no
   set of constraints blocks it"* printed next to *"infeasible"*. Round one
   considered suppressing the call and rightly refused, because a blocked answer
   with no *facility* explanation is worth saying. The information is kept and
   the denial is now qualified: `FEASIBILITY_BLOCKED_OUTSIDE_FACILITY` names the
   layers that did block it and the codes they raised, so the answer reads "the
   facility layer did not block this; the rule engine did". Asserted as a rule
   over both sweeps — no answer may carry a verdict and a minimal-set claim that
   disagree without saying which layer decided.
3. **A declared contract that was wrong.** `FeasibilityBoundary` said `claims`
   and `notApplicable` are empty when `kickoffMinutes` is null, and the code has
   never done that: `latestHard` for Summit HS on 2026-09-19 has no kickoff and
   one claim, `PERMIT_BLACKOUT` naming the permit record, which is the answer to
   *"why is there no boundary here?"*. The declaration was the wrong half.
   The contract now states what is actually true — a boundary carries the
   constraints that spoke about **its own** position, and one with no position
   may explain its absence but never in another minute's words — and
   `assertBoundaryResult()` enforces it inside `boundaryOf()`, where the
   boundary is built, rather than at the one call site that used to remember.
   Its falsification is round two's finding 4 reconstructed: the hard result of
   Alder pitch 2 on 08/22 at 9v9, offered as a boundary with no position, is
   refused.

**The fourth pre-PR review round.** Two findings, and the change from the first
three rounds is that **neither fires on the corpus as it ships**. Both are about
internal consistency, and both are shown against constructed input through
public entry points rather than against the season.

1. **Two severity views in one answer.** Round three's own fix arriving from the
   other side. `feasibleKickoffBounds()` derives the verdict from `hard.claims`,
   which `boundaryOf()` re-severities through the registry, while
   `latestLegalKickoff()` *selects* the hard bound on `availability/`'s own
   frozen table. Add one HARD registry record over a base-`compromise`
   availability code — `PERMIT_MARGIN_TIGHT`, which is what a registry is for —
   and **217 of the 1,872** bounds combinations come back `infeasible` while
   naming a latest legal kickoff, a binding set and a margin. The same probe on
   `fd676cf` gives 0, so round three introduced it. The bound is now **chosen
   under the view it is judged under**: availability's answer is confirmed
   through `underRegistry()` and, where the registry refuses it, the same
   generate-and-confirm search the clean boundary already used continues
   downward, with `speaksAt()` as the one place a threshold becomes a severity
   test for the selection, the binding probe and both boundaries. The search
   only ever proposes minutes at or below availability's own, so this module can
   be more conservative than `availability/kickoff.js` and never less. A moved
   bound says so: `FEASIBILITY_BOUND_UNDER_REGISTRY` (`info`) names the minute
   availability offered, the minute reported instead and the codes that
   differed. `latestLegalKickoff()`'s contract is untouched. The rule — no
   answer may name a boundary it calls infeasible — is asserted over both
   registries, 3,744 answers, with the moved bound checked against a
   minute-by-minute scan at the hard threshold.
2. **A finding that named no source.** `FEASIBILITY_BLOCKED_OUTSIDE_FACILITY`
   read its `sources`/`codes` off `blockers` while the verdict was folded from
   `blockers` *plus* the travel findings no transition owns, so a blocker
   arriving by the second route printed *"what blocks it is stated in the
   blockers"* — about something the blockers do not state. The list is kept,
   because it is the only thing that stops an unclaimed travel blocker becoming
   an unnoticed one, and the message now describes it: unowned travel findings
   are carried as source-bearing records and `blockingEvidenceOf()` names the
   blocking members of **the same list** `deriveFeasibilityEvidence()` read, so
   the finding cannot be reached with nothing to name. The end-to-end case is
   **not constructible today and is not claimed to be**: the only unowned travel
   findings are scan-level, and no scan-level travel code can be `blocking`
   under any constraint type. That is asserted from the evaluator's own output
   rather than asserted about it, so a scan-level blocking code added later
   fails the test instead of quietly re-opening the hole. Nine corpus answers
   change, all of them the same message gaining the codes in brackets; no
   verdict, margin, boundary, status or `details` field moves anywhere in the
   corpus.

**The fifth pre-PR review round.** Two findings, neither of which fires on the
corpus as it ships, and both about one root: `latestLegalKickoff()` returns the
accepted minute's own findings **plus** summaries of its own search, and this
module read that list as though a probe had produced it.

1. **An infeasible answer that explained nothing.** Where the registry refuses
   availability's bound and the downward search finds no legal minute,
   `hardBoundaryResult` was a hand-built `{ constraints: [], findings: [] }`, so
   the answer sealed `infeasible` while publishing `blockers: []`,
   `latestHard.claims: []`, `latestHard.notApplicable: []` and `binding: []` —
   the verdict riding on the caller's `blocked` flag while
   `deriveFeasibilityEvidence()` saw nothing. The blackout path (Summit HS,
   2026-09-19) publishes `PERMIT_BLACKOUT` in exactly that situation, so the
   module contradicted itself, and `FeasibilityBoundary` — widened one round ago
   to say a boundary with no position carries the constraints explaining its
   absence — declared the behaviour the code did not have. The boundary is now
   built from the refusal's own probe with its position taken off, so the
   constraints in force and the inapplicable ones are the refusal's; and a
   refusing finding that **no** applicable bound owns — `LINING_MISMATCH`
   hardened by a registry is one, and no availability constraint kind claims it
   — becomes a claim of its own through `claimFromFinding()`, which is
   `explainKickoffTime()`'s contract for its orphans adopted rather than a third
   one invented. Deliberately narrow at the time — only the findings named as
   the refusal, and only where there is no position — which is the restriction
   round six removed; see below. Reproduced against a HARD record over
   `LINING_MISMATCH` on `brookside-park/upper-1`, 2026-08-22, 4v4, built through
   `buildSeason2026ConstraintRegistry({ extraConstraints })`.
2. **"The registry moved the bound" said when it had not.**
   `refusedAtAvailabilityBound` was computed from `hardResult.findings`, which
   carries `latestLegalKickoff()`'s own `LATEST_KICKOFF_BOUND` —
   synthesised after a minute is accepted and raised by
   `checkKickoffAvailability()` never. Under a HARD record over that code the
   search re-accepted the identical minute and
   `FEASIBILITY_BOUND_UNDER_REGISTRY` was still emitted, with
   `details.availabilityKickoffMinutes === details.kickoffMinutes` — the
   inequality round four's own test asserts. The refusal is now read off a fresh
   `probeKickoff()` of availability's bound, which is the list every candidate is
   confirmed against, and the finding is emitted from the comparison it asserts
   (`hardMinutes !== availabilityMinutes`). The probe is gated on the searcher's
   larger list, which is sound because everything a probe says about a minute is
   carried by the search that accepted it — asserted over the corpus rather than
   assumed — so the season pays for no probe and only the 217 cells where a
   registry moves the bound gain one (`meta.boundaryProbesRun` +1,
   `constraintsConsulted` +4). No verdict, bound, claim, margin, status or
   finding moves anywhere in the corpus, under either registry.

**The sixth pre-PR review round.** One finding, live on the corpus as it ships,
and the first of the six rounds that moves published figures.

1. **An answer that sealed a severity it published nothing at.** Round five
   adopted `claimsFromBounds()`'s orphan contract for one named case; the
   general case stayed open, and `boundaryOf()` went on building claims from
   availability **constraint kinds** only. `latestLegalKickoff()` reports
   `constraints: []` when it finds no legal minute, so its `blocking`
   `NO_LEGAL_KICKOFF` was owned by nothing and dropped: **745 of the 751**
   infeasible plain-corpus bounds answers sealed `infeasible` with
   `latestHard.claims: []`, the verdict riding on the caller's `blocked` flag
   while `deriveFeasibilityEvidence()` read an empty list. (The other 6 are the
   09/19 blackout, whose `PERMIT_BLACKOUT` *is* owned by the permit edge.) At a
   boundary that does exist, a `compromise` no edge owns was dropped the same
   way on **869** positioned boundaries — `LINING_MISMATCH` x844,
   `PERMIT_UNDECLARED` x59, `OCCUPANCY_FOOTPRINT_UNKNOWN` x44. The orphan set is
   now the general one and the narrow `refusedBy` parameter is deleted as
   redundant.

   **What moved, over the two-registry sweep of 5,234 answers: 3,228 lines, all
   of them bounds — 1,614 under each registry — and on every one of them
   `latestHard.claims` plus `meta.claimsCarried` and nothing else.** No move and
   no team answer changes at all. Under the plain registry the verdicts stay
   751/1,024/97, the statuses stay 745 rejected / 1,127 compromised, the
   tightness distribution stays **772 / 848 / 199 / 53**, and no margin, basis,
   binding set or boundary minute moves anywhere. Alder 08/22 18:15/18:15,
   Alder 11/14 14:50/14:50, Summit 11/14 19:30/19:15, the 08/22 joint clean
   bound and incident 3's -10 min / `occupancy` are all unchanged.

   The tightness distribution holds for a reason rather than by luck, and the
   reason is checkable: all 869 newly-explained positioned boundaries are cells
   with **no clean position** (772 `feasible`, 97 `unknown`), because a
   compromise that speaks at the hard bound here is one that speaks at every
   minute — lining, an undeclared permit and an unknown footprint do not depend
   on the clock — which is exactly what makes the clean search return null. So
   `no-clean-position`, which already beats `tight`, goes on beating it. Every
   population is derivable from the corpus files: `LINING_MISMATCH` appears at a
   positioned bound **iff** the format is absent from that surface's `lined`
   list in `facility_geometry.json` (checked over all 1,121 positioned bounds,
   zero exceptions); all 59 `PERMIT_UNDECLARED` are 2026-08-23, the one Sunday
   `facility_permits.csv` covers for Alder Park alone; all 44
   `OCCUPANCY_FOOTPRINT_UNKNOWN` trace to the four `Scrimmage` rows in
   `combined_schedule.csv`, a format `game_formats.csv` gives no timing row
   (GAP-14).

   The rule replaces the counts as the thing that fails: **no answer of any
   shape may seal `infeasible` (or `compromised`) while publishing no evidence
   at that severity**, swept over 3,744 bounds answers under two registries,
   every game's standing and +30 move, every real team's grid and every one of
   its cells. ~~Its one tolerated residue is earned by an oracle rather than by
   a count — a `tight` move whose compromise is a scan-level coach-travel
   finding that no transition owns and that `claimFromFinding()` can name no
   instance for, re-derived independently from `evaluateCoachTravel()`.~~
   **Round seven's finding 1 closed that residue and deleted the oracle with
   it**: the compromise is now published as `FEASIBILITY_EVIDENCE_UNCLAIMED` and
   the rule holds over the whole corpus with nothing set aside. And
   `FEASIBILITY_NO_CLEAN_POSITION`, stated on 772 cells, is now held to
   publishing at its own hard bound the compromise that explains it.

**The seventh pre-PR review round.** Two findings, both the same class round
six closed in general: an answer sealing on evidence it does not publish. Both
are the instances that class left standing, and the round removes the last
tolerance from the corpus-wide rule.

1. **546 team cells sealed `tight` on a compromise no claim could name.**
   Moving the carrier fixture onto a date where its coaches have nothing else
   introduces `TRAVEL_SCAN_VACUOUS` — `compromise`, owned by no transition.
   `projectTravel()` drops it from the claims, **correctly**:
   `claimFromFinding()` yields `instanceId: null` / `constraintId: null` and
   `isSpecificClaim()` refuses it, so publishing it as a claim would manufacture
   the category-only claim this layer exists to replace. But it still reached
   `deriveFeasibilityEvidence()` through `travelFindings`, so the tightness was
   decided by evidence the reader could not see: 519 cells at 12:30 and 27 at
   18:00, 546 in all. The drop stays and the record is now published as
   `FEASIBILITY_EVIDENCE_UNCLAIMED` (`compromise`), naming the code, the
   severity and the layer that decided and claiming nothing about a record.
   `FeasibilityCandidate` carries its cell's own findings, because a grid that
   kept only the claims dropped the evidence one call after it was published.

2. **A team clash that decides a cell publishes no blocker — fixed here, and
   withdrawn in the eighth round.** `canTeamPlay()`'s cell blocking is
   `cell.verdict === 'infeasible' || clash.overlaps === true`, and the second
   disjunct raises nothing, so a cell refused **solely** by the team's own
   standing fixture would seal `infeasible` over a blocking list that names
   nothing. This round published a `FEASIBILITY_TEAM_DOUBLE_BOOKED` blocking
   claim from the clash and an `info` finding as provenance on the roll-up. The
   eighth round took both back out; see **the withdrawn team-clash blocker**
   below for the gap as it now stands.

   **What moved, over a sweep of 18,314 answers — 3,744 bounds answers under
   two registries, every game's standing and +30 move, every real team's grid at
   12:30 and at 18:00, and all 12,948 of their cells: 12,948 team cells, and
   nothing else.** No bounds answer, no move answer and no team roll-up changes
   at all, and no verdict, tightness, status, margin, basis, binding set or
   boundary minute moves anywhere. Every cell gains its own `findings` (1,464 of
   them carry the new `FEASIBILITY_EVIDENCE_UNCLAIMED` — 546 `feasible`/`tight`,
   which are the offending cells, 614 already `infeasible` and 304 already
   `unknown`, where the same compromise existed and no rule was ever breached).
   Under the plain registry the bounds verdicts stay 751/1,024/97, the statuses
   stay 745 rejected / 1,127 compromised and the tightness distribution stays
   **772 / 848 / 199 / 53**. Alder 08/22 18:15/18:15, Alder 11/14 14:50/14:50,
   Summit 11/14 19:30/19:15, the 08/22 joint clean bound and incident 3's
   -10 min / `occupancy` are all unchanged.

   One new reason code in the frozen severity table, with a reachability driver
   entry: the audit's header moves to **324 codes, 314 producible, 10 holes**,
   and its own self-check confirms it. No new export — the code is a member of
   `FEASIBILITY_REASON`, which the barrel already exports.

**The eighth pre-PR review round — the withdrawn team-clash blocker.** A scope
reduction, not a feature round. The seventh round's second finding is reverted
whole: the `FEASIBILITY_TEAM_DOUBLE_BOOKED` code, its severity-table and
reachability entries, `teamClashAt()`'s claim list, the merge into the cell's
`blockers`, the roll-up provenance finding, and the four cases that proved them.
The first finding stands untouched.

**The gap this leaves open, stated so the next reader finds it rather than
rediscovers it.** A cell blocked **solely** by the subject team's own standing
fixture publishes no blocker: `clash.overlaps === true` reaches `blocked` and
nothing else, so such a cell would seal `infeasible` over a blocking list that
names nothing — the shape rounds five and six closed elsewhere. It is
**unreachable on the season-2026 corpus**: every one of the 338 cells that meets
a clash is already `infeasible` for an independent reason, and an acceptance
case states that no team in this season plays twice on one date. That is why the
corpus-wide publish-what-you-seal-on rule has never met it, and why it is a gap
rather than a live defect. It is **not** a reachability-audit hole: a hole is a
*declared* code with no production path, and this code is no longer declared —
the audit's ten holes are unchanged.

**Why the fix was withdrawn.** It closed an unreachable gap and opened four
defects on paths this corpus does reach:

1. A candidate refused only by the clash claim still carried the cell's
   `binding`, `marginMinutes` and `marginBasis` — `verdict: "infeasible"` beside
   `binding: [{ kind: "occupancy", slackMinutes: 25 }]` and `marginMinutes: 25`.
   `decisiveClaims()` was never re-run over the merged list, and the roll-up
   copied those numbers through `best`.
2. The claim was sourced `ATTRIBUTION_SOURCE.FACILITY`, the exact layer its own
   docstring said does not own the fact, so `blockingEvidenceOf()` would name
   "facility" for something `minimalBlockingSet()` reports `blocked: false` on.
3. The claim carried `slackMinutes: null`, so `tightnessKey()` sorted the cell's
   only `blocking` claim behind three `info` ones: `blockers[0]` on an
   infeasible cell was an `info` occupancy claim, against the tightest-first
   contract the change itself asserted.
4. The roll-up finding was emitted per (date, surface) although `teamClashAt()`
   ignores surface, so one clashing fixture yielded dates x surfaces duplicates.
   This one was **live**, on the 43 roll-ups that gained provenance; the 1x1
   acceptance grid hid it.

Writing the fix again needs a claim this layer can honestly own — its own
source, a real `slackMinutes`, and the candidate's margin and binding recomputed
from the merged list — plus one finding per clashing fixture rather than one per
cell. The clash site in `queries.js` carries the same note.

**Also in this round, and unrelated to the revert.** Three `describe` bodies in
`tests/feasibilityApi.test.js` (acceptance 3, 4 and 9) dereferenced a corpus
`find()` at *collection* time, so a corpus that stopped carrying the fixture
failed the whole file with a `TypeError` before any `expect()` ran and the
meta-assertion that exists to report exactly that could never be reached — the
defect `tests/scenarioBranching.test.js` already carries a fix for, where it
printed "Tests no tests". The selection is now built by a function the tests
call, and acceptance 4 gains the `toBeDefined()` it was missing.

Nothing in flight otherwise. 6.1 merged as #351 after seven review rounds
(11 -> 6 -> 4 -> 2 -> 4 -> 1 -> 0 findings) and one CI failure of its own making:
widening the digest to cover the bundle by construction took it from 6.0 to
21.2 ms, which pushed a test doing two cold season derivations past vitest's
5 s default on the slower runner. Fixed at the file level rather than at the
one test that tipped over first, since seven others there were above 700 ms.

### Historical - 6.1's first review round, kept for the pattern

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
