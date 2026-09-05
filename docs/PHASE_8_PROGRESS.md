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
