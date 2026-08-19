# Model Gaps — `fixtures/season-2026` vs. the current domain types

> **Status**: input to the next phase of the scheduling build plan. Written while
> building the read-only fixture loader (`packages/core/src/fixtures/`) for the
> [season-2026 regression corpus](../fixtures/season-2026/README.md).
>
> **Rule that produced this file**: where the corpus contains something the current
> domain types cannot represent, the loader neither forces nor drops it. It keeps the
> value in a fixture-native shape and leaves a `TODO(GAP-nn)` at the site pointing
> here. Twenty honest gaps beat a loader that silently flattens the data.

## How to read an entry

Each gap records **the source field**, **a concrete example from the corpus**, **what
the current domain type does instead**, and **which later phase is likely to need it**.

Current domain types referenced throughout:

- `packages/core/src/types.js` — `Team`, `Player`, `Profile`, `Event`, `GameSlot`, `PracticeSlot`, `DivisionConfig`
- `packages/core/src/schemas/index.js` — `TeamSchema`, `SlotSchema`, `AssignmentSchema`
- `packages/core/src/gameScheduling.js` — `generateRoundRobinWeeks()`, `scheduleGames()`
- `packages/core/src/gameValidation.js` — `checkSlotAvailability()`, `checkCoachConflict()`, `validateGameMove()`

---

## Index

