# Season 2026 — practice, registration and constraint corpus

The operating data the club actually ran the 2026 season on: the practice-slot
plan, the field constraint log, the coach and player registration exports, the
game-schedule change log, and the Select coach roster. It extends
[`../README.md`](../README.md) and **shares its pseudonym space** — a team code,
venue, field or person key here means the same thing it means there.

**A change that breaks these fixtures is presumed wrong until shown otherwise.**

## Anonymisation

Same standard as the game corpus: structural relationships preserved exactly,
identities replaced. Concretely:

- **The venue, field, team and person maps were *derived*, not invented.** The
  game schedule in this drop is the same season as `../combined_schedule.csv`,
  so the two were joined on `(date, kickoff, division, format)` and the
  pseudonyms read off the published corpus. That join produced a 1:1 map with
  **zero ambiguity** on all four axes: 6 venues, 22 fields, 136 team codes, and
  215 coach assignments resolving to 196 distinct people — the same 215/196 the
  game corpus states. No corpus pseudonym was changed.
- **People not in the game corpus** (registrants who coach no team, all players)
  were minted fresh with unique surnames, so a shared surname never implies a
  family that the source did not state. The 53 shared surnames in the combined
  set are all pre-existing pairs inside the published game corpus.
- **No free text ships.** The registration exports carry prose that names people
  in unpredictable forms ("… is the head coach and I would like to be her
  assistant coach. Her son is …"). Scrubbing arbitrary prose is not reliable, so
  those fields were replaced with resolved links plus a class label — see
  `coach_registration.csv` below. The class preserves the analytic signal; the
  prose is gone.
- **Dropped entirely:** email addresses, phone numbers, exact dates of birth,
  URLs, and the name of anyone who verified a constraint. Birth **year** is kept
  because age-group placement needs it.
- **Every file passes two independent leak audits** — one inside the writer that
  refuses to emit a cell still containing a real token, and one that re-scans the
  written files for full names, name tokens, organisation names, emails, URLs and
  date-of-birth patterns. Both report zero.

The real→pseudonym map is **not** in this repo and must not be committed.

## Files

| File | Rows | Contents |
|---|---|---|
| `practice_grid.csv` | 457 | Weekly practice assignments: venue, field, sub-unit, day, start, duration, team. `source_sheet` names which revision of the plan the row came from. |
| `practice_field_aliases.csv` | 20 | The club's "decoder ring": the name a field is given on the published practice schedule vs the field it actually is. |
| `field_constraints.csv` | 13 | Blackouts, closures and the adjacency rule, with date and time bounds. |
| `coach_registration.csv` | 201 | One row per coach registration: their player(s) as links, birth year, playing-up flag, and preferred co-coach as a link plus a class. |
| `player_registration.csv` | 1153 | Pseudonymous player, gender, birth year, age group, program, playing-up flag. |
| `game_change_log.csv` | 167 | The dated change history of the game schedule: what changed, from what, to what, and why. |
| `select_coaches.csv` | 22 | The Select (11v11) coach roster, supplied by the operator out of band because the registration export does not cover it. |

## Known-good invariants (assert these)

- 457 practice rows across 7 source sheets; 88 distinct teams hold a practice
  slot; 65 teams that play a game hold none in the parsed sheets.
- Exactly one practice team (`16BSelect02`) plays no game in
  `../combined_schedule.csv` — it is a Select team whose league layer is
  unassigned slots.
- Two slot regimes and no third: 45 minutes at 16:00/16:45/17:30, and 60 minutes
  at 16:00/17:00/18:00. Duration is derived from slot spacing, not asserted.
- Practices run Monday–Friday. **19 rows are Friday.**
- 201 coach registrations; 19 of them name a second player, i.e. coach two teams.
- 1153 players, 29 of them playing up.
- 13 constraint rows; 3 venues are closed for effectively the whole season
  (`Fivepines Park` reseeding, `Quarrywood Park` and `Cedarbrook Park` offline).

## What this corpus catches that the game corpus cannot

1. **A practice field alias points at a venue that is closed all season.**
   `7v7 Field 1` resolves to `Cedarbrook Park`, which `field_constraints.csv`
   declares `Offline` from 2026-08-01 to 2026-11-28. Eight further aliases
   resolve to `Maplewood`, which is closed on 2026-10-23. Nothing in the source
   reconciles the two sheets; the club holds them separately.

2. **Practices need a facility graph one level deeper than games do.** Games use
   `Alder Park / Pitch 2` and `Pitch 3` whole. Practices split both into `2A`/`2B`
   and `3A`/`3B`, and split `Pitch 1A`, `1B`, `4A` and `4B` again into `Side 1`.
   A graph built for the game layer will call two practices on `2A` and `2B`
   non-conflicting and will not know that a game on `Pitch 2` excludes both.

3. **The published field name is not the field.** `practice_field_aliases.csv` is
   a display layer: families read "Junior Field 1", the ground is
   `Maplewood Field 1`. Any conflict check that reasons over the published name
   is checking the wrong thing.

4. **Seven revisions of the plan coexist with no statement of which is current.**
   `source_sheet` is retained per row rather than resolved, because the source
   does not say. Two sheets carry 142 rows each and differ only in being a
   makeup week.

5. **No seasonal shortening is present.** The 60/50/40 phased-duration pattern
   the club describes does not appear in this file — every row sits in one of the
   two fixed regimes. Whatever shortening happens is not recorded here.

## Parse limits, stated rather than hidden

- 28 rows carry `venue = (unresolved)`: their source label names a field number
  with no venue, and the section heading that would supply it is not machine
  readable. They are kept, not dropped, so the count stays honest.
- Two sheets (`7v7 and 9v9 OLD`, and the coach-table halves of `GH` /
  `Junior (Maplewood)`) contribute no grid rows: their day headers are prose
  ("MONDAY AND WEDNESDAY") and their unique content is the team→coach mapping,
  which `../coach_roster.csv` already carries.
- `coach_registration.csv` resolves a preferred co-coach to a person key for 71
  rows outright and 24 more from prose. 29 are narrative with no resolvable name,
  9 are unresolved, 3 decline, 65 name nobody. The unresolved ones are the reason
  the prose is not shipped.
