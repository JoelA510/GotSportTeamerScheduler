/**
 * The season-2026 corpus's external import, as this module needs to see it.
 *
 * **Direction of the arrow: fixtures -> externalImport.** Every function here
 * takes already-parsed rows as arguments and imports nothing from
 * `packages/core/src/fixtures/`, exactly as
 * `publication/adapters/season2026Publication.js`,
 * `fairness/adapters/season2026Fairness.js` and
 * `facility/adapters/season2026Geometry.js` do for theirs.
 *
 * ## The one thing this file does not do
 *
 * It does **not** derive the venue mapping from
 * `parseExternalFixtures()`'s split.
 *
 * That is a deliberate departure from `season2026ExternalVenueMapping()` in
 * `publication/adapters/`, which does exactly that and says so — *"there is
 * therefore one external-naming transform in the repository, not two: the
 * loader's regex is explicitly the fixture-local transform and this is its
 * record form"*. The transform in question is
 * `/^(.*?)\s*\((?:Back\s+)?(.*?)\)$/`, and the `(?:Back\s+)?` in it is a rule
 * that **drops the word `Back`**. On this corpus it is right, because the
 * external league writes `Alder Park (Back Pitch 2)` for our `Pitch 2`. Applied
 * to a label the corpus does not contain — `Maplewood Back (Field 1)` — it
 * yields venue `Maplewood Back`, field `Field 1`, which is fine; applied to
 * `Maplewood (Back Field 1)` it yields `Maplewood` / `Field 1`, and there is no
 * such venue, only `Maplewood Back` and `Maplewood Front`, each with a `Field 1`.
 *
 * A parity report can afford that, because its answer is *"these two rows
 * differ"* and a bad split shows up as a difference. An **import** cannot: its
 * answer is *"accept this and move that fixture"*, and a bad split moves the
 * wrong ground. So {@link SEASON_2026_EXTERNAL_MAPPING_RECORDS} is written out,
 * one record per label the league actually publishes, each carrying its own
 * provenance — the same footing as `SEASON_2026_VENUE_COMPLEXES`, which is
 * spelled out for the same reason and says so in its own comment: *"a shared
 * first word is not a fact about geography"*.
 *
 * The cost is real and is stated: a label the league invents next season
 * resolves to nothing until somebody writes a record, and the import reports it
 * at blocking. That is the intended failure.
 *
 * @module externalImport/adapters/season2026ExternalImport
 */

import {
  season2026SurfaceId,
  season2026VenueId,
} from '../../facility/adapters/season2026Geometry.js';

import { EXTERNAL_MAPPING_KIND } from '../mapping.js';

/** The external party this corpus's mapping translates. */
export const SEASON_2026_EXTERNAL_PARTY = 'external seeding league';

/**
 * **The mapping table, written out.**
 *
 * Two records, because `external_fixtures_published.csv` uses two labels. Each
 * names the venue **and** the surface, because the league's single cell carries
 * both of ours and splitting it is the whole mapping.
 *
 * The ids come from `season2026VenueId()` / `season2026SurfaceId()` rather than
 * being typed as strings, so a renamed corpus venue produces a record naming a
 * surface nothing else knows — which `buildExternalMappingRegistry()` reports as
 * `EXTERNAL_MAPPING_TARGET_UNKNOWN` when it is given a graph — rather than a
 * quietly different id.
 *
 * @type {ReadonlyArray<Object>}
 */
export const SEASON_2026_EXTERNAL_MAPPING_RECORDS = Object.freeze([
  Object.freeze({
    id: 'season-2026/external/alder-back-pitch-2',
    kind: EXTERNAL_MAPPING_KIND.VENUE,
    externalLabel: 'Alder Park (Back Pitch 2)',
    venueId: season2026VenueId('Alder Park'),
    surfaceId: season2026SurfaceId('Alder Park', 'Pitch 2'),
    subjectId: null,
    provenance:
      'external_fixtures_published.csv "Venue (external naming)"; the pairing with Alder Park / Pitch 2 is the club\'s statement of what the league means by it, not a transform of the string',
    statedBy: 'club operations',
    statedOn: '2026-08-15',
    note: 'the league calls the two 11v11 pitches the "back" pitches; the word is part of their name for it and is not stripped',
  }),
  Object.freeze({
    id: 'season-2026/external/alder-back-pitch-3',
    kind: EXTERNAL_MAPPING_KIND.VENUE,
    externalLabel: 'Alder Park (Back Pitch 3)',
    venueId: season2026VenueId('Alder Park'),
    surfaceId: season2026SurfaceId('Alder Park', 'Pitch 3'),
    subjectId: null,
    provenance:
      'external_fixtures_published.csv "Venue (external naming)"; the pairing with Alder Park / Pitch 3 is the club\'s statement of what the league means by it, not a transform of the string',
    statedBy: 'club operations',
    statedOn: '2026-08-15',
    note: null,
  }),
]);

