/**
 * Read-only loader for the `fixtures/season-2026/` regression corpus.
 *
 * This is a **test/dev fixture loader**: it is never imported by the frontend
 * bundle, and it is the only module in `@squadlogic/core` allowed to touch
 * `node:fs`. Every read is `readFileSync(..., 'utf8')`; nothing here writes,
 * renames, or otherwise mutates the source files. `computeFixtureChecksums()`
 * exists so tests can prove that.
 *
 * The parsing is done by pure string functions in `season2026Parsers.js`; this
 * module only does file IO and cross-file assembly.
 *
 * **Preserve, do not flatten.** Placeholder rows, unnamed league slots, the
 * field reservation, the scrimmages and the external fixtures are all carried
 * through with an explicit row kind. Where the current domain model cannot
 * represent something, this file carries a `TODO(GAP-nn)` referencing
 * `docs/MODEL_GAPS.md` instead of coercing or dropping the data.
 *
 * @module fixtures/season2026Loader
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  fieldsOverlap,
  indexFormats,
  overlapRootField,
  parseCoachRoster,
  parseExternalFixtures,
  parseFacilityGeometry,
  parseFacilityPermits,
  parseGameFormats,
  parseScheduleCsv,
  parseSunsets,
  publicationKey,
  resolvePermit,
  resolveSunsetMinutes,
  SEASON_2026_ROW_KIND,
} from './season2026Parsers.js';

/** Path of the corpus relative to the repository root. */
const FIXTURE_RELATIVE_DIR = path.join('fixtures', 'season-2026');

/**
 * Default location of the corpus.
 *
 * Resolved from this module's own path rather than the process working
 * directory, so the loader works from tests, scripts and REPLs alike. The
 * `fileURLToPath(import.meta.url)` form is deliberate: the shorthand
 * `new URL('../relative', import.meta.url)` is rewritten by Vite's asset
 * handling and stops resolving to a real filesystem path under Vitest.
 */
const DEFAULT_FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  FIXTURE_RELATIVE_DIR
);

/**
 * Every file in the corpus, in load order. Used for checksums and for the
 * "loader read exactly these files" assertion.
 */
export const SEASON_2026_FILES = Object.freeze([
  'combined_schedule.csv',
  'coach_roster.csv',
  'coach_roster_v1.csv',
  'external_fixtures_published.csv',
  'facility_geometry.json',
  'facility_permits.csv',
  'game_formats.csv',
  'published_rec_schedule.csv',
  'sunsets.csv',
]);

/**
 * Absolute path to a file in the corpus.
 *
 * @param {string} fileName
 * @param {string} [dir]
 * @returns {string}
 */
export function fixtureFilePath(fileName, dir = DEFAULT_FIXTURE_DIR) {
  return path.join(dir, fileName);
}

/**
 * Read a corpus file as UTF-8 text. Read-only by construction.
 *
 * @param {string} fileName
 * @param {string} [dir]
 * @returns {string}
 */
export function readFixtureFile(fileName, dir = DEFAULT_FIXTURE_DIR) {
  return readFileSync(fixtureFilePath(fileName, dir), 'utf8');
}

/**
 * SHA-256 of every corpus file, so a test can prove a load left the sources
 * byte-identical.
 *
 * @param {string} [dir]
 * @returns {Record<string, string>}
 */