| ID                | Gap                                                | Corpus source                                              |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| [GAP-01](#gap-01) | No venue or field entity                           | `facility_geometry.json`                                   |
| [GAP-02](#gap-02) | Parent/child sub-fields                            | `facility_geometry.json`                                   |
| [GAP-03](#gap-03) | Spatial overlap between distinct fields            | `facility_geometry.json`                                   |
| [GAP-04](#gap-04) | Field size vs. lining eligibility                  | `facility_geometry.json`                                   |
| [GAP-05](#gap-05) | Venue lighting                                     | `facility_geometry.json`, `facility_permits.csv`           |
| [GAP-06](#gap-06) | Sunset per date                                    | `sunsets.csv`                                              |
| [GAP-07](#gap-07) | Venue permit windows                               | `facility_permits.csv`                                     |
| [GAP-08](#gap-08) | Per-venue-per-date permit exceptions and blackouts | `facility_permits.csv`                                     |
| [GAP-09](#gap-09) | Occupancy vs. play time                            | `game_formats.csv`                                         |
| [GAP-10](#gap-10) | Halftime as a range                                | `game_formats.csv`                                         |
| [GAP-11](#gap-11) | Block, turnover floor, turnover preference         | `game_formats.csv`                                         |
| [GAP-12](#gap-12) | Constraint hardness and scope                      | `facility_permits.csv`, `facility_geometry.json`           |
| [GAP-13](#gap-13) | Game format as a first-class attribute             | schedule CSVs                                              |
| [GAP-14](#gap-14) | Row formats with no timing definition              | `combined_schedule.csv`                                    |
| [GAP-15](#gap-15) | Opponent-less sessions (Minis)                     | `published_rec_schedule.csv`                               |
| [GAP-16](#gap-16) | Unnamed / TBD fixtures                             | `combined_schedule.csv`                                    |
| [GAP-17](#gap-17) | Field reservations that are not games              | `combined_schedule.csv`                                    |
| [GAP-18](#gap-18) | External (non-member) opponents                    | `combined_schedule.csv`, `external_fixtures_published.csv` |
| [GAP-19](#gap-19) | Person-centric commitment timeline                 | `coach_roster.csv` + `combined_schedule.csv`               |
| [GAP-20](#gap-20) | Multi-coach teams and coach slots                  | `coach_roster.csv`                                         |
| [GAP-21](#gap-21) | Identity resolution across roster revisions        | `coach_roster_v1.csv`                                      |
| [GAP-22](#gap-22) | Person entity distinct from `Profile`              | `coach_roster.csv`                                         |
| [GAP-23](#gap-23) | Coach-assignment status                            | `coach_roster.csv`                                         |
| [GAP-24](#gap-24) | Division labels are not a key                      | `combined_schedule.csv`                                    |
| [GAP-25](#gap-25) | Date-scoped equipment                              | `facility_geometry.json`                                   |
| [GAP-26](#gap-26) | Waivers as records with a lifecycle                | incident 9 (not in any file)                               |
| [GAP-27](#gap-27) | Warm-up as schedulable occupancy                   | incident 8                                                 |
| [GAP-28](#gap-28) | Unplaceable fixtures as first-class state          | incident 10                                                |
| [GAP-29](#gap-29) | Freeze scope and published baseline                | incidents 1 and 2                                          |
| [GAP-30](#gap-30) | Wall-clock times, timezone and DST                 | schedule CSVs, `sunsets.csv`                               |
| [GAP-31](#gap-31) | Per-field kickoff cadence                          | `game_formats.csv` + `combined_schedule.csv`               |
| [GAP-32](#gap-32) | Calendar dates vs. `weekIndex`                     | schedule CSVs                                              |
| [GAP-33](#gap-33) | Hosting balance and 9-game seasons                 | `published_rec_schedule.csv`                               |
| [GAP-34](#gap-34) | Import impact: published vs. agreed times          | `external_fixtures_published.csv`                          |

---

<a id="gap-01"></a>

### GAP-01 — No venue or field entity

- **Source**: `facility_geometry.json` → `venues["Alder Park"].fields["Pitch 1A"]`.
- **Example**: 7 venues and 24 distinct fields appear in `combined_schedule.csv`, each row carrying separate `Venue` and `Field` columns (`Alder Park`, `Pitch 1A`).
- **Today**: there is no `Venue` or `Field` type. `Event.location_id` is a bare UUID string and `GameSlot.fieldId` is an opaque string with no structure. The loader is forced to flatten to a synthetic composite key, `makeFieldId(venue, field)` → `"Alder Park::Pitch 1A"`.
- **Needed by**: Phase 1 (facility model). Everything from GAP-02 to GAP-05 hangs off this.

<a id="gap-02"></a>

### GAP-02 — Parent/child sub-fields

- **Source**: `facility_geometry.json` → `"Pitch 1": { "children": ["Pitch 1A", "Pitch 1B"] }`, `"Pitch 1A": { "parent": "Pitch 1" }`.
- **Example**: Alder Park has `Pitch 1` split into `1A`/`1B` and `Pitch 4` into `4A`/`4B`. The corpus never books a parent and one of its own halves at once, but nothing in the domain model expresses why that is illegal.
- **Today**: `checkSlotAvailability()` compares `String(a.fieldId) === String(fieldId)` — a booking on `Pitch 1` and one on `Pitch 1A` are two different strings, so it reports the slot as available.
- **Needed by**: Phase 1 (facility graph), Phase 2 (occupancy constraints).

<a id="gap-03"></a>

### GAP-03 — Spatial overlap between distinct fields

- **Source**: `facility_geometry.json` → `"overlap_pairs": [["Pitch 1","Pitch 2"], ["Pitch 3","Pitch 4"]]` plus `"overlap_note": "Overlap applies to a parent's halves too: a game on 1A conflicts with a concurrent game on 2 … Allowed concurrent: 1&3, 2&4, 2&3, 1&4."`
- **Example**: a 9v9 on `Pitch 1A` and an 11v11 on `Pitch 2` at the same time is physically impossible; `Pitch 2` and `Pitch 3` at the same time is fine.
- **Today**: fields are modelled as independent strings. The fixture test has to supply its own `fieldsOverlap()` helper because nothing in `packages/core` can answer the question.
- **Needed by**: Phase 1/2. This is incident 3 in the fixture README — the rule arrived mid-project after several schedule versions had already been produced against an independent-strings model.

<a id="gap-04"></a>

### GAP-04 — Field size vs. lining eligibility

- **Source**: `facility_geometry.json` → `"Upper 1": { "sizes": ["7v7","9v9"], "lined": ["7v7"], "note": "dedicated 7v7 this season" }`.
- **Example**: Brookside Park `Upper 1` is _big enough_ for 9v9 but is _lined_ only for 7v7 this season. Alder Park `Pitch 2`/`Pitch 3` are the only 11v11-sized surfaces at that venue.
- **Today**: nothing associates a field with the formats it can host. `GameSlot` has `capacity` (a count of concurrent games) and an optional `priority`, neither of which encodes eligibility. A solver has no way to refuse to put an 11v11 game on a 4v4 field.
- **Needed by**: Phase 2 (placement eligibility). Note "capable" and "eligible this season" are two different sets and both matter — a what-if query may legitimately ask about re-lining.

<a id="gap-05"></a>

### GAP-05 — Venue lighting

- **Source**: `facility_geometry.json` → `"Summit HS": { "lit": true }`; `facility_permits.csv` → `Lit` column.
- **Example**: Summit HS is the only lit venue; every scrimmage that runs past sunset is there. All other venues are `"lit": false`.
- **Today**: no lighting attribute anywhere. Without it the sunset rule (GAP-06) has no way to know which games it applies to.
- **Needed by**: Phase 1 (facility model), Phase 2 (daylight constraint).

<a id="gap-06"></a>

### GAP-06 — Sunset per date

- **Source**: `sunsets.csv` → `11/07/2026,4:44 PM,DST ends 11/01`.
- **Example**: on 10/31 sunset is 5:59 PM, so an unlit 9v9 (65-minute occupancy) cannot kick off after 4:39 PM. The corpus honours a 15-minute margin on all 669 unlit rows with a known footprint.
- **Today**: there is no sunset, daylight or per-date environment concept in any type. The 15-minute margin also has nowhere to live — see GAP-12.
- **Needed by**: Phase 2 (daylight constraint), Phase 4 (what-if "latest legal kickoff").

<a id="gap-07"></a>

### GAP-07 — Venue permit windows

- **Source**: `facility_permits.csv` → `Alder Park,SAT default,7:00 AM,8:00 PM,no,`.
- **Example**: Brookside Park closes at 6:00 PM while Alder Park runs to 8:00 PM; every one of the 675 rows with a known footprint sits inside its venue's window.
- **Today**: `GameSlot` is a `{ start, end, capacity }` triple that the caller must pre-generate. There is no venue-availability entity, so nothing can _derive_ legal slots or validate an arbitrary time against a venue.
- **Needed by**: Phase 1 (availability model), Phase 2 (slot generation).

<a id="gap-08"></a>

### GAP-08 — Per-venue-per-date permit exceptions and blackouts

- **Source**: `facility_permits.csv` → `Summit HS,SAT 09/12,2:00 PM,9:00 PM,yes,early open` and `Summit HS,SAT 09/19,—,—,yes,NO PERMIT this date`.
- **Example**: Summit HS normally opens at 5:00 PM on Saturdays, opens at 2:00 PM on 09/12, and is entirely unavailable on 09/19 (the corpus schedules zero games there that day).
- **Today**: no exception, override or blackout representation, and no precedence rule for "a date-scoped row wins over the weekday default". The loader implements `resolvePermit()` itself. An em-dash in both time columns is a third state — _not available at all_ — distinct from both "open all day" and "unknown".
- **Needed by**: Phase 1/2. Blackouts are what make incident 10 (unplaceable fixtures) reachable.

<a id="gap-09"></a>

### GAP-09 — Occupancy vs. play time

- **Source**: `game_formats.csv` → `11v11,Select (U14-U19),2,40,5-10,85-90 (schedule as 90),120,30 (in block),20`.
- **Example**: an 11v11 game is 2×40 minutes of play plus 5–10 minutes of halftime — 85 to 90 minutes of _occupancy_ — and the corpus instructs scheduling at the worst case, 90.
- **Today**: `Event` has `start_time`/`end_time` and `AssignmentSchema` has `start`/`end`. A single interval cannot distinguish "the ball is in play" from "the field is not available to anyone else", so a margin computed against play time silently under-counts.
- **Needed by**: Phase 1 (format model), Phase 2 (every margin computation). This is incident 7 — modelling 11v11 as a flat 90 minutes would have made several published margins go tight with no error firing.

<a id="gap-10"></a>

### GAP-10 — Halftime as a range

- **Source**: `game_formats.csv` → `Halftime min` = `5-10` for 11v11, `5` for 4v4/5v5/7v7/9v9, `-` for Minis.
- **Example**: the loader emits `{ min: 5, max: 10 }` for 11v11 and `null` for Minis (which has no halves at all).
- **Today**: no format entity exists to carry it, and no numeric field in the domain accepts a range. Any single number chosen here is a guess in one direction or the other.
- **Needed by**: Phase 1 (format model), Phase 4 (worst-case what-if queries).

<a id="gap-11"></a>

### GAP-11 — Block, turnover floor, turnover preference

- **Source**: `game_formats.csv` → `Block min`, `Turnover preferred`, `Turnover min`.
- **Example**: 9v9 is 65 minutes of occupancy inside an 85-minute block, with a 20-minute preferred turnover and a 10-minute floor. 11v11 has `Turnover preferred = 30 (in block)` — the preference is _already counted_ inside the 120-minute block, unlike every other format.
- **Today**: `GameSlot.capacity` is a count of concurrent games, not a cadence. There is no notion of a block, a turnover floor, or a soft turnover preference; `scheduleGames()` places matchups into pre-built slots and never reasons about the gap between them.
- **Needed by**: Phase 1 (format model), Phase 2 (slot generation and per-field cadence — see GAP-31).

<a id="gap-12"></a>

### GAP-12 — Constraint hardness and scope

- **Source**: `facility_permits.csv` → `Orchard Park,SAT default,…,traffic constraint: 20-min turnover HARD`; `facility_geometry.json` → `"notes": "traffic-constrained site: 20-min turnover is HARD here; Field 6 hosts the Minis sessions"`.
- **Example**: the 20-minute turnover is a _preference_ almost everywhere and a _hard_ rule at Orchard Park only. It is expressed as free text in a `Notes` column, scoped to one venue.
- **Today**: there is no constraint record at all — no id, no hardness (`hard`/`soft`), no scope (global / venue / date / division / person), no weight. Rules live as inline conditionals inside `scheduleGames()` and `gameValidation.js`. The rule "unlit games end 15 minutes before sunset" is in the same position: real, load-bearing, and unrepresentable.
- **Needed by**: Phase 2 (constraint registry). Prerequisite for GAP-26 (waivers are exceptions _to_ a constraint).

<a id="gap-13"></a>

### GAP-13 — Game format as a first-class attribute

- **Source**: `Format` column in both schedule CSVs → `Minis`, `4v4`, `5v5`, `7v7`, `9v9`, `11v11`, `Scrimmage`.
- **Example**: division `U06B` plays `4v4`; division `U12B` plays `9v9`. Format drives duration, field eligibility and cadence, and it is **not** derivable from division in general (`Select` covers both `11v11` league slots and `Scrimmage` rows).
- **Today**: neither `Team`, `Event`, `GameSlot` nor `DivisionConfig` has a `format` field. `DivisionConfig` has `slotsPerWeek` and roster sizes but nothing about the game itself.
- **Needed by**: Phase 1 (format model), Phase 2 (eligibility, duration).

<a id="gap-14"></a>

### GAP-14 — Row formats with no timing definition

- **Source**: `combined_schedule.csv` rows with `Format = Scrimmage` (4 of them); `game_formats.csv` has no `Scrimmage` row.
- **Example**: `08/22/2026,5:20 PM,Summit HS,Stadium,Scrimmage,16GS,16GSelect01,16GSelect02`. How long does it occupy the Stadium? The corpus does not say.
- **Today**: nothing distinguishes "duration 90" from "duration unknown". `AssignmentSchema` requires `end > start`, so an unknown-duration row cannot validate at all. **Loader behaviour**: `durationMinutes: null` and `end: null`, and the row is excluded from every duration-dependent check rather than being given an invented footprint. This is the one place the loader is knowingly blind, and the fixture test asserts the blindness explicitly.
- **Needed by**: Phase 1 (format model must allow an explicit unknown), Phase 5 (these rows still block a field).

<a id="gap-15"></a>

### GAP-15 — Opponent-less sessions (Minis)

- **Source**: `published_rec_schedule.csv` → `08/22/2026,9:00 AM,Orchard Park,Field 6,Minis,BB,MinisA,-`.
- **Example**: `MinisA`–`MinisD` are four _sessions_, not rostered teams. Each appears 9 times, always as `Home`, always with `Away = "-"`, and none of them is in `coach_roster.csv`. `game_formats.csv` gives Minis `Halves = -` and `Halftime = -` — there are no halves.
- **Today**: `AssignmentSchema.awayTeamId` is `refine(val => !!val)`, so a Minis session cannot be represented as an assignment. `Event` requires nothing but would model it as a "game" with a missing away side. The 122 rec entities are _not_ 122 teams (118 teams + 4 sessions), which is exactly the sort of miscount that produces phantom results.
- **Needed by**: Phase 1 (fixture kinds), Phase 3 (round-robin generation must skip these divisions).

<a id="gap-16"></a>

### GAP-16 — Unnamed / TBD fixtures

- **Source**: `combined_schedule.csv` → `09/12/2026,2:00 PM,Summit HS,Stadium,11v11,Select,Select Game 7,-`.
- **Example**: 100 rows — 10 labels (`Select Game 1` … `Select Game 10`) across 10 dates. These are real reserved league slots whose participating teams were not yet known when the schedule was published.
- **Today**: there is no placeholder-fixture entity. `Team.coachNeeded` is the only placeholder concept in the model and it is about a missing _coach_, not a missing team. Treating `Select Game 7` as a team code is precisely the second half of incident 4 — a checker that misread placeholder labels as team codes and reported phantom violations. **Loader behaviour**: classified as `league_placeholder`, `homeTeamId: null`, `homeIsPlaceholder: true`, never counted as a team.
- **Needed by**: Phase 5.1 (unnamed fixtures).

<a id="gap-17"></a>

### GAP-17 — Field reservations that are not games

- **Source**: `combined_schedule.csv` → `08/29/2026,5:30 PM,Alder Park,Pitch 2,Scrimmage,Select,Scrimmage - teams TBD,-`.
- **Example**: exactly one row. It occupies Alder Park Pitch 2 and therefore blocks Pitch 1 (GAP-03), but it has no home team, no away team, and no result.
- **Today**: `Event.type` is `'game' | 'practice' | 'meeting' | 'other'`. `'other'` loses the fact that this blocks a field, and `Event` still expects `home_team_id`/`away_team_id` to mean something. **Loader behaviour**: classified as `reservation` with both team ids null.
- **Needed by**: Phase 5.1 (reservations), Phase 2 (occupancy — a reservation must constrain the solver even though it is not a fixture).

<a id="gap-18"></a>

### GAP-18 — External (non-member) opponents

- **Source**: `combined_schedule.csv` / `external_fixtures_published.csv` → `Away = "Visiting Club A - U14G North"`, `"Visiting Club B - U14B (3)"`, `"Visiting Club C - U14G Delta"`.
- **Example**: 5 of the 8 seeding fixtures face a club that has no roster, no coaches and no id in this system; the other 3 are internal Select-vs-Select.
- **Today**: `AssignmentSchema.awayTeamId` requires a truthy id and `Team` requires a division; inventing a `Team` row for `Visiting Club A` would pollute team counts, round-robin generation and every division metric. There is no external-club or opponent-label entity.
- **Needed by**: Phase 5 (external fixtures), Phase 7.3 (import impact analysis).

<a id="gap-19"></a>

### GAP-19 — Person-centric commitment timeline

- **Source**: `coach_roster.csv` joined against **all** of `combined_schedule.csv`, including scrimmages and Select games.
- **Example**: incident 5 — a scrimmage appended after solving left one coach with a 6.5-hour gap because the optimizer never saw the evening commitment. In this corpus the three single-coach games are only detectable when Select and scrimmage rows are on the timeline alongside rec games.
- **Today**: `checkCoachConflict()` re-derives conflicts on every call from `team.coachId` over an `assignments` array, and only from that array. There is no persisted per-person timeline, no way to add a commitment that is not a scheduled assignment, and no notion of gap/idle time. **Loader behaviour**: `buildCoachTimelines()` assembles the timeline from the combined schedule, deliberately including non-rec rows.
- **Needed by**: Phase 3/4 (coach-experience objectives), Phase 5 (external commitments enter the timeline _before_ solving).

<a id="gap-20"></a>

### GAP-20 — Multi-coach teams and coach slots

- **Source**: `coach_roster.csv` → `Coach Slot` column; `06BMicro04,Greta,Wynn,1,greta wynn,Assigned` / `06BMicro04,Mara,Calder,2,mara calder,Assigned`.
- **Example**: 81 teams have 2 coaches, 50 have 1, and one has 3. Greta Wynn and Mara Calder co-coach _both_ `06BMicro04` and `08BJunior03`, whose 10/24 games overlap — so the pair splits, one each, and both games run single-coach.
- **Today**: `Team` has `coachId` plus `assistantCoachIds[]`, which loses the slot number and any notion of "who is required to attend". Worse, `checkCoachConflict()` only ever inspects `homeTeam.coachId` / `awayTeam.coachId`, so the assistant's conflicts are invisible to it — the three single-coach games in this corpus cannot be found with the current code. There is also no place to record _which_ coach covered a split.
- **Needed by**: Phase 3 (coach conflict objective), Phase 6 (derived must-attend).

<a id="gap-21"></a>

### GAP-21 — Identity resolution across roster revisions

- **Source**: `coach_roster_v1.csv` → `19GSelect01,Nate,Deverell,1,nate deverell` vs. `coach_roster.csv` → `19GSelect01,Nathaniel,Deverell,1,nathaniel deverell`.
- **Example**: the same person is slot-1 coach of `12G9v906` as "Nathaniel" in both files. In v1 the two-team link is hidden behind two distinct `Person Key`s — 197 keys instead of 196 — and he is the _sole_ coach of both teams, so the hidden link had no fallback.
- **Today**: `Person Key` is a lower-cased name string used as the identity key; there is no `Person` entity, no alias set, no confidence score and no review queue for probable matches. Any name-derived key silently splits or merges people.
- **Needed by**: Phase 6 (identity resolution with a review queue). Incident 6.

<a id="gap-22"></a>

### GAP-22 — Person entity distinct from `Profile`

- **Source**: `coach_roster.csv` → `Coach First`, `Coach Last`, `Person Key`.
- **Example**: 196 distinct people, none of whom has an email address, a UUID, or an authentication account in the corpus.
- **Today**: the only person-shaped type is `Profile`, which requires `id` (an Auth UUID), `email`, `role` and `organization_id`. A coach who exists on a roster but has never logged in cannot be represented, and the project's data-minimisation rule forbids fabricating an email to make one fit. **Loader behaviour**: people are emitted with the fixture's own `personKey`.
- **Needed by**: Phase 6 (people as domain entities separate from auth identities).

<a id="gap-23"></a>

### GAP-23 — Coach-assignment status

- **Source**: `coach_roster.csv` → `Status` column, `Assigned` on all 215 rows.
- **Example**: a single-valued column in this corpus, but it is clearly an enum position (pending / declined / withdrawn would all be meaningful) and it is the natural home for the lifecycle of an assignment.
- **Today**: `Team.assistantCoachIds` is a bare array of ids. There is no assignment record, therefore no status, no effective date, and nothing to audit against.
- **Needed by**: Phase 6 (roster assignment records). Also interacts with the `audit_log` requirement in `CLAUDE.md` — state-altering roster changes have nothing to log a _transition_ on.

<a id="gap-24"></a>

### GAP-24 — Division labels are not a key

- **Source**: `Division` column in `combined_schedule.csv`.
- **Example**: `16GSelect02` appears under division `U16G` (a scrimmage on 08/29) _and_ `16GS` (a scrimmage on 08/22) — the same team, two labels. `16BSelect02` is on the roster but appears in **no** fixture, so it has no observed division at all. Division values in the corpus mix schemes: `U05B`, `BB` (Minis), `Select`, `U14`, `16GS`.
- **Today**: `TeamSchema.division` is `refine(val => !!val)` — required and single-valued. `scheduleGames()` keys `roundRobinByDivision` by that string, so two labels for one team split it across two round robins. **Loader behaviour**: `division` is set only when exactly one division is observed; otherwise `null`, with every observed value kept in `observedDivisions`.
- **Needed by**: Phase 1 (division entity with a stable id), Phase 3 (round-robin grouping). This is the other half of incident 4 — a team-code format change made a validator's join match zero rows.

<a id="gap-25"></a>

### GAP-25 — Date-scoped equipment

- **Source**: `facility_geometry.json` → `"equipment_exceptions": [{ "venue": "Alder Park", "date": "2026-08-22", "equipment": "9v9 goals", "status": "was in doubt; confirmed available…" }]`.
- **Example**: one entry, kept deliberately as a fixture for the date-scoped-equipment case.
- **Today**: no equipment, resource or per-date-per-venue capability model. A field's ability to host a format is treated as static (and even that is missing — see GAP-04).
- **Needed by**: Phase 2 (eligibility that varies by date), Phase 4 (what-if under reduced equipment).

<a id="gap-26"></a>

### GAP-26 — Waivers as records with a lifecycle

- **Source**: incident 9 in the fixture README. Deliberately **not** in any file — that is the point: it lived in a code comment and was lost once across a rebuild.
- **Example**: a 60-minute travel floor was waived for one coach because two venues are ~5 minutes apart. The waiver later became unnecessary when times shifted, then relevant again.
- **Today**: no waiver, exception or override record of any kind. There is nowhere to store the subject (person / team / venue pair), the constraint being waived, the rationale, who approved it, or its validity window — and therefore no way to detect that a waiver has gone dormant.
- **Needed by**: Phase 2 (constraint registry — GAP-12 is a prerequisite), Phase 6 (waiver lifecycle and dormancy detection).

<a id="gap-27"></a>

### GAP-27 — Warm-up as schedulable occupancy

- **Source**: incident 8. Not a column in any file; it is a property of how the corpus' times were chosen.
- **Example**: on the busiest date, the earliest kickoff with a full 30-minute warm-up was 3:25 PM — bounded by a 9v9 game on the _overlapping_ field running until 2:55, not by anything on the field itself.
- **Today**: occupancy is whatever `start`–`end` says. Nothing models a pre-game window that also needs a legal, non-overlapping surface, so a warm-up requirement cannot even be stated, let alone checked.
- **Needed by**: Phase 2 (occupancy model), Phase 4 (what-if queries). Depends on GAP-03 and GAP-09.

<a id="gap-28"></a>

### GAP-28 — Unplaceable fixtures as first-class state

- **Source**: incident 10 — in a reduced-venue scenario, one game had no legal slot and was kept visible with `TIME TBD` / `LOCATION TBD` and a reason.
- **Today**: `scheduleGames()` returns `unscheduled: [{ weekIndex, division, matchup, reason }]`. That is a transient return value: it has no id, no venue/time TBD representation, no persistence, and no path into the published output. `Event` requires `start_time` and `end_time`, so a TBD fixture cannot be stored at all. The failure mode this guards against — silently dropping a fixture — is currently only prevented by whoever remembers to read `unscheduled`.
- **Needed by**: Phase 3 (solver output), Phase 5 (publication must show TBD rows, not omit them).

<a id="gap-29"></a>

### GAP-29 — Freeze scope and published baseline

- **Source**: incidents 1 and 2. The corpus _is_ the baseline: `published_rec_schedule.csv` is ground truth and `combined_schedule.csv` must match it 567-for-567.
- **Example**: integrating 8 external fixtures required changes on two dates; only those dates were frozen and the solver re-optimized the rest, silently moving 366 of 679 games. After freeze support was added, the local-search and pair-repair stages still swapped four frozen games.
- **Today**: neither `Event` nor the `scheduleGames()` assignment shape has a `frozen` flag, a freeze scope (date / division / venue / fixture), or a link to a published baseline version. There is no diff primitive, so "how many games moved" is not a question the model can answer.
- **Needed by**: Phase 3 (freeze-aware solver, per-stage freeze tests), Phase 7 (minimal-diff objective and publication parity).

<a id="gap-30"></a>

### GAP-30 — Wall-clock times, timezone and DST

- **Source**: `Date` + `Kickoff` columns (`08/22/2026`, `8:30 AM`); `sunsets.csv` note `DST ends 11/01` on the 11/07 and 11/14 rows.
- **Example**: two scheduled dates fall after the DST transition. Nothing in the corpus states a timezone — the times are local wall clock, as published to families.
- **Today**: `SlotSchema` and `AssignmentSchema` use `z.coerce.date()`, which turns a string into an absolute instant using the _host_ timezone. `Organization.settings` is an untyped blob with no timezone field, and there is no per-venue timezone. Round-tripping a published 8:30 AM through a differently-configured machine can move it. **Loader behaviour**: emits naive local ISO strings (`2026-11-07T16:44:00`, no offset) and does all arithmetic in minutes-past-midnight, never constructing a `Date` for schedule math.
- **Needed by**: Phase 1 (time model), and any persistence work — this one silently corrupts data rather than failing loudly.

<a id="gap-31"></a>

### GAP-31 — Per-field kickoff cadence

- **Source**: `game_formats.csv` → `11v11` `Block min = 120`, verified against `combined_schedule.csv`.
- **Example**: all 183 same-field, same-date 11v11 kickoff pairs are at least 120 minutes apart. That is the block driving the cadence, not the 90-minute occupancy.
- **Today**: `GameSlot.capacity` limits how many games share a slot; nothing constrains the _spacing_ between consecutive games on one field. A solver could legally emit back-to-back 11v11 games 90 minutes apart.
- **Needed by**: Phase 2 (slot generation from blocks rather than hand-supplied slots). Depends on GAP-11.

<a id="gap-32"></a>

### GAP-32 — Calendar dates vs. `weekIndex`

- **Source**: `Date` column. Rec Saturdays are 08/22, 08/29, 09/12, 09/19, 09/26, 10/03, 10/17, 10/24, 10/31 — 09/05 and 10/10 are skipped. The Select layer _does_ play on 10/10, and 08/23 is a Sunday.
- **Example**: 9 rec dates but 13 scheduled dates overall, with different layers active on different dates.
- **Today**: `AssignmentSchema.weekIndex` is `z.number().positive()` and `generateRoundRobinWeeks()` emits `weekIndex: 1..n-1`. Mapping dates onto week indices erases the gaps (there is no "week 3 has no rec games"), and there is no season-calendar entity holding the actual playing dates, holidays or per-layer date sets.
- **Needed by**: Phase 1 (season calendar), Phase 3 (the solver currently cannot express "this division does not play this week").

<a id="gap-33"></a>

### GAP-33 — Hosting balance and 9-game seasons

- **Source**: `published_rec_schedule.csv`. Every rec entity appears exactly 9 times; 59 host 4 and 59 host 5.
- **Example**: `U06B` has 12 teams — a full round robin is 11 weeks, but the season is 9 games, so each team meets 9 of its 11 opponents once. `U05B` has 8 teams — 7 opponents over 9 games, so each team plays two opponents twice. Both satisfy "opponent counts differ by at most 1".
- **Today**: `generateRoundRobinWeeks()` produces exactly `n-1` weeks of a single round robin and assigns home/away by lexicographic sort of the two ids. It cannot target a fixed games-per-team count, cannot do a partial round robin fairly, and has no hosting-balance objective at all. `DivisionConfig` has `slotsPerWeek` but no games-per-season.
- **Needed by**: Phase 3 (matchup generation). This is the single largest behavioural gap between the current engine and the corpus.

<a id="gap-34"></a>

### GAP-34 — Import impact: published vs. agreed times

- **Source**: `external_fixtures_published.csv` (all 8 at 10:30 / 12:30) vs. `combined_schedule.csv` (the 08/22 pair moved 30 minutes earlier to 10:00 / 12:00; 08/23 unchanged).
- **Example**: 4 fixtures moved, 4 unchanged. The 08/22 shift was negotiated with the _external_ league precisely so that already-published 9v9 games would not have to move — the externally-published 12:30 slot made an existing 9v9 block illegal by exactly 10 minutes (incident 3).
- **Today**: there is no import-impact concept: no way to represent "here is a proposed external commitment, tell me what it would break and what it would cost to move", and no representation of a negotiated delta between what an external party published and what was agreed. The two files can only be compared by hand.
- **Needed by**: Phase 7.3 (import impact analysis). Depends on GAP-18, GAP-29.

---

## Deliberate non-gaps

Recorded so a later phase does not "fix" something that is correct as-is:

- **`Away = "-"` is not missing data.** It is the corpus' explicit placeholder token and carries three distinct meanings depending on the row kind (Minis session, unnamed league slot, field reservation). The loader classifies rather than nulls-and-forgets.
- **`coach_roster_v1.csv` is not stale data to be deleted.** It is the incident-6 regression input and must keep diverging from `coach_roster.csv` in exactly one person.
- **The 4 Minis entities are not teams.** 122 rec entities = 118 teams + 4 sessions; 132 roster teams = 118 rec + 14 Select. Any count that produces 122 or 136 teams is wrong.
