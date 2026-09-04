/**
 * Read-only loader for the `fixtures/season-2026/practice/` corpus.
 *
 * Mirrors `season2026Loader.js`: a **test/dev fixture loader** that is never
 * imported by the frontend bundle, reads with `readFileSync(..., 'utf8')`,
 * writes nothing, and exposes `computePracticeFixtureChecksums()` so a test
 * can prove that. Parsing is the pure string functions in
 * `season2026PracticeParsers.js`; this module does file IO, the join with the
 * game corpus, and the assembly of one deep-frozen result.
 *
 * **Preserve, do not flatten.** Every source row becomes a record. Rows the
 * source could not resolve, and everything the join with `../` turns up, are
 * carried as findings with their raw values attached. `meta` counts what was
 * read, what was parsed and what each cross-corpus check actually examined, so
 * an assertion can prove it looked at something.
 *
 * @module fixtures/season2026PracticeLoader
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { deepFreeze } from '../facility/facilityGraph.js';
import {
  computeFixtureChecksums,
  fixtureFilePath,
  loadSeason2026,
  readFixtureFile,
} from './season2026Loader.js';
import {
  compareDecoderRings,
  makePracticeFinding,
  SEASON_2026_PRACTICE_COLUMNS,
  SEASON_2026_PRACTICE_FINDING,
  SEASON_2026_PRACTICE_PARSERS,
  UNRESOLVED_VENUE_TOKEN,
} from './season2026PracticeParsers.js';

/** Path of the corpus relative to the repository root. */
const FIXTURE_RELATIVE_DIR = path.join('fixtures', 'season-2026', 'practice');

/** Default location, resolved from this module's own path (see the game loader). */
const DEFAULT_FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  FIXTURE_RELATIVE_DIR
);

/**
 * Every file in the corpus, in load order. The Phase 8 plan says "seven
 * files"; the directory and its README hold thirteen, and every one is parsed.
 */
export const SEASON_2026_PRACTICE_FILES = Object.freeze([
  'practice_grid.csv',
  'practice_field_aliases.csv',
  'field_code_names.csv',
  'field_constraints.csv',
  'coach_registration.csv',
  'player_registration.csv',
  'game_change_log.csv',
  'select_coaches.csv',
  'permits.csv',
  'permit_reservations.csv',
  'field_inventory.csv',
  'field_weekly_availability.csv',
  'field_equipment.csv',
]);

/**
 * The game loader's path, read and checksum helpers, pointed at this corpus.
 * One implementation of the read-only guarantee, not two.
 *
 * @param {string} fileName
 * @param {string} [dir]
 * @returns {string}
 */
export function practiceFixtureFilePath(fileName, dir = DEFAULT_FIXTURE_DIR) {
  return fixtureFilePath(fileName, dir);
}

/**
 * @param {string} fileName
 * @param {string} [dir]
 * @returns {string}
 */
export function readPracticeFixtureFile(fileName, dir = DEFAULT_FIXTURE_DIR) {
  return readFixtureFile(fileName, dir);
}

/**
 * @param {string} [dir]
 * @returns {Record<string, string>}
 */
export function computePracticeFixtureChecksums(dir = DEFAULT_FIXTURE_DIR) {
  return computeFixtureChecksums(dir, SEASON_2026_PRACTICE_FILES);
}

/**
 * Parse one corpus file. Every parser takes the same `{ seasonYear }`; the
 * ones that need it (`game_change_log.csv`, `coach_registration.csv`) refuse
 * to run without it, the rest ignore it.
 *
 * @param {string} fileName
 * @param {{ dir?: string, seasonYear?: number }} [options]
 */
export function loadPracticeFile(fileName, options = {}) {
  const parser = SEASON_2026_PRACTICE_PARSERS[fileName];
  if (!parser) throw new Error(`not a practice corpus file: ${fileName}`);
  const text = readPracticeFixtureFile(fileName, options.dir ?? DEFAULT_FIXTURE_DIR);
  return parser(text, { seasonYear: options.seasonYear });
}

/* -------------------------------------------------------------------------- */
/* Cross-file and cross-corpus checks                                          */
/* -------------------------------------------------------------------------- */