export function computeFixtureChecksums(dir = DEFAULT_FIXTURE_DIR) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const fileName of SEASON_2026_FILES) {
    const bytes = readFileSync(fixtureFilePath(fileName, dir));
    out[fileName] = createHash('sha256').update(bytes).digest('hex');
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Narrow loaders                                                              */
/* -------------------------------------------------------------------------- */

/** @param {string} [dir] */
export function loadGameFormats(dir = DEFAULT_FIXTURE_DIR) {
  return parseGameFormats(readFixtureFile('game_formats.csv', dir));
}

/** @param {string} [dir] */
export function loadFacilityGeometry(dir = DEFAULT_FIXTURE_DIR) {
  return parseFacilityGeometry(readFixtureFile('facility_geometry.json', dir));
}

/**
 * @param {{ seasonYear?: number|string }} [options]
 * @param {string} [dir]
 */
export function loadFacilityPermits(options = {}, dir = DEFAULT_FIXTURE_DIR) {
  return parseFacilityPermits(readFixtureFile('facility_permits.csv', dir), options);
}

/** @param {string} [dir] */
export function loadSunsets(dir = DEFAULT_FIXTURE_DIR) {
  return parseSunsets(readFixtureFile('sunsets.csv', dir));
}

/**
 * Load a coach roster revision.
 *
 * `revision: 'v1'` loads `coach_roster_v1.csv`, the identity-resolution test
 * case from incident 6 ("Nate" vs "Nathaniel").
 *
 * @param {{ revision?: 'current'|'v1' }} [options]
 * @param {string} [dir]
 */
export function loadCoachRoster(options = {}, dir = DEFAULT_FIXTURE_DIR) {
  const fileName = options.revision === 'v1' ? 'coach_roster_v1.csv' : 'coach_roster.csv';
  return parseCoachRoster(readFixtureFile(fileName, dir));
}

/** @param {string} [dir] */
export function loadExternalFixtures(dir = DEFAULT_FIXTURE_DIR) {
  return parseExternalFixtures(readFixtureFile('external_fixtures_published.csv', dir));
}

/**
 * @param {{ formatsByName?: Record<string, Object> }} [options]
 * @param {string} [dir]
 */
export function loadRecSchedule(options = {}, dir = DEFAULT_FIXTURE_DIR) {
  return parseScheduleCsv(readFixtureFile('published_rec_schedule.csv', dir), {
    source: 'published_rec_schedule.csv',
    formatsByName: options.formatsByName ?? indexFormats(loadGameFormats(dir)),
  });
}

/**
 * @param {{ formatsByName?: Record<string, Object> }} [options]
 * @param {string} [dir]
 */
export function loadCombinedSchedule(options = {}, dir = DEFAULT_FIXTURE_DIR) {
  return parseScheduleCsv(readFixtureFile('combined_schedule.csv', dir), {
    source: 'combined_schedule.csv',
    formatsByName: options.formatsByName ?? indexFormats(loadGameFormats(dir)),
  });
}

/* -------------------------------------------------------------------------- */
/* Assembly helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Derive the age-group label from a division code (`U06B` → `U06`).
 * Returns `null` for divisions that carry no age (`BB`, `Select`).
 *
 * @param {string} division
 * @returns {string|null}
 */
export function ageGroupOfDivision(division) {
  const match = String(division ?? '').match(/^U?(\d{1,2})/);
  return match ? `U${match[1].padStart(2, '0')}` : null;
}

/**
 * Build `Team` records from the coach roster, enriching each with the division
 * (and therefore age group) observed in the schedule.
 *
 * TODO(GAP-24): `Team.division` is a single required string, but the corpus
 * disagrees with itself for the Select layer — `16GSelect02` appears as
 * division `U16G` in one row and `16GS` in another, and `16BSelect02` is on the
 * roster but appears in no fixture at all. We record every observed division
 * and leave `division` null when it is ambiguous or unknown rather than picking
 * one arbitrarily.
 *
 * @param {import('./season2026Parsers.js').Season2026CoachAssignment[]} assignments
 * @param {import('./season2026Parsers.js').Season2026Game[]} games
 * @returns {Array<Object>}
 */
export function buildTeams(assignments, games) {
  /** @type {Map<string, { slots: Map<number, string>, keys: Set<string> }>} */
  const byTeam = new Map();
  for (const assignment of assignments) {
    if (!byTeam.has(assignment.teamCode)) {
      byTeam.set(assignment.teamCode, { slots: new Map(), keys: new Set() });
    }
    const entry = /** @type {{ slots: Map<number, string>, keys: Set<string> }} */ (
      byTeam.get(assignment.teamCode)
    );
    entry.slots.set(assignment.coachSlot, assignment.personKey);
    entry.keys.add(assignment.personKey);
  }

  /** @type {Map<string, Set<string>>} */
  const divisionsByTeam = new Map();
  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!teamId) continue;
      if (!divisionsByTeam.has(teamId)) divisionsByTeam.set(teamId, new Set());
      /** @type {Set<string>} */ (divisionsByTeam.get(teamId)).add(game.division);
    }
  }

  return [...byTeam.entries()]
    .map(([teamCode, entry]) => {
      const slots = [...entry.slots.entries()].sort((a, b) => a[0] - b[0]);
      const observedDivisions = [...(divisionsByTeam.get(teamCode) ?? [])].sort();
      const division = observedDivisions.length === 1 ? observedDivisions[0] : null;
      return {
        id: teamCode,
        name: teamCode,
        division,
        age_group: division ? ageGroupOfDivision(division) : null,
        coachId: slots.length > 0 ? slots[0][1] : null,
        coachNeeded: slots.length === 0,
        assistantCoachIds: slots.slice(1).map(([, personKey]) => personKey),
        // Fixture-native extras with no home in the `Team` typedef:
        coachSlots: slots.map(([slot, personKey]) => ({ slot, personKey })),
        coachPersonKeys: [...entry.keys].sort(),
        observedDivisions,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Collapse roster rows into distinct people.
 *
 * TODO(GAP-21/GAP-22): `Person Key` is a name-derived string, not a UUID, and
 * `Profile` requires `id`, `email` and `organization_id`. The corpus has none
 * of those and the project's data-minimisation rule forbids inventing them, so
 * people are emitted with the fixture's own key.
 *
 * @param {import('./season2026Parsers.js').Season2026CoachAssignment[]} assignments
 * @returns {Array<Object>}
 */
export function buildPeople(assignments) {
  /** @type {Map<string, { personKey: string, firstName: string, lastName: string, teamCodes: string[], displayNames: Set<string> }>} */
  const byKey = new Map();
  for (const assignment of assignments) {
    if (!byKey.has(assignment.personKey)) {
      byKey.set(assignment.personKey, {
        personKey: assignment.personKey,
        firstName: assignment.firstName,
        lastName: assignment.lastName,
        teamCodes: [],
        displayNames: new Set(),
      });
    }
    const person = /** @type {{ teamCodes: string[], displayNames: Set<string> }} */ (
      byKey.get(assignment.personKey)
    );
    person.teamCodes.push(assignment.teamCode);
    person.displayNames.add(`${assignment.firstName} ${assignment.lastName}`);
  }
  return [...byKey.values()]
    .map((person) => ({
      ...person,
      teamCodes: [...person.teamCodes].sort(),
      displayNames: [...person.displayNames].sort(),
    }))
    .sort((a, b) => a.personKey.localeCompare(b.personKey));
}

/**
 * Build a per-person commitment timeline from every row that puts a coach on a
 * field — rec games, Select games, external fixtures **and** scrimmages.
 *
 * Incident 5 ("the stranded coach") is exactly the bug of building this from
 * the rec layer only, so the timeline is deliberately assembled from the
 * combined schedule.
 *
 * **A row of unknown footprint is still a commitment.** This function used to
 * skip `durationMinutes === null` rows, which — since the corpus's only
 * unknown-footprint rows are its four `Scrimmage` entries — reproduced incident
 * 5 inside our own loader: every consumer of this timeline, the rule engine
 * included, was blind to exactly the evening commitments the incident is about.
 * They are now carried with `endMinutes: null` (GAP-14 stays representable) and
 * every downstream check says so out loud: `evaluateCoachTravel()` reports
 * `TRAVEL_FOOTPRINT_UNKNOWN` for a transition out of one, and
 * `people/timeline.js` reports `COMMITMENT_FOOTPRINT_UNKNOWN` for the day
 * around it. A commitment of unknown length is a commitment somebody has to be
 * at; dropping it is how an evening disappears from a coach's day.
 *
 * TODO(GAP-19): the domain model has no per-person commitment timeline;
 * `checkCoachConflict()` re-derives conflicts from `team.coachId` on the fly and
 * only ever considers one coach per team. `packages/core/src/people/` (Prompt
 * 3.1) is the domain-side answer; this stays the fixture-side one.
 *
 * @param {import('./season2026Parsers.js').Season2026Game[]} games
 * @param {Array<Object>} teams
 * @returns {Map<string, Array<Object>>}
 */
export function buildCoachTimelines(games, teams) {
  /** @type {Map<string, string[]>} */
  const coachesByTeam = new Map(teams.map((team) => [team.id, team.coachPersonKeys]));
  /** @type {Map<string, Array<Object>>} */
  const timelines = new Map();

  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!teamId) continue;
      for (const personKey of coachesByTeam.get(teamId) ?? []) {
        if (!timelines.has(personKey)) timelines.set(personKey, []);
        /** @type {Array<Object>} */ (timelines.get(personKey)).push({
          personKey,
          teamId,
          gameId: game.id,
          date: game.date,
          startMinutes: game.kickoffMinutes,
          endMinutes: game.endMinutes,
          game,
        });
      }
    }
  }

  for (const entries of timelines.values()) {
    entries.sort((a, b) =>
      a.date === b.date ? a.startMinutes - b.startMinutes : a.date.localeCompare(b.date)
    );
  }
  return timelines;
}

