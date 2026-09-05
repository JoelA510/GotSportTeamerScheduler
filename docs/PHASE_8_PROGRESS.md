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