/**
 * Findings that need two files of this corpus, or this corpus and the game
 * corpus. Every subject set is enumerated from the side a break would leave
 * intact — teams from the roster, people from the roster — never from the
 * rows being checked.
 *
 * @param {Object} parsed - the per-file parse results, keyed by file name
 * @param {import('./season2026Loader.js').Season2026} season
 * @returns {{ findings: Array<Object>, examined: Record<string, number> }}
 */
export function crossCorpusFindings(parsed, season) {
  const findings = [];
  const examined = {
    rosterTeams: 0,
    rosterTeamsWithGame: 0,
    practiceTeams: 0,
    rosterPeople: 0,
    registrationPersonKeys: 0,
    selectCoachRows: 0,
    coCoachKeys: 0,
    namedPlayerKeys: 0,
    rosterSelectTeams: 0,
    rosterSelectCoaches: 0,
    reservations: 0,
    venueFiles: 0,
    venueNames: 0,
    aliasesWithVenue: 0,
  };
  const push = (finding) => findings.push(makePracticeFinding(finding));

  const grid = parsed['practice_grid.csv'].records;
  const aliases = parsed['practice_field_aliases.csv'].records;
  const constraints = parsed['field_constraints.csv'].records;
  const coachRegistrations = parsed['coach_registration.csv'].records;
  const players = parsed['player_registration.csv'].records;
  const selectCoaches = parsed['select_coaches.csv'].records;
  const reservations = parsed['permit_reservations.csv'].records;

  /* ---- teams: roster is the universe ---- */
  const rosterTeams = new Map(season.teams.map((team) => [team.id, team]));
  const teamsWithGame = new Set();
  for (const game of season.combinedGames) {
    if (game.homeTeamId && rosterTeams.has(game.homeTeamId)) teamsWithGame.add(game.homeTeamId);
    if (game.awayTeamId && rosterTeams.has(game.awayTeamId)) teamsWithGame.add(game.awayTeamId);
  }
  const practiceTeamRows = new Map();
  for (const slot of grid) {
    if (!practiceTeamRows.has(slot.teamCode)) practiceTeamRows.set(slot.teamCode, slot);
  }
  examined.rosterTeams = rosterTeams.size;
  examined.rosterTeamsWithGame = teamsWithGame.size;
  examined.practiceTeams = practiceTeamRows.size;

  for (const [teamCode, slot] of practiceTeamRows) {
    if (!rosterTeams.has(teamCode)) {
      push({
        code: SEASON_2026_PRACTICE_FINDING.PRACTICE_TEAM_NOT_ON_ROSTER,
        file: 'practice_grid.csv',
        rowIndex: slot.rowIndex,
        subject: teamCode,
        detail: 'holds a practice slot but is not on ../coach_roster.csv',
        raw: slot.raw,
      });
    } else if (!teamsWithGame.has(teamCode)) {
      push({
        code: SEASON_2026_PRACTICE_FINDING.PRACTICE_TEAM_PLAYS_NO_GAME,
        file: 'practice_grid.csv',
        rowIndex: slot.rowIndex,
        subject: teamCode,
        detail: 'holds a practice slot and plays no game in ../combined_schedule.csv',
        raw: slot.raw,
      });
    }
  }
  for (const teamCode of [...rosterTeams.keys()].sort()) {
    if (teamsWithGame.has(teamCode) && !practiceTeamRows.has(teamCode)) {
      push({
        code: SEASON_2026_PRACTICE_FINDING.ROSTER_TEAM_HOLDS_NO_PRACTICE,
        file: 'practice_grid.csv',
        rowIndex: null,
        subject: teamCode,
        detail: 'plays a game and holds no practice slot in any parsed sheet',
        raw: null,
      });
    }
  }

  /* ---- people: roster is the universe ---- */
  const rosterPeople = new Set(season.assignments.map((assignment) => assignment.personKey));
  examined.rosterPeople = rosterPeople.size;
  const registrationKeys = new Set();
  for (const registration of coachRegistrations) {
    registrationKeys.add(registration.personKey);
    examined.registrationPersonKeys += 1;
    if (!rosterPeople.has(registration.personKey)) {
      push({
        code: SEASON_2026_PRACTICE_FINDING.PERSON_KEY_MINTED,
        file: 'coach_registration.csv',
        rowIndex: registration.rowIndex,
        subject: registration.personKey,
        detail: 'not on ../coach_roster.csv; a registrant who coaches no rostered team',
        raw: registration.raw,
      });
    }
  }
  for (const row of selectCoaches) {
    examined.selectCoachRows += 1;
    examined.registrationPersonKeys += 1;
    if (!rosterPeople.has(row.personKey)) {
      push({
        code: SEASON_2026_PRACTICE_FINDING.PERSON_KEY_MINTED,
        file: 'select_coaches.csv',
        rowIndex: row.rowIndex,
        subject: row.personKey,
        detail: 'not on ../coach_roster.csv; minted for this corpus',
        raw: row.raw,
      });
    }
    // Slot is a clash-breaker, not a role (PHASE_8_PLAN §8.2): a coach the
    // roster has on the team at another slot is a different finding from a
    // coach the roster does not have on the team at all.
    const team = rosterTeams.get(row.teamCode);
    const onTeam = team ? team.coachSlots.find((entry) => entry.personKey === row.personKey) : null;
    if (!onTeam) {
      push({
        code: SEASON_2026_PRACTICE_FINDING.SELECT_COACH_NOT_ON_ROSTER_TEAM,
        file: 'select_coaches.csv',
        rowIndex: row.rowIndex,
        subject: `${row.teamCode} ${row.personKey}`,
        detail: team
          ? `sheet lists ${row.personKey} at slot ${row.coachSlot}; roster coaches are ${team.coachPersonKeys.join(', ')}`
          : `sheet names ${row.teamCode}, which the roster does not carry`,
        raw: row.raw,
      });
    } else if (onTeam.slot !== row.coachSlot) {
      push({
        code: SEASON_2026_PRACTICE_FINDING.SELECT_COACH_SLOT_DIFFERS,
        file: 'select_coaches.csv',
        rowIndex: row.rowIndex,
        subject: `${row.teamCode} ${row.personKey}`,
        detail: `sheet slot ${row.coachSlot}; roster slot ${onTeam.slot}`,
        raw: row.raw,
      });
    }
  }
  // The other direction, enumerated from the roster: every coach of every
  // rostered Select team must be on the sheet somewhere for that team.
  const sheetPeopleByTeam = new Map();
  for (const row of selectCoaches) {
    if (!sheetPeopleByTeam.has(row.teamCode)) sheetPeopleByTeam.set(row.teamCode, new Set());
    sheetPeopleByTeam.get(row.teamCode).add(row.personKey);
  }
  for (const team of season.teams) {
    if (!/Select/.test(team.id)) continue;
    examined.rosterSelectTeams += 1;
    const listed = sheetPeopleByTeam.get(team.id) ?? new Set();
    for (const entry of team.coachSlots) {
      examined.rosterSelectCoaches += 1;
      if (listed.has(entry.personKey)) continue;
      push({
        code: SEASON_2026_PRACTICE_FINDING.SELECT_COACH_OMITTED_BY_SHEET,
        file: 'select_coaches.csv',
        rowIndex: null,
        subject: `${team.id} ${entry.personKey}`,
        detail: `roster slot ${entry.slot}; select_coaches.csv lists ${listed.size === 0 ? 'nobody for the team' : [...listed].join(', ')}`,
        raw: null,
      });
    }
  }

  /* ---- reservations against the season year ---- */
  for (const row of reservations) {
    examined.reservations += 1;
    if (Number(row.date.slice(0, 4)) === season.seasonYear) continue;
    push({
      code: SEASON_2026_PRACTICE_FINDING.PERMIT_RESERVATION_OUTSIDE_SEASON,
      file: 'permit_reservations.csv',
      rowIndex: row.rowIndex,
      subject: `${row.permitId} ${row.date}`,
      detail: `dated outside the ${season.seasonYear} season the game corpus states`,
      raw: row.raw,
    });
  }

  /* ---- registrations against each other ---- */
  const playerKeys = new Set(players.map((player) => player.playerKey));
  for (const registration of coachRegistrations) {
    for (const player of registration.players) {
      if (player.key === null) continue;
      examined.namedPlayerKeys += 1;
      if (!playerKeys.has(player.key)) {
        push({
          code: SEASON_2026_PRACTICE_FINDING.PLAYER_KEY_NOT_REGISTERED,
          file: 'coach_registration.csv',
          rowIndex: registration.rowIndex,
          subject: player.key,
          detail: `player ${player.slot} of ${registration.personKey} (${player.refClass}) has no player_registration.csv row`,
          raw: registration.raw,
        });
      }
    }
    for (const coCoach of registration.preferredCoCoaches) {
      if (coCoach.key === null) continue;
      examined.coCoachKeys += 1;
      if (rosterPeople.has(coCoach.key) || registrationKeys.has(coCoach.key)) continue;
      // A key that is a registered player's is a different anomaly from a key
      // that is nowhere: the two are reported apart, not folded together.
      const isPlayer = playerKeys.has(coCoach.key);
      push({
        code: isPlayer
          ? SEASON_2026_PRACTICE_FINDING.CO_COACH_KEY_IS_PLAYER
          : SEASON_2026_PRACTICE_FINDING.CO_COACH_KEY_UNKNOWN,
        file: 'coach_registration.csv',
        rowIndex: registration.rowIndex,
        subject: coCoach.key,
        detail: `preferred co-coach ${coCoach.slot} of ${registration.personKey} (${coCoach.refClass}) is ${isPlayer ? 'a player_registration.csv key and' : 'in neither ../coach_roster.csv nor coach_registration.csv and'} no coach`,
        raw: registration.raw,
      });
    }
  }

  /* ---- venues: the game corpus geometry is the universe ---- */
  // Every file whose column contract carries a `venue` is joined — the list is
  // derived from the contracts, not written here, so a file cannot be left out.
  const venueFiles = Object.keys(SEASON_2026_PRACTICE_COLUMNS).filter((file) =>
    SEASON_2026_PRACTICE_COLUMNS[file].includes('venue')
  );
  for (const file of venueFiles) {
    examined.venueFiles += 1;
    const seen = new Set();
    for (const record of parsed[file].records) {
      if (record.venue === null || record.venue === UNRESOLVED_VENUE_TOKEN) continue;
      if (seen.has(record.venue)) continue;
      seen.add(record.venue);
      examined.venueNames += 1;
      if (!season.venuesByName[record.venue]) {
        push({
          code: SEASON_2026_PRACTICE_FINDING.VENUE_NOT_IN_GAME_CORPUS,
          file,
          rowIndex: record.rowIndex,
          subject: record.venue,
          detail: 'no venue of this name in ../facility_geometry.json',
          raw: record.raw,
        });
      }
    }
  }

  /* ---- aliases against constraints ---- */
  const seasonClosures = constraints.filter((constraint) => constraint.seasonLong);
  for (const alias of aliases) {
    if (alias.venue === null) continue;
    examined.aliasesWithVenue += 1;
    const closure = seasonClosures.find((constraint) => constraint.venue === alias.venue);
    if (closure) {
      push({
        code: SEASON_2026_PRACTICE_FINDING.ALIAS_RESOLVES_TO_CLOSED_VENUE,
        file: 'practice_field_aliases.csv',
        rowIndex: alias.rowIndex,
        subject: alias.displayName,
        detail: `resolves to ${alias.venue}, ${closure.reason} ${closure.dateStart} to ${closure.dateEnd}`,
        raw: alias.raw,
      });
    }
  }

  return { findings, examined };
}

