/**
 * The season-2026 corpus as people, coach assignments and personal timelines.
 *
 * The arrow still points fixtures -> people, never back: this module reads
 * nothing from disk and imports nothing from `packages/core/src/fixtures/`. It
 * takes the already-parsed roster rows and season object as arguments, exactly
 * as `ruleEngine/adapters/season2026Schedule.js` takes a parsed season and
 * `facility/adapters/season2026Geometry.js` takes parsed geometry.
 *
 * ## The interesting decision in this file
 *
 * **Which source each schedule row belongs to.** Incident 5 is a scrimmage that
 * arrived after the solve, so the mapping from row kind to
 * {@link COMMITMENT_SOURCE} is the seam where "we ingested the scrimmages"
 * becomes checkable. It is a table, so a reader can see at a glance that every
 * kind is accounted for and that `scrimmage` is not quietly filed under
 * `club-fixture` — which would make a timeline that never ingested scrimmages
 * indistinguishable from one that did.
 *
 * The corpus's four unknown-footprint rows (`Scrimmage`, GAP-14) are carried
 * **onto** the timeline with `endMinutes: null` rather than skipped. A
 * commitment of unknown length is still a commitment somebody has to be at, and
 * dropping it is precisely how an evening disappears from a coach's day.
 *
 * @module people/adapters/season2026People
 */

import {
  season2026SurfaceId,
  season2026VenueId,
} from '../../facility/adapters/season2026Geometry.js';
import { ASSIGNMENT_STATUS, COMMITMENT_SOURCE } from '../reasonCodes.js';
import { buildCoachRoster } from '../roster.js';
import { createTimelineSet, ingestCommitments, sealTimelines } from '../timeline.js';

/**
 * Which commitment source each schedule row kind contributes to.
 *
 * Mirrors `SEASON_2026_ROW_KIND` in `fixtures/season2026Parsers.js`, spelled
 * again rather than imported because that module reads the disk through
 * `node:fs` and `packages/core/src/people/` must not.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SEASON_2026_SOURCE_BY_ROW_KIND = Object.freeze({
  rec_game: COMMITMENT_SOURCE.CLUB_FIXTURE,
  minis_session: COMMITMENT_SOURCE.CLUB_FIXTURE,
  league_placeholder: COMMITMENT_SOURCE.CLUB_FIXTURE,
  external_fixture: COMMITMENT_SOURCE.EXTERNAL_FIXTURE,
  scrimmage: COMMITMENT_SOURCE.SCRIMMAGE,
  reservation: COMMITMENT_SOURCE.SCRIMMAGE,
});

/**
 * Every source this corpus can contribute, sorted.
 *
 * Derived from the table above rather than typed out, so a corpus whose rows
 * never mention scrimmages produces a shorter list instead of a required source
 * that can never be satisfied.
 *
 * @type {ReadonlyArray<string>}
 */
export const SEASON_2026_COMMITMENT_SOURCES = Object.freeze(
  [...new Set(Object.values(SEASON_2026_SOURCE_BY_ROW_KIND))].sort()
);

/**
 * The corpus's `Status` column as an {@link ASSIGNMENT_STATUS} value.
 *
 * Throws on a value the vocabulary does not know rather than defaulting to
 * `assigned`. GAP-23 is precisely that this column is an enum position nobody
 * has modelled; silently treating an unrecognised one as active would make a
 * declined coach count as fallback capacity.
 *
 * @param {string} value
 * @returns {string}
 */
export function season2026AssignmentStatus(value) {
  const normalised = String(value ?? '')
    .trim()
    .toLowerCase();
  const known = /** @type {string[]} */ (Object.values(ASSIGNMENT_STATUS)).includes(normalised);
  if (!known) {
    throw new Error(
      `people: coach assignment status "${value}" is not a known status; expected one of ${Object.values(ASSIGNMENT_STATUS).join(', ')}`
    );
  }
  return normalised;
}

/**
 * People, collapsed from roster rows by `Person Key`.
 *
 * A key seen under two spellings keeps the first as the display name and
 * records the rest as aliases — which is *not* identity resolution: this only
 * collapses rows that already share a key. Two keys for one person is
 * `identity.js`, and it never merges without a human.
 *
 * @param {ReadonlyArray<{ personKey: string, firstName: string, lastName: string }>} assignments
 * @returns {Array<import('../types.js').Person>}
 */
