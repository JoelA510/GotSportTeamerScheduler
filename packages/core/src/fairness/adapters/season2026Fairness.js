/**
 * The season-2026 corpus as a fairness fixture list.
 *
 * The arrow points fixtures -> fairness and never back: this module reads
 * nothing from disk and imports nothing from `packages/core/src/fixtures/`. It
 * takes the already-parsed rows as an argument, exactly as
 * `facility/adapters/season2026Geometry.js` takes parsed geometry and
 * `ruleEngine/adapters/season2026Schedule.js` takes parsed schedule rows.
 *
 * ## The three decisions in this file, and the evidence for each
 *
 * **1. Which rows are fixtures at all.** `combined_schedule.csv` has 679 rows and
 * 152 distinct labels in its `Home`/`Away` columns. 101 of those rows name no
 * participant on either side: the 100 `Select Game N` reserved league slots
 * whose teams were still TBD, and the one `Scrimmage - teams TBD` field
 * reservation. `fixtures/season2026Parsers.js` already classifies both —
 * `league_placeholder` and `reservation` — so this adapter does not re-derive
 * the judgement, it reads it. They are **dropped**, and the count is returned so
 * the caller can state it rather than discover a shortfall.
 *
 * A naive parse that keeps them yields **152** labels; removing the `-` token
 * and the ten `Select Game N` labels yields 141, and removing
 * `Scrimmage - teams TBD` — a third placeholder, and the one an eleven-label
 * exclusion list misses — yields the real participant count of **140**.
 *
 * **2. Which competition each row belongs to.** A straight read of
 * `SEASON_2026_ROW_KIND`, tabulated in `../classification.js`. `rec_game` and
 * `minis_session` are the club's own league (the round robin the corpus README
 * declares complete within every division); `external_fixture` is the other
 * league's eight seeding games; `scrimmage` is a friendly.
 *
 * **3. What `homeSubjectId` / `awaySubjectId` mean.** The loader sets
 * `awayTeamId` to null for the `-` token, which is the right call for a loader
 * and is exactly the signal this module needs: a Minis session names one side
 * and no opponent, and that is a property of the row rather than of the team. It
 * is **not** re-derived from the format name here — nothing in `fairness/` tests
 * for the string `Minis` — because a one-sided fixture is one-sided whatever it
 * is called.
 *
 * Unlike `ruleEngine/adapters/season2026Schedule.js`, this adapter does **not**
 * refuse participants that are absent from the coach roster. That adapter is
 * right to: a rule about coaching cover needs a coachable team. A fairness
 * report needs everything that took the field, and the four Minis sides and the
 * five visiting-club labels are off-roster and did. Roster membership travels
 * separately, through `memberSubjectIds`, and changes no metric.
 *
 * @module fairness/adapters/season2026Fairness
 */

import { FAIRNESS_COMPETITION } from '../classification.js';

/**
 * `SEASON_2026_ROW_KIND` -> {@link FAIRNESS_COMPETITION}, or `null` for a row
 * that names no participant and is therefore not a fixture.
 *
 * Spelled again rather than imported, exactly as
 * `SEASON_2026_COUNTED_ROW_KINDS` is in `ruleEngine/adapters/`, because
 * `fixtures/season2026Parsers.js` reads the disk through `node:fs` and
 * `packages/core/src/fairness/` must not.
 *
 * A row kind absent from this table throws rather than defaulting: a new kind
 * arriving is a decision somebody has to make, not one to be made by falling
 * through to `league`.
 *
 * @type {Readonly<Record<string, string|null>>}
 */
export const SEASON_2026_COMPETITION_OF_ROW_KIND = Object.freeze({
  rec_game: FAIRNESS_COMPETITION.LEAGUE,
  minis_session: FAIRNESS_COMPETITION.LEAGUE,
  external_fixture: FAIRNESS_COMPETITION.EXTERNAL,
  scrimmage: FAIRNESS_COMPETITION.FRIENDLY,
  league_placeholder: null,
  reservation: null,
});

/**
 * The age group a division label belongs to, or null.
 *
 * A *label* parse, and it lives in the adapter for the reason
 * `season2026AgeGroup()` does in `ruleEngine/adapters/`: GAP-24 records that
 * division labels are not keys, so the core never does this and the layer that
 * knows how this corpus spells its labels does it once.
 *
 * `BB` — the Minis division — and `Select` parse to `null`, which is why the
 * four Minis sides are judged under no age-group cohort and say so.
 *
 * @param {string|null|undefined} division
 * @returns {string|null}
 */
export function season2026FairnessAgeGroup(division) {
  const match = String(division ?? '').match(/^U?(\d{1,2})/);
  return match ? `U${match[1].padStart(2, '0')}` : null;
}

/**
 * Build a fairness fixture list from the corpus' parsed schedule rows.
 *
 * @param {ReadonlyArray<Object>} rows - `loadCombinedSchedule()` output
 * @param {{ scopeId?: string }} [options]
 * @returns {{ fixtures: import('../types.js').FairnessFixture[], droppedByRowKind: Readonly<Record<string, number>>, rowsRead: number }}
 */
export function toSeason2026FairnessFixtures(rows, options = {}) {
  const scopeId = options.scopeId ?? 'season-2026';
  /** @type {import('../types.js').FairnessFixture[]} */
  const fixtures = [];
  /** @type {Record<string, number>} */
  const dropped = {};

  for (const row of rows) {
    if (!Object.hasOwn(SEASON_2026_COMPETITION_OF_ROW_KIND, row.kind)) {
      throw new Error(
        `fairness/season2026: row kind ${JSON.stringify(row.kind)} has no competition mapping; a new kind is a decision to make, not one to fall through to "league"`
      );
    }
    const competition = SEASON_2026_COMPETITION_OF_ROW_KIND[row.kind];
    if (competition === null) {
      dropped[row.kind] = (dropped[row.kind] ?? 0) + 1;
      continue;
    }
    const division = row.division === null || row.division === '' ? null : String(row.division);
    fixtures.push({
      fixtureId: String(row.id),
      scopeId,
      competition,
      date: String(row.date),
      kickoffMinutes: Number.isFinite(row.kickoffMinutes) ? row.kickoffMinutes : null,
      venueId: row.venue ? String(row.venue) : null,
      surfaceId: row.fieldId ? String(row.fieldId) : null,
      division,
      ageGroup: season2026FairnessAgeGroup(division),
      format: row.format ? String(row.format) : null,
      homeSubjectId: row.homeTeamId === null ? null : String(row.homeTeamId),
      awaySubjectId: row.awayTeamId === null ? null : String(row.awayTeamId),
    });
  }

  return { fixtures, droppedByRowKind: Object.freeze(dropped), rowsRead: rows.length };
}
