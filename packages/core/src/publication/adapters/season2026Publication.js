/**
 * The season-2026 corpus's two parity subjects, and the one mapping table it
 * genuinely needs.
 *
 * **Direction of the arrow: fixtures -> publication.** This module takes
 * already-parsed rows as arguments and imports nothing from
 * `packages/core/src/fixtures/`, exactly as
 * `reserve/adapters/season2026Reserve.js` and
 * `facility/adapters/season2026Geometry.js` do.
 *
 * ## Why there are two subjects rather than one
 *
 * The build plan's acceptance test is *"load the published export and the final
 * workbook, run parity with field-name mapping, and assert 567/567 rec games
 * match while correctly reporting the 11v11-layer rows as additions"*. That
 * test was run during the design pass and it has a trap in it: the 567 rec rows
 * are **byte-identical across all eight columns** between
 * `published_rec_schedule.csv` and `combined_schedule.csv`, so an **empty
 * mapping table passes it**. All three of the prompt's own mapping examples are
 * invented — no corpus row contains `Brookside Field 1`, only `MinisA`–`MinisD`
 * exist and never `Minis01`, and the single literal `TBD` is in the `Home`
 * column rather than as an opponent.
 *
 * So the mapping table gets its own subject:
 *
 * | subject | published side | current side | mapping |
 * | --- | --- | --- | --- |
 * | **A — {@link season2026PublishedParityInput}** | `published_rec_schedule.csv`, 567 rows | `combined_schedule.csv`, 679 rows | none declared; the report says `mappingRulesApplied: 0` rather than implying one |
 * | **B — {@link season2026ExternalParityInput}** | `external_fixtures_published.csv`, 8 rows in the external league's own naming | the 8 `external_fixture` rows of the combined schedule | every row goes through a venue-label rule |
 *
 * Subject A is the acceptance test. Subject B is the run that proves the
 * mapping works, because `Alder Park (Back Pitch 2)` is a label that genuinely
 * does not appear anywhere in internal storage.
 *
 * ## The mapping table is derived, not typed in
 *
 * {@link season2026ExternalVenueMapping} builds its rules from the fixtures the
 * loader already parsed — `parseExternalFixtures()` splits
 * `Alder Park (Back Pitch 2)` into a venue and a field with a regex, and this
 * records **that** split as rules with provenance. There is therefore one
 * external-naming transform in the repository, not two: the loader's regex is
 * explicitly the fixture-local transform and this is its record form.
 *
 * The consequence is that these particular rules cannot go stale, which is
 * exactly why `MAPPING_RULE_UNEXERCISED` exists for the hand-written tables
 * that can. `tests/publicationParity.test.js` constructs one — using the build
 * plan's own invented `Brookside Field 1` example — and proves the check fires
 * at blocking.
 *
 * @module publication/adapters/season2026Publication
 */

import { DEFAULT_PARITY_KEY_FIELDS, PARITY_FIELD, makeParityRow } from '../rows.js';

/**
 * Subject A and B both key a fixture the way a family knows it — date and both
 * sides, which is the package default rather than a second list of the same
 * three fields.
 */
export const SEASON_2026_PARITY_KEY_FIELDS = DEFAULT_PARITY_KEY_FIELDS;

/**
 * Everything else the two schedule CSVs carry. All five, so "567/567 match"
 * means all eight columns and not a convenient subset of them.
 */
export const SEASON_2026_REC_COMPARED_FIELDS = Object.freeze([
  PARITY_FIELD.START_MINUTES,
  PARITY_FIELD.VENUE,
  PARITY_FIELD.FIELD,
  PARITY_FIELD.FORMAT,
  PARITY_FIELD.DIVISION,
]);

/**
 * What the external file can honestly be compared on.
 *
 * `external_fixtures_published.csv` has no `Format` and no `Division` column at
 * all, so those two are left out of the comparison rather than compared against
 * `null` — and `checkParity()` reports them as `PARITY_FIELD_UNCOMPARED` at
 * `compromise`, so the narrower subject is stated rather than assumed.
 */
export const SEASON_2026_EXTERNAL_COMPARED_FIELDS = Object.freeze([
  PARITY_FIELD.START_MINUTES,
  PARITY_FIELD.VENUE,
  PARITY_FIELD.FIELD,
]);

/**
 * One parsed schedule row as a parity row.
 *
 * @param {import('../../fixtures/season2026Parsers.js').Season2026Game} game
 * @param {string} sourceLabel
 * @returns {import('../types.js').ParityRow}
 */
export function season2026ParityRow(game, sourceLabel) {
  return makeParityRow({
    rowId: game.id,
    sourceLabel,
    date: game.date,
    startMinutes: game.kickoffMinutes,
    venue: game.venue,
    field: game.field,
    format: game.format,
    division: game.division,
    home: game.homeLabel,
    away: game.awayLabel,
  });
}

/**
 * A whole parsed schedule as parity rows.
 *
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026Game>} games
 * @param {string} sourceLabel
 * @returns {import('../types.js').ParityRow[]}
 */