/**
 * Find the rec games where a co-coach was pulled away by an overlapping
 * commitment elsewhere, leaving one coach to cover.
 *
 * A game qualifies when one of its teams has **two or more** rostered coaches
 * and at least one of them is committed to an overlapping game for a different
 * team. Teams with a single rostered coach are not "co-coach covered" and are
 * excluded by design (the corpus has 50 of them).
 *
 * When a coaching *pair* shares two clashing teams, both coaches show up as
 * conflicted and `unconflictedCoaches` is empty — in the real season they split
 * one game each. Deciding who actually covers is a scheduling decision, not
 * something the corpus records, so this function reports the conflict and stops
 * there. TODO(GAP-20): the domain model has no coach-availability record to
 * hold the resolution.
 *
 * @param {import('./season2026Parsers.js').Season2026Game[]} recGames
 * @param {Map<string, Array<Object>>} timelines
 * @param {Array<Object>} teams
 * @returns {Array<{ gameId: string, teamId: string, division: string, ageGroup: string|null, conflictedCoaches: string[], unconflictedCoaches: string[], conflictingGameIds: string[] }>}
 */
export function findSingleCoachGames(recGames, timelines, teams) {
  /** @type {Map<string, string[]>} */
  const coachesByTeam = new Map(teams.map((team) => [team.id, team.coachPersonKeys]));
  /** @type {Array<Object>} */
  const found = [];

  for (const game of recGames) {
    if (game.endMinutes === null) continue;
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!teamId) continue;
      const roster = coachesByTeam.get(teamId) ?? [];
      if (roster.length < 2) continue;

      const conflictedCoaches = [];
      const conflictingGameIds = new Set();
      for (const personKey of roster) {
        const clash = (timelines.get(personKey) ?? []).find(
          (entry) =>
            entry.teamId !== teamId &&
            entry.date === game.date &&
            // Explicit, not incidental: the timeline now carries rows of
            // unknown footprint, and `null > n` happens to be false. An
            // overlap that cannot be measured is not an overlap that did not
            // happen, so it is skipped here and reported by the modules that
            // own that distinction.
            entry.endMinutes !== null &&
            entry.startMinutes < /** @type {number} */ (game.endMinutes) &&
            entry.endMinutes > game.kickoffMinutes
        );
        if (clash) {
          conflictedCoaches.push(personKey);
          conflictingGameIds.add(clash.gameId);
        }
      }
      if (conflictedCoaches.length === 0) continue;
      found.push({
        gameId: game.id,
        teamId,
        division: game.division,
        ageGroup: ageGroupOfDivision(game.division),
        conflictedCoaches,
        unconflictedCoaches: roster.filter((key) => !conflictedCoaches.includes(key)),
        conflictingGameIds: [...conflictingGameIds],
      });
    }
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* The season                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} Season2026
 * @property {string} dir - absolute path the corpus was read from
 * @property {number} seasonYear
 * @property {import('./season2026Parsers.js').Season2026Format[]} formats
 * @property {Record<string, import('./season2026Parsers.js').Season2026Format>} formatsByName
 * @property {import('./season2026Parsers.js').Season2026Venue[]} venues
 * @property {Record<string, import('./season2026Parsers.js').Season2026Venue>} venuesByName
 * @property {import('./season2026Parsers.js').Season2026Field[]} fields
 * @property {Array<Object>} equipmentExceptions
 * @property {import('./season2026Parsers.js').Season2026Permit[]} permits
 * @property {import('./season2026Parsers.js').Season2026Sunset[]} sunsets
 * @property {Array<Object>} teams
 * @property {Array<Object>} people
 * @property {import('./season2026Parsers.js').Season2026CoachAssignment[]} assignments
 * @property {import('./season2026Parsers.js').Season2026Game[]} recGames
 * @property {import('./season2026Parsers.js').Season2026Game[]} combinedGames
 * @property {import('./season2026Parsers.js').Season2026ExternalFixture[]} externalFixtures
 * @property {Record<string, import('./season2026Parsers.js').Season2026Game[]>} combinedByKind
 * @property {string[]} recDates
 * @property {string[]} scheduledDates
 * @property {Map<string, Array<Object>>} coachTimelines
 */