/* -------------------------------------------------------------------------- */
/* The corpus                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} Season2026Practice
 * @property {string} dir
 * @property {number} seasonYear
 * @property {Array<Object>} practiceSlots
 * @property {Array<Object>} fieldAliases
 * @property {Array<Object>} fieldCodeNames
 * @property {Array<Object>} fieldConstraints
 * @property {Array<Object>} coachRegistrations
 * @property {Array<Object>} playerRegistrations
 * @property {Array<Object>} gameChanges
 * @property {Array<Object>} selectCoaches
 * @property {Array<Object>} permits
 * @property {Array<Object>} permitReservations
 * @property {Array<Object>} fieldInventory
 * @property {Array<Object>} weeklyAvailability
 * @property {Array<Object>} fieldEquipment
 * @property {{ shared: string[], disagreements: Array<Object> }} decoderRings
 * @property {Array<Object>} findings
 * @property {Record<string, number>} findingsByCode - every code in the table, zero included
 * @property {{ rowsRead: number, rowsParsed: number, files: Record<string, {rowsRead: number, rowsParsed: number}>, examined: Record<string, number> }} meta
 */

/**
 * Load the whole practice corpus into one deep-frozen object.
 *
 * @param {{ dir?: string, season?: import('./season2026Loader.js').Season2026 }} [options]
 * @returns {Season2026Practice}
 */