export function season2026ParityRows(games, sourceLabel) {
  return games.map((game) => season2026ParityRow(game, sourceLabel));
}

/**
 * The externally-published fixtures as parity rows, **in the external league's
 * own naming**.
 *
 * `venue` deliberately carries the raw `Alder Park (Back Pitch 2)` and `field`
 * is `null`: this is the artifact as the other party published it, and
 * translating it here would be doing the mapping's job inside the adapter,
 * where nothing could report whether it happened.
 *
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026ExternalFixture>} fixtures
 * @param {string} sourceLabel
 * @returns {import('../types.js').ParityRow[]}
 */
export function season2026ExternalParityRows(fixtures, sourceLabel) {
  return fixtures.map((fixture, index) =>
    makeParityRow({
      rowId: `${sourceLabel}#${index}`,
      sourceLabel,
      date: fixture.date,
      startMinutes: fixture.kickoffMinutes,
      venue: fixture.externalVenueLabel,
      field: null,
      format: null,
      division: null,
      home: fixture.homeLabel,
      away: fixture.awayLabel,
    })
  );
}

/**
 * Venue-label rules from the external league's naming to the club's.
 *
 * One rule per distinct external label, carrying the venue **and** the field
 * the loader's regex resolved it to — the public cell holds both, and splitting
 * it is the whole mapping. A label the regex could not resolve produces no rule
 * and its rows will report as differing, which is the honest outcome: an
 * unrecognised venue name is not a match.
 *
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026ExternalFixture>} fixtures
 * @returns {Array<{ id: string, appliesTo: string, match: Record<string, string>, set: Record<string, string>, provenance: string }>}
 */
export function season2026ExternalVenueMapping(fixtures) {
  /** @type {Map<string, { venue: string, field: string }>} */
  const byLabel = new Map();
  for (const fixture of fixtures) {
    if (fixture.venue === null || fixture.field === null) continue;
    if (byLabel.has(fixture.externalVenueLabel)) continue;
    byLabel.set(fixture.externalVenueLabel, { venue: fixture.venue, field: fixture.field });
  }

  return [...byLabel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, resolved]) => ({
      id: `external-venue:${label}`,
      appliesTo: 'published',
      match: { [PARITY_FIELD.VENUE]: label },
      set: { [PARITY_FIELD.VENUE]: resolved.venue, [PARITY_FIELD.FIELD]: resolved.field },
      provenance:
        'external_fixtures_published.csv "Venue (external naming)", split by the fixture-local regex in parseExternalFixtures()',
    }));
}

/**
 * **Subject A** — the published rec schedule against the final workbook.
 *
 * 567 published rows against 679 current ones. The 112 that have no published
 * counterpart are the whole Select/11v11 layer and are `added`, not
 * `differing`.
 *
 * @param {Object} input
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026Game>} input.publishedRecGames
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026Game>} input.combinedGames
 * @returns {Object} an input for `checkParity()`
 */
export function season2026PublishedParityInput({ publishedRecGames, combinedGames }) {
  return {
    subject: 'season-2026 published rec schedule vs the final workbook',
    published: {
      label: 'published_rec_schedule.csv',
      rows: season2026ParityRows(publishedRecGames, 'published_rec_schedule.csv'),
    },
    current: {
      label: 'combined_schedule.csv',
      rows: season2026ParityRows(combinedGames, 'combined_schedule.csv'),
    },
    keyFields: SEASON_2026_PARITY_KEY_FIELDS,
    comparedFields: SEASON_2026_REC_COMPARED_FIELDS,
    // Declared empty on purpose: the two artifacts are written in the same
    // vocabulary, and a rule invented to make the table look used would be a
    // rule nothing could falsify. The result says `mappingRulesApplied: 0`.
    mappingRules: [],
  };
}

/**
 * **Subject B** — the external league's published fixtures, in its own naming,
 * against the agreed times.
 *
 * 8 rows, every one of them going through the venue-label mapping; 4 match and
 * 4 differ by the 30 minutes that were negotiated on 08/22 (incident 3,
 * GAP-34).
 *
 * @param {Object} input
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026ExternalFixture>} input.externalFixtures
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026Game>} input.agreedGames
 * @returns {Object} an input for `checkParity()`
 */
export function season2026ExternalParityInput({ externalFixtures, agreedGames }) {
  return {
    subject: 'season-2026 externally-published fixtures vs the agreed times',
    published: {
      label: 'external_fixtures_published.csv',
      rows: season2026ExternalParityRows(externalFixtures, 'external_fixtures_published.csv'),
    },
    current: {
      label: 'combined_schedule.csv (external_fixture rows)',
      rows: season2026ParityRows(agreedGames, 'combined_schedule.csv'),
    },
    keyFields: SEASON_2026_PARITY_KEY_FIELDS,
    comparedFields: SEASON_2026_EXTERNAL_COMPARED_FIELDS,
    mappingRules: season2026ExternalVenueMapping(externalFixtures),
  };
}