/**
 * The registry input for this corpus.
 *
 * @param {{ records?: ReadonlyArray<Object> }} [options]
 * @returns {Object} an `ExternalMappingRegistryInputSchema` value
 */
export function season2026ExternalMappingInput(options = {}) {
  return {
    registryId: 'season-2026/external-seeding-league',
    label: 'season-2026 external seeding league naming',
    party: SEASON_2026_EXTERNAL_PARTY,
    records: [...(options.records ?? SEASON_2026_EXTERNAL_MAPPING_RECORDS)],
  };
}

/**
 * The externally-published fixtures as import rows.
 *
 * `venueLabel` carries the **raw** `Venue (external naming)` cell, not the
 * loader's split of it. This is the artifact as the other party published it,
 * and translating it here would be doing the mapping's job inside the adapter,
 * where nothing could report whether it happened — the same reason
 * `season2026ExternalParityRows()` gives for keeping it raw.
 *
 * `format` and `division` are `null` because the file has no such columns. Asked
 * for, they come back **one-sided** — `EXTERNAL_FIELD_ONE_SIDED`, naming our
 * side as the one that carries them — rather than compared against null. They
 * are not `EXTERNAL_FIELD_UNCOMPARED`, which is the narrower fact that neither
 * artifact states the field at all, and they are not
 * `EXTERNAL_FIELD_UNTRANSLATED` either: the league's file is silent about
 * format, where its venue column speaks in a vocabulary we have to translate.
 *
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026ExternalFixture>} fixtures
 * @param {string} [sourceLabel]
 * @returns {Object[]} `ExternalFixtureRowSchema` values
 */
export function toSeason2026ExternalRows(
  fixtures,
  sourceLabel = 'external_fixtures_published.csv'
) {
  return fixtures.map((fixture, index) => ({
    rowId: `${sourceLabel}#${index}`,
    sourceLabel,
    date: fixture.date,
    kickoffMinutes: fixture.kickoffMinutes,
    venueLabel: fixture.externalVenueLabel,
    homeLabel: fixture.homeLabel,
    awayLabel: fixture.awayLabel,
    format: null,
    division: null,
  }));
}

/**
 * Combined-schedule rows as the fixtures we hold.
 *
 * `endMinutes` comes through as the loader computed it, which is `null` for the
 * corpus's `Scrimmage` rows (GAP-14) — carried, never defaulted, because that
 * null is what makes an impact verdict `undetermined` instead of `safe`.
 *
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026Game>} games
 * @returns {Object[]} `StandingFixtureSchema` values
 */
export function toSeason2026StandingFixtures(games) {
  return games.map((game) => ({
    fixtureId: game.id,
    date: game.date,
    kickoffMinutes: game.kickoffMinutes,
    endMinutes: game.endMinutes,
    venueId: season2026VenueId(game.venue),
    surfaceId: season2026SurfaceId(game.venue, game.field),
    format: game.format === '' ? null : game.format,
    division: game.division === '' ? null : game.division,
    homeLabel: game.homeLabel === '' ? null : game.homeLabel,
    awayLabel: game.awayLabel === '' ? null : game.awayLabel,
  }));
}

/**
 * The import query for this corpus.
 *
 * `comparedFields` is `kickoffMinutes` + `venueId` + `surfaceId`: the three the
 * external file can honestly be compared on. `format` and `division` are left
 * out of the *request* as well as being null on every row, so the report says
 * nothing about a field it was not asked to compare — the narrower subject is
 * stated rather than assumed, exactly as `SEASON_2026_EXTERNAL_COMPARED_FIELDS`
 * states it for parity.
 *
 * @param {Object} input
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026ExternalFixture>} input.externalFixtures
 * @param {ReadonlyArray<import('../../fixtures/season2026Parsers.js').Season2026Game>} input.combinedGames
 * @returns {Object} an `ExternalImportQuerySchema` value
 */
export function season2026ExternalImportQuery({ externalFixtures, combinedGames }) {
  return {
    subject: 'season-2026 external seeding fixtures against the agreed times',
    rows: toSeason2026ExternalRows(externalFixtures),
    standing: toSeason2026StandingFixtures(combinedGames),
    keyFields: ['date', 'home', 'away'],
    comparedFields: ['kickoffMinutes', 'venueId', 'surfaceId'],
  };
}