/**
 * Load the whole `season-2026` corpus into one structured object.
 *
 * @param {{ dir?: string }} [options]
 * @returns {Season2026}
 */
export function loadSeason2026(options = {}) {
  const dir = options.dir ?? DEFAULT_FIXTURE_DIR;

  const formats = loadGameFormats(dir);
  const formatsByName = indexFormats(formats);

  const recGames = loadRecSchedule({ formatsByName }, dir);
  const combinedGames = loadCombinedSchedule({ formatsByName }, dir);

  const recDates = [...new Set(recGames.map((game) => game.date))].sort();
  const scheduledDates = [...new Set(combinedGames.map((game) => game.date))].sort();
  const seasonYears = [...new Set(scheduledDates.map((date) => Number(date.slice(0, 4))))];
  if (seasonYears.length !== 1) {
    throw new Error(`season-2026 corpus spans multiple years: ${seasonYears.join(', ')}`);
  }
  const seasonYear = seasonYears[0];

  const geometry = loadFacilityGeometry(dir);
  const permits = loadFacilityPermits({ seasonYear }, dir);
  const sunsets = loadSunsets(dir);
  const assignments = loadCoachRoster({}, dir);
  const externalFixtures = loadExternalFixtures(dir);

  const teams = buildTeams(assignments, combinedGames);
  const people = buildPeople(assignments);
  const coachTimelines = buildCoachTimelines(combinedGames, teams);

  /** @type {Record<string, import('./season2026Parsers.js').Season2026Game[]>} */
  const combinedByKind = {};
  for (const kind of Object.values(SEASON_2026_ROW_KIND)) combinedByKind[kind] = [];
  for (const game of combinedGames) combinedByKind[game.kind].push(game);

  /** @type {Record<string, import('./season2026Parsers.js').Season2026Venue>} */
  const venuesByName = {};
  for (const venue of geometry.venues) venuesByName[venue.name] = venue;

  return {
    dir,
    seasonYear,
    formats,
    formatsByName,
    venues: geometry.venues,
    venuesByName,
    fields: geometry.fields,
    equipmentExceptions: geometry.equipmentExceptions,
    permits,
    sunsets,
    teams,
    people,
    assignments,
    recGames,
    combinedGames,
    externalFixtures,
    combinedByKind,
    recDates,
    scheduledDates,
    coachTimelines,
  };
}

export {
  fieldsOverlap,
  overlapRootField,
  publicationKey,
  resolvePermit,
  resolveSunsetMinutes,
  SEASON_2026_ROW_KIND,
};