export function loadSeason2026Practice(options = {}) {
  const dir = options.dir ?? DEFAULT_FIXTURE_DIR;
  // The two corpora are siblings by construction: a caller pointing at another
  // practice directory gets its join computed against the game corpus beside
  // it, never against the repo's — and a `season` handed in from anywhere else
  // is refused rather than joined against.
  const siblingDir = path.resolve(dir, '..');
  if (options.season && path.resolve(options.season.dir) !== siblingDir) {
    throw new Error(
      `practice corpus at ${dir} must be joined against the game corpus beside it (${siblingDir}), not ${options.season.dir}`
    );
  }
  const season = options.season ?? loadSeason2026({ dir: siblingDir });

  /** @type {Record<string, { records: Array<Object>, findings: Array<Object>, rowsRead: number }>} */
  const parsed = {};
  // One producer for the season year: the game corpus. A reservation file
  // from another year is reported against it, never used to redefine it.
  const seasonYear = season.seasonYear;
  for (const fileName of SEASON_2026_PRACTICE_FILES) {
    parsed[fileName] = loadPracticeFile(fileName, { dir, seasonYear });
  }

  const decoderRings = compareDecoderRings(
    parsed['practice_field_aliases.csv'].records,
    parsed['field_code_names.csv'].records
  );
  const cross = crossCorpusFindings(parsed, season);

  const findings = [
    ...SEASON_2026_PRACTICE_FILES.flatMap((fileName) => parsed[fileName].findings),
    ...decoderRings.findings,
    ...cross.findings,
  ];
  /** @type {Record<string, number>} */
  const findingsByCode = {};
  for (const code of Object.values(SEASON_2026_PRACTICE_FINDING)) findingsByCode[code] = 0;
  for (const finding of findings) findingsByCode[finding.code] += 1;

  /** @type {Record<string, {rowsRead: number, rowsParsed: number}>} */
  const files = {};
  let rowsRead = 0;
  let rowsParsed = 0;
  for (const fileName of SEASON_2026_PRACTICE_FILES) {
    const entry = {
      rowsRead: parsed[fileName].rowsRead,
      rowsParsed: parsed[fileName].records.length,
    };
    files[fileName] = entry;
    rowsRead += entry.rowsRead;
    rowsParsed += entry.rowsParsed;
  }

  return deepFreeze({
    dir,
    seasonYear,
    practiceSlots: parsed['practice_grid.csv'].records,
    fieldAliases: parsed['practice_field_aliases.csv'].records,
    fieldCodeNames: parsed['field_code_names.csv'].records,
    fieldConstraints: parsed['field_constraints.csv'].records,
    coachRegistrations: parsed['coach_registration.csv'].records,
    playerRegistrations: parsed['player_registration.csv'].records,
    gameChanges: parsed['game_change_log.csv'].records,
    selectCoaches: parsed['select_coaches.csv'].records,
    permits: parsed['permits.csv'].records,
    permitReservations: parsed['permit_reservations.csv'].records,
    fieldInventory: parsed['field_inventory.csv'].records,
    weeklyAvailability: parsed['field_weekly_availability.csv'].records,
    fieldEquipment: parsed['field_equipment.csv'].records,
    decoderRings: { shared: decoderRings.shared, disagreements: decoderRings.disagreements },
    findings,
    findingsByCode,
    meta: { rowsRead, rowsParsed, files, examined: cross.examined },
  });
}
