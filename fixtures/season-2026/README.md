# Season 2026 regression corpus

A full real season of youth-soccer scheduling data, anonymized (venues, coach
names, club and program names are pseudonyms; every structural relationship —
who coaches what, which fields overlap, which times were published — is
preserved exactly). This corpus exists because it encodes a season's worth of
edge cases that synthetic fixtures never produce. **A change that breaks these
fixtures is presumed wrong until shown otherwise.**

## Files

| File | Contents |
|---|---|
| `published_rec_schedule.csv` | The 567 rec games (4v4/5v5/7v7/9v9/Minis) exactly as published to families across 9 Saturdays. Treat as immutable ground truth. |
| `combined_schedule.csv` | All 679 rows: the published rec games plus the Select (11v11) layer — 8 external seeding games, weekly reserved league slots (teams TBD), scrimmages, and one field reservation. |
| `coach_roster.csv` | 215 coach assignments across 132 teams. `Coach Slot` 1 = the team's primary coach. `Person Key` is the identity key. |
| `coach_roster_v1.csv` | An earlier roster revision, identical except one person appears as "Nate Deverell" on one team and "Nathaniel Deverell" on the other — the identity-resolution test case. |
| `external_fixtures_published.csv` | The external league's 8 seeding fixtures **as they published them** (10:30/12:30 both days). The final agreement moved the 08/22 pair to 10:00/12:00; 08/23 stayed as published. The delta is the import-impact test case. |
| `facility_geometry.json` | Venue/field graph: parent-child field configurations, size and lining eligibility, lighting, and the overlap pairs that forbid concurrent play. |
| `facility_permits.csv` | Per-venue availability windows including the exceptions (one venue opens early on 09/12 and has **no permit at all on 09/19**). |
| `sunsets.csv` | Sunset per scheduled date. Unlit games must end 15 min before sunset. |
| `game_formats.csv` | Per-format timing: halves, halftime, occupancy, block, turnover floors. Note 11v11 occupancy is a range scheduled at its worst case. |

## Known-good invariants (assert these in fixture-integrity tests)

- 567 rec games; 679 combined rows; 132 teams; 215 assignments; 196 distinct people; 9 rec Saturdays; 13 scheduled dates total.
- Every rec team plays exactly 9 games, hosting 4 or 5.
- Round-robin complete within every division; opponent counts differ by at most 1.
- 3 rec games are single-coach (a co-coach covered), max 1 per team, and within every age group the conflict spread is ≤ 1.
- No unlit game ends within 15 min of sunset; no game sits outside its venue permit.
- No two concurrent games on an overlap pair (Alder Pitch 1&2 or 3&4) — including halves.
- Every 11v11 kickoff pair on one field is ≥ 120 min apart.
- The combined schedule's rec rows match `published_rec_schedule.csv` slot-for-slot and team-for-team (567/567).

## Incident log — why this corpus exists

Each incident below is a real failure from the source season. The prompts in
the build plan reference these by number.

1. **The 366-game reshuffle.** Integrating the 8 external fixtures required
   changes on two dates. Only those dates were frozen; the solver re-optimized
   the rest and produced an equally-valid schedule in which 366 of 679 games
   had silently moved — roughly half a season families already had times for.
   Recovery was only possible by re-importing the published schedule and
   treating it as ground truth. *Motivates: freeze scopes, minimal-diff
   objective, publication parity.*
2. **Repair passes leaked through the freeze.** After freeze support was added,
   the initial assignment honored it but the local-search and pair-repair
   stages quietly swapped four frozen games. Caught only by diffing. *Motivates:
   per-stage freeze tests.*
3. **The overlap rule arrived mid-project.** "Only Pitches 2 and 3 are
   11v11-sized; 1 and 4 split into halves; 2/3 physically overlap 1/4" was
   learned after several schedule versions had modeled fields as independent
   strings. Later, externally-published fixtures at 12:30 made an
   already-published 9v9 block illegal by exactly 10 minutes — resolved by
   negotiating the *external* times 30 minutes earlier, not by moving published
   games. *Motivates: facility graph, import impact analysis.*
4. **The validator that checked nothing.** A team-name format change
   (`U12B04` → `12B9v904`-style codes) made the coach validator's join match
   zero person-pairs. It reported zero conflicts — a perfect score meaning
   "I looked at nothing." A second checker misread placeholder labels as team
   codes and reported phantom violations. *Motivates: meta-assertions.*
5. **The stranded coach.** Scrimmages were appended after solving, so the
   optimizer never saw one coach's evening commitment and left him a 6.5-hour
   gap. *Motivates: external commitments enter the personal timeline before
   solving.*
6. **"Nate" vs "Nathaniel".** One person's two roster entries differed only in
   given-name form, hiding a real two-team coaching link across roster
   versions — and he was the sole coach of both teams, so the hidden link had
   no fallback. Reproduce with `coach_roster_v1.csv` vs `coach_roster.csv`.
   *Motivates: identity resolution with a review queue, derived must-attend.*
7. **The halftime ambiguity.** 11v11 duration was modeled as 90 minutes of
   total occupancy; had "90" meant 2×45 plus halftime, several published
   margins would have quietly gone tight with no error firing. Resolved:
   2×40 + 5-10 halftime inside a 90-minute footprint. *Motivates: occupancy vs
   play-time model, worst-case ranges.*
8. **Warm-up is occupancy.** Teams cannot warm up on a pitch that overlaps a
   live game. On the busiest date the answer to "earliest kickoff with a full
   30-minute warm-up" was 3:25 PM — bounded by a 9v9 game on the overlapping
   field until 2:55, not by anything on the field itself. *Motivates:
   schedulable warm-up, what-if queries.*
9. **A board waiver with a lifecycle.** A 60-minute travel floor was waived for
   one coach because two venues are ~5 minutes apart; the waiver then became
   unnecessary when times shifted, then relevant again. It lived in a code
   comment and was lost once across a rebuild. *Motivates: waivers as records,
   dormancy detection.*
10. **One fixture genuinely unplaceable.** In a reduced-venue scenario, one
    game had no legal slot. It was kept visible with TIME TBD / LOCATION TBD
    and a reason rather than dropped. *Motivates: unplaced fixtures as
    first-class state.*
