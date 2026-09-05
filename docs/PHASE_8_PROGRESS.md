# Phase 8 — progress log

Continues [`PHASE_8_PLAN.md`](PHASE_8_PLAN.md). One entry per task, appended when
the task's PR merges. This file is the only durable record across supervisor
sessions: resume from the first task not marked **merged**; never redo one that is.

Test counts are `npm run test` totals (passed / skipped / todo). Baseline on
`main` at b048022 before 8.0: **2165 / 34 / 6** across 158 files.

---

## 8.0 — Corpus loader and integrity test — **merged**

- **PR:** [#359](https://github.com/JoelA510/SquadLogic/pull/359), branch
  `feat/phase8-0-corpus-loader`, squash-merged as `ce59da7`.
- **Tests:** 2165 / 34 / 6 → **2216 / 34 / 6** (159 files). Season fixture suite
  unchanged at 34/34; new `tests/season2026PracticeCorpus.test.js` 49;
  `tests/reasonCodeReachability.test.js` 26 → 27.
- **Files:** `packages/core/src/fixtures/season2026PracticeParsers.js` (13
  `.strict()` schemas, exact column contracts, 28-code frozen finding table),
  `season2026PracticeLoader.js` (IO, cross-corpus join, deep-frozen result with
  `findings`, `findingsByCode`, `meta.examined`), barrel exports, two one-line
  reuse seams in the game loader.
- **Review rounds:** 3 (all `/code-review` at high, single-pass inline).
  - Round 1: 8 findings — subject set derived from the sheet a break would
    corrupt (select coaches); slot conflated with membership; a second
    season-year producer; alias venue parsed and unread; prototype-key lookup;
    sibling contract not adopted (player birth years); comment/figure mismatch;
    README still stating a disproved figure.
  - Round 2: 7 findings — duplicate alias double-counted in the ring comparison;
    README rendering inverted a sum; the 12 disagreements' composition invisible;
    "outside season" check was year-only; duplicate detection quadruplicated;
    season-long closure decided by a magic day count; a control forging
    unreachable state.
  - Round 3: 5 findings, three of them earlier shapes recurring, so the loop
    stopped after this fix: last-wins index on the fields-sheet side; unparsed
    judged from label not data; closure time window parsed and unread; first
    closure per venue only; blocking-code count in prose.
- **Supervisor figures that did not hold:**
  - "Seven files" in the 8.0 prompt: the directory holds 13 CSVs; all parsed.
  - README "65 teams that play a game hold no practice slot": 44 enumerated from
    the roster, 53 from every named side of `combined_schedule.csv`; no
    derivation reaching 65 was found. README now shows the source's 65 beside
    the derived figures.
  - README's 9-code disagreement list is incomplete: the 12 are those 9 plus
    `9v9 Field 2`, `7v7 Field 2` and `11v11 Field 2`; the last is blank-vs-label,
    and the test asserts 12 = 11 label conflicts + 1 blank.
  - README anonymisation figures 6 venues / 22 fields / 136 team codes: game
    corpus shows 7 venues in play, 24 field ids, 132 roster teams, 140 named
    sides; 136 has two readings. Marked unreconciled in the README.
  - Co-coach split 71/24/29/9/3/65 holds for column 1 only (column 2 is
    10/3/4/7/177).
- **Corpus findings the README does not state** (all reported as findings, none
  fixed): `select_coaches.csv` disagrees with `../coach_roster.csv` on 9 of 22
  rows and omits 8 rostered Select coaches; practice venue `Maplewood` vs game
  corpus `Maplewood Back` / `Maplewood Front` (33 venue-name findings across 9
  files); `field_constraints.csv` Gardening Day row has an Excel-corrupted
  `fields = 2026-01-07` for `1-7`; 9 coach-registration birth years of 2026;
  duplicate person / player / inventory keys; 9 named registration players with
  no player row; 7 preferred co-coach keys that are players' keys, 3 unknown;
  the `confirmed` column of `field_code_names.csv` is empty on every row.
- **Open for the operator:** `game_change_log.csv` matchup cells carry apparent
  real organisation and place names (opposing clubs and towns), which the README's
  leak audit says it scans for and reports zero. No fixture was edited; decide
  whether opposing-club names count as a leak under CLAUDE.md §2.
- **Deliberately left open:** the 65 / 6 / 22 derivations; whether `used_for` /
  `remainder` on `field_code_names.csv` should ever be load-bearing (retained as
  record data).
- **Conventions confirmed:** the first inline control caught a real hole — PapaParse
  keys a short row only by the cells it has, so a header-only extra column passed
  the per-row check; the header is now checked on its own.

---

## 8.1 — Two live defects on the shipped practice path — **merged**

- **PR:** [#363](https://github.com/JoelA510/SquadLogic/pull/363), branch
  `feat/phase8-1-practice-defects`, squash-merged as `7846722`.
- **Tests:** 2216 / 34 / 6 → **2243 / 34 / 6**, plus **17 Deno cases** in
  `supabase/functions/_shared/tests/practice-coaches_test.ts`, which now run in
  CI as a new `Deno Mirror Tests` job.
- **Review rounds:** 3 (`/code-review` at high each time). Round 1: 4 findings.
  Round 2: 5, all in the Deno mirror. Round 3: 5, two of them the round 2
  contract-mismatch shape recurring, so the loop stopped there.

### What the plan got wrong, and what it cost

The plan calls `packages/core/src/practiceScheduling.js` and `autoScheduler.js`
"the shipped practice scheduler". **They are not shipped.** `frontend/src`
imports neither; the app POSTs to the `auto-scheduler` Edge Function, a Deno
port carrying the same head-coach-only conflict check, and
`PracticeSchedulingPage.normalizeTeam` dropped assistants before the request.
Fixing only the core modules would have produced a fully test-verified change
that left the defect live for every user. The port is therefore part of 8.1,
not a follow-up: it closed [#362](https://github.com/JoelA510/SquadLogic/issues/362).

Deno was not installed when the agent first reported, so it declined to patch
the port blind — correctly. `npx --yes deno@2` resolves 2.9.6 in this
container, which turned the port from "statically reviewed" into
"test-verified" and is now pinned in CI.

### Claims

| Claim                                                        | Result                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Core modules consult only `team.coachId`                     | HELD for those two files                                                                                                               |
| No other coach path                                          | **DID NOT HOLD** — `practiceMetrics.js`, the Deno `auto-scheduler`, `scoring-engine.ts`, and the page's `normalizeTeam` all carried it |
| 215 assignments / 132 teams / 196 people                     | HELD, derived at run time                                                                                                              |
| "roughly 83 co-coach assignments unseen"                     | HELD, exactly **83** across 82 multi-coach teams (81 with two, 1 with three)                                                           |
| `practiceSlotExpansion.js:13` claims daylight; no such input | HELD — docstring corrected, not implemented (implementing it is 8.9)                                                                   |
| Migration CHECK forbids Friday; 19 Friday rows               | HELD — the `day_of_week` enum already carries `fri`; only the CHECK excludes it                                                        |

### Defects the review found in the fix itself

- The Deno mirror's merged-pair report used `find` (first overlap only), so a
  pair's coach list could omit coaches it shared — the mirror diverged from the
  core evaluator its own comment claimed to mirror.
- `coachIdsOf` honoured a **request-supplied** `coachIds` key over the real
  coach fields. `TeamSchema` is passthrough and `fairness-scoring` passes
  request teams straight to the evaluator, so `coachIds: []` in a request would
  have suppressed real conflicts and inflated the fairness score.
- The compensating hunk that kept `assistantCoachIds` on the prepared team was
  load-bearing and exercised by nothing; extracted as `prepareTeam()` and tested.
- `assistant_coach_ids` was read by the helper but validated by no schema, so a
  string produced a 500 inside the handler instead of a 400, and `[123]` produced
  a numeric coach key that silently matched no preference.

Every one of these passed its own tests before the review found it.

### Deliberately left open

- **Game** coach conflicts stay head-coach-only (`gameMetrics.js`,
  `evaluateGameSchedule`), noted at both sites pending 8.2.
- Coach _preferences_ remain head-coach-keyed — 8.2.
- The Deno evaluator does not dedupe duplicate assignment rows while its core
  sibling does; request-reachable, not app-reachable. Raised, not fixed, because
  adopting the sibling's contract changes engine behaviour mid-review.
- `pairKey` canonicalisation is a **structural guard, not a reachable-defect
  fix**: both coach lists are subsequences of one iteration order, so no
  divergent key is reachable through the public API today. Not forged in a test.
- `scoring-engine_test.ts`'s "coach conflict detection" case is red on `main`
  (expects `'Time overlap'`; a Vitest sibling asserts `'overlapping practices'`
  on the same field). The two pre-existing tests contradict each other, so it is
  excluded from the CI Deno job by name rather than reconciled here.
- A pre-existing `deno check` error (`TS2339 '.catch' on void`) in `index.ts`.

### Issues raised

- [#361](https://github.com/JoelA510/SquadLogic/issues/361) — `practice_slots.day_of_week`
  CHECK forbids Friday. A migration is its own PR, as the plan says.
- [#364](https://github.com/JoelA510/SquadLogic/issues/364) — `EvaluationPanel`
  passes no teams or slots, so `fairness-scoring` returns zero coach conflicts
  for every schedule. A check that matches zero records, in the shape CLAUDE.md
  §3 names.

### Process note

The first 8.1 agent hit its own session rate limit mid-round-3, leaving
uncommitted edits. A fresh agent audited that draft rather than trusting it,
and found the untested load-bearing hunk above. Handing a dead agent's partial
work to a new one **as a draft to audit, not a base to extend** is what caught it.

---

## Corpus anonymisation gap — organisation and place names — **merged**

Not a numbered Phase 8 task. Raised by the 8.0 review, ruled on by the operator,
and worth recording because of what it says about how a guarantee fails.

- **PR:** [#366](https://github.com/JoelA510/SquadLogic/pull/366), branch
  `fix/corpus-scrub-change-log-org-names`, squash-merged as `f6d379c`.
- **Tests:** 2263 → **2300 passed** / 34 skipped / 6 todo. The new guard,
  `tests/season2026CorpusVocabulary.test.js`, went 20 → 34 → **57** cases across
  two review rounds.
- **Review rounds:** 2 (4 findings, then 7). The loop stopped there under the
  standing rule: round 2's findings were round 1's shape recurring, and the
  residue is now documented rather than hidden.

### What was actually wrong

The corpus README claimed every file passed two independent leak audits, one
described as scanning for organisation names, both reporting zero. Both audits
were **denylists built from the real-to-pseudonym map**. That map covered the
club's own people, teams and venues, so every _opposing_ club and every town the
source named was outside it and invisible to both passes. The zero was true of
what the audits could see; the claim was not.

The 8.0 review named one file. The survey that followed covered all 21 corpus
CSVs plus the geometry JSON and found **a second affected file**: 5 identifying
entities (4 opposing clubs, 1 town) across 3 columns and 18 rows, 10 distinct
source tokens, 44 occurrences. Widening the scope past the single reported file
is what found it.

### The pattern, three times over

This is the entry's real content. Each fix was strong in the dimension it was
aimed at and blind immediately beside it:

| Round | The guard was                            | It could not see                                          |
| ----- | ---------------------------------------- | --------------------------------------------------------- |
| 0     | a denylist of known names                | any name not already on the list                          |
| 1     | an allowlist of known **words**          | file paths, excluded files, non-letters, untrimmed keys   |
| 2     | an allowlist over the **ASCII alphabet** | Cyrillic, dotted initialisms, parenthesised phone formats |

Round 1's four holes and round 2's seven were each found the same way: by
planting a real club name and watching a fully green suite stay green. Three of
round 1's four and five of round 2's seven were proven that way, not argued.
Two that are worth naming individually:

- A world-famous club sat in a `coach_name` cell as `Chelsea F.C.` and nothing
  fired, because the designator rule was fed by a tokeniser that discarded
  one-character tokens. `Chelsea FC` was caught. The rule was live; it could not
  see the punctuated form of five of its own fifteen entries.
- The two README files were excluded from **every** rule rather than just the
  allowlist, so the list-free shape checks never ran on the two files most likely
  to describe the real season. The stated justification — "their vocabulary would
  drown the list" — only ever applied to the allowlist.

### Corrections that came from testing rather than reading

- A supervisor instruction to state "a name already on the allowlist passes
  anywhere" was **wrong**: matching is case-sensitive and the regenerated path
  words are lowercase, so a capitalised token passes in a cell while its
  lowercase form is still caught in a path. Found by probing the claim.
- A review finding overstated one half of a tautology: deleting the path loop
  did fail one of the paired assertions. The pair caught deletion and missed
  narrowing; both are now falsifiable.
- Running the new shape rules on prose surfaced a real imprecision: `60/50/40`
  parsed as a slash-date in year 40. Month and day are now bounded, and all
  1,267 slash dates still match, still only 2026.
- The guard rejected its own README, because the prose explaining the initialism
  rule contained a literal dotted acronym. Reworded rather than exempted.

### Deliberately left open

- **A bare organisation name in the two excluded README files still passes.**
  Those files are off the allowlist by design; an email or phone in them is now
  caught, a plain English club name is not. Stated in the README's limits list.
- The limits list now carries its own limit: it can only be as complete as the
  classes someone has thought to test.
- One equipment-brand token is knowingly retained and named — it identifies kit,
  not a party to the season, and three unrelated fixtures elsewhere carry the
  same brand, so it is a repo-wide convention rather than this corpus's decision.

### Open, and approved: git history

The scrub changes the working tree only. The real names remain readable in git
history — `git show`, and the PR's own diff, reproduce them from any clone — and
the guard, which walks the checked-out tree, structurally cannot see this. The
operator has approved a history rewrite; it is blocked until the in-flight
branches land and is tracked separately. Note that GitHub may retain the old
objects via PR refs even after a rewrite, so it reduces exposure rather than
eliminating it.

### Process note

Two consecutive attempts at round 1 were lost when the harness deleted the
agent's isolation worktree mid-run, the second time with all four fixes complete
but uncommitted. The third attempt ran in a plain clone outside the harness's
cleanup path and committed after each individual fix. That is the durable
lesson: when a mechanism fails twice the same way, change the mechanism, and
make the unit of loss one fix rather than one round.

---

## 8.2 — One coach model, and counts that name their unit — **merged**

- **PR:** [#368](https://github.com/JoelA510/SquadLogic/pull/368), branch
  `feat/phase8-2-coach-model`, squash-merged as `883058a`.
- **Tests:** 2243 / 34 / 6 (main before 8.2) → **2390 / 34 / 6** (166 files),
  of which +37 came from the corpus scrub merging in mid-task. Deno mirror
  17 → **21** cases. Season fixture suite 141 / 141 throughout. E2E 76 / 76.
- **Review rounds:** 5 in total — three by the agent before opening (11, 8,
  10 findings) and two supervisor rounds (5, then 10). The loop stopped there:
  the second supervisor round's identity-key cluster was a new class, but the
  rest were recurring shapes, and a third round would have been chasing the
  next seam out.

### The operator tension, and what the corpus said about it

The fixture README said _"Coach Slot 1 = the team's primary coach"_.
`people/schemas.js` said _"slot 1 is the primary coach"_ in prose. But
`roster.js` uses the slot for exactly one thing — breaking a clash — and
defends it as an **order**, not a role. Nothing in the model reads a role.

The corpus settles which reading is _safe_ without settling which is _true_:
`select_coaches.csv` also ranks coaches and disagrees with `coach_roster.csv` on
**8 of 14 Select teams** (9 slots filled by different people, 1 person ranked
differently). Under a role reading those eight teams have two head coaches and
no rule to choose. The PR implemented the plan's directive as written — slot
stays the clash-breaker, the role stops being rendered, every coach is exported,
disagreement is surfaced — and left the ruling to the operator, with what a
role ruling would have to add back stated in both the PR and the fixture README.
**Not resolved; open for the operator.**

### The solver change, and why it stayed

The agent widened `gameScheduling.js` — `indexTeams()` and `scheduleMatchup()`
— from head-coach-only to every coach, during a review round, without the plan
and approval CLAUDE.md §3 requires for solver changes. The supervisor kept it
rather than reverting: a head-coach-only solver beside an every-coach metric is
exactly the 8.1 defect, a report raising a clash no rerun can clear. What was
required instead was that it be **finished** (round 4 found it half-applied,
protecting a team or not according to which shape it arrived in) and called out
under its own heading in the PR with before/after season-fixture evidence. That
evidence: bit-identical — 0 corpus fixtures share any coach across sides, so
the widening changes no behaviour this corpus exercises. Its reach is the 19
people who coach more than one team, 7 of whom hold a non-first slot somewhere.

### Claims

| Claim                                                                         | Result                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `people/` orders by slot, used only to break clashes, defended in `roster.js` | HELD as mechanism; DID NOT HOLD as a modelled fact — no code reads a role, two docstrings asserted one                                                                                                                                                                         |
| Legacy path and frontend render order as a role; frontend knows no slot       | HELD — 7 sites; zero occurrences of slot in `frontend/src`                                                                                                                                                                                                                     |
| `LIGHTING_SOURCE_DISAGREES` is the shape to follow                            | HELD — followed, severity raised to compromise because here the order _is_ the clash-breaker                                                                                                                                                                                   |
| `fairness/` has a three-valued subject kind                                   | HELD — `team` / `division` / `age-group`                                                                                                                                                                                                                                       |
| "132 must say 132 of what"                                                    | HELD, and worse: **six** readings (132 roster, 131 with a game, 140 named sides, 88 with a practice slot, 457 practice rows, 136 unreconciled from 8.0) behind one `totalTeams`                                                                                                |
| GAP-24 bites 8.2 directly                                                     | DID NOT HOLD — neither half is keyed on division. It bit once, indirectly: a division called `Div. A` split the count-path walker's dotted key and made `assertCountsLabelled()` throw on a well-formed report. Fixed by escaping; the label-vs-key defect itself is untouched |

### Defects the review found in the fix itself

Every one passed its own tests first.

- **A crash.** `legacyTeamCoachSource()` called `.map()` on a Postgres
  `uuid[]` arriving as the string `'{c2,c3}'` and killed the whole export; a
  refactor had dropped the `Array.isArray` guard both siblings still had.
- **A wrong-recipient defect.** `formatCoachEmails()` dropped addressless
  coaches while `formatCoachList()` kept them, so `Coaches: "Ada; Bo; Cy"` sat
  beside `Coach Emails: "ada@x; cy@x"` and a mail merge would pair Bo with Cy's
  address.
- **Identity by array index.** A `coaches` entry with no id, email or name was
  keyed by its position, so unrelated coaches on different teams became "the
  same person" and their matchups were refused. The Deno mirror keyed the same
  entry differently, so the two engines disagreed about whether a coach was
  shared — the exact "protected or not by spelling" defect the mirror fix
  claimed to close.
- **Name as identity reaching the solver.** A null `coachId` with
  `coachName: 'Coach Mike'` now keyed by name, so two different Mikes blocked
  each other. The PR's own "left open" had named only the opposite direction.
- **A reader that could not fire.** The export panel's "sources disagree"
  message was unreachable: the frontend reconciled both spellings before the
  core ever saw two sources.
- **A subject set too wide.** The reserve path emitted a disagreement finding
  for every team in the directory, not just teams on an exported row, so a
  clean two-team TIME TBD publication read as `compromise`. Narrowing it
  exposed two existing assertions that had been passing only because of the
  too-wide set.

### The identity rule, as it now stands

`coachIdentityKey()` in `people/coachList.js`, mirrored exactly in the Deno
engine and proven by a shared 19-row parity fixture that both suites import:
**id, else email, else name, else dropped** — never the list index. Only an
id-kind key is corroborated; solvers and metrics compare corroborated ids only,
so uncorroborated is never folded into "same person". Email- and name-keyed
coaches stay on every artifact and raise `COACH_IDENTITY_UNCORROBORATED`, so
unknown is never folded into "no clash" either. A meta-assertion proves all 132
coached corpus teams are fully id-keyed, so no corpus figure moved.

### Live defects on the shipped app, found and fixed on the same seam

- `PracticeOverridePanel` gated on `team.headCoach`, which nothing in the repo
  produces outside the mock client's seeds — its conflict check returned `null`
  for every override on real data. The same live zero-records class as #364.
  Fixed and driven through the rendered panel with teams built by the page's
  own `normalizeTeam()`.
- The roster CSV printed one coach per team and read `coach_id` through
  `profiles` when both id columns reference `coaches`; the embed was already
  wrong on `main`.
- Coach welcome emails addressed one coach per team.

### Deliberately left open

- The slot-1 role question, for the operator.
- `coach-maximum-gap` still `RULE_CONSTRAINT_UNENFORCED`; the three capacity
  codes still readable only on `capacities`. Neither module in this diff.
- `field-hour` is declared and used by nothing, with the reason asserted in
  both directions: `SlotSchema` has no field, so nothing here can honestly
  count ground. 8.3.
- GAP-24, as above.
- The `AdminReportingDashboard` query change is the least-covered hunk:
  verified against the migration and a working sibling query, but E2E runs in
  mock mode and the page has no integration test. Statically reviewed only.

### Process notes

- Two agents on this task hit session rate limits mid-round; both times the
  pushed state was clean and the work resumed from the PR body, which had been
  kept as a full spec. A thorough PR body is what makes an agent replaceable.
- Two pushes in this task family went out red on formatting alone.
  `npm run lint` covers `supabase/functions/**` even though those files are
  outside `tsconfig` and only execute under Deno; run it before every push, not
  at the end of a round.