export function toSeason2026People(assignments) {
  /** @type {Map<string, { id: string, givenName: string, familyName: string, displayName: string, aliases: Set<string> }>} */
  const byKey = new Map();
  for (const row of assignments) {
    const id = String(row.personKey);
    const displayName = `${row.firstName} ${row.lastName}`;
    if (!byKey.has(id)) {
      byKey.set(id, {
        id,
        givenName: String(row.firstName),
        familyName: String(row.lastName),
        displayName,
        aliases: new Set(),
      });
      continue;
    }
    const person = /** @type {{ displayName: string, aliases: Set<string> }} */ (byKey.get(id));
    if (person.displayName !== displayName) person.aliases.add(displayName);
  }
  return [...byKey.values()]
    .map((person) => ({ ...person, aliases: [...person.aliases].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Roster rows as {@link import('../types.js').CoachAssignment} records.
 *
 * @param {ReadonlyArray<{ teamCode: string, personKey: string, coachSlot: number, status: string }>} assignments
 * @returns {Array<import('../types.js').CoachAssignment>}
 */
export function toSeason2026CoachAssignments(assignments) {
  return assignments
    .map((row) => ({
      id: `${row.teamCode}|${row.personKey}|${row.coachSlot}`,
      personId: String(row.personKey),
      teamId: String(row.teamCode),
      slot: Number(row.coachSlot),
      status: season2026AssignmentStatus(row.status),
      effectiveFrom: null,
      effectiveTo: null,
      source: 'coach_roster.csv',
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The whole roster in one call.
 *
 * @param {ReadonlyArray<Object>} assignments - parsed `coach_roster*.csv` rows
 * @returns {import('../types.js').CoachRoster}
 */
export function buildSeason2026CoachRoster(assignments) {
  return buildCoachRoster({
    people: toSeason2026People(
      /** @type {ReadonlyArray<{ personKey: string, firstName: string, lastName: string }>} */ (
        assignments
      )
    ),
    assignments: toSeason2026CoachAssignments(
      /** @type {ReadonlyArray<{ teamCode: string, personKey: string, coachSlot: number, status: string }>} */ (
        assignments
      )
    ),
  });
}

/**
 * Split the season's rows into one batch of commitments per source.
 *
 * A row contributes a commitment for every **rostered** coach of every side the
 * roster recognises as a team. A side the roster does not know is a placeholder
 * label, not a team (incident 4's second half), and contributes nothing.
 *
 * @param {{ combinedGames: ReadonlyArray<Object> }} season
 * @param {import('../types.js').CoachRoster} roster
 * @returns {Map<string, Array<Object>>} keyed by {@link COMMITMENT_SOURCE}
 */
export function toSeason2026CommitmentBatches(season, roster) {
  /** @type {Map<string, Array<Object>>} */
  const batches = new Map();
  for (const source of SEASON_2026_COMMITMENT_SOURCES) batches.set(source, []);

  for (const row of season.combinedGames) {
    const kind = String(/** @type {{ kind: string }} */ (row).kind);
    const source = SEASON_2026_SOURCE_BY_ROW_KIND[kind];
    if (source === undefined) {
      throw new Error(
        `people: schedule row kind "${kind}" has no commitment source; every kind must be filed, or a whole layer silently leaves the timeline`
      );
    }
    const game = /** @type {Record<string, any>} */ (row);
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!teamId) continue;
      const team = roster.teams.get(String(teamId));
      if (!team) continue;
      for (const personId of team.personIds) {
        /** @type {Array<Object>} */ (batches.get(source)).push({
          id: `${personId}|${game.id}`,
          personId,
          date: String(game.date),
          startMinutes: Number(game.kickoffMinutes),
          endMinutes: game.endMinutes === null ? null : Number(game.endMinutes),
          venueId: season2026VenueId(game.venue),
          surfaceId: season2026SurfaceId(game.venue, game.field),
          teamId: String(teamId),
          gameId: String(game.id),
          label: game.format ? String(game.format) : null,
          source,
        });
      }
    }
  }

  for (const [source, entries] of batches) {
    batches.set(
      source,
      entries.sort((a, b) => String(a.id).localeCompare(String(b.id)))
    );
  }
  return batches;
}

/**
 * Build the corpus's personal timelines, ingesting the named sources in order
 * and sealing against the required set.
 *
 * `sources` defaults to **every** source the corpus carries and
 * `requiredSources` to the same list, so the honest call is the short one and
 * the incident-5 call — ingest the club fixtures, solve, and add the scrimmages
 * afterwards — has to be written out deliberately.
 *
 * @param {{ combinedGames: ReadonlyArray<Object> }} season
 * @param {import('../types.js').CoachRoster} roster
 * @param {{ sources?: ReadonlyArray<string>, requiredSources?: ReadonlyArray<string>, seal?: boolean }} [options]
 * @returns {import('../types.js').TimelineSet}
 */
export function buildSeason2026Timelines(season, roster, options = {}) {
  const sources = options.sources ?? SEASON_2026_COMMITMENT_SOURCES;
  const requiredSources = options.requiredSources ?? SEASON_2026_COMMITMENT_SOURCES;
  const batches = toSeason2026CommitmentBatches(season, roster);

  let set = createTimelineSet();
  for (const source of sources) {
    set = ingestCommitments(set, batches.get(source) ?? [], { source });
  }
  return options.seal === false ? set : sealTimelines(set, { requiredSources });
}
