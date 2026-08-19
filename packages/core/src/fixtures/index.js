/**
 * Barrel for the regression-fixture loaders.
 *
 * These modules are for tests and development tooling only — they read from
 * `fixtures/` on disk via `node:fs` and must never be imported by frontend
 * code. Nothing here mutates the source files.
 *
 * @module fixtures
 */

export {
  buildCoachTimelines,
  buildPeople,
  buildTeams,
  computeFixtureChecksums,
  ageGroupOfDivision,
  findSingleCoachGames,
  fixtureFilePath,
  loadCoachRoster,
  loadCombinedSchedule,
  loadExternalFixtures,
  loadFacilityGeometry,
  loadFacilityPermits,
  loadGameFormats,
  loadRecSchedule,
  loadSeason2026,
  loadSunsets,
  readFixtureFile,
  SEASON_2026_FILES,
} from './season2026Loader.js';

export {
  classifyScheduleRow,
  fieldsOverlap,
  formatClockMinutes,
  indexFormats,
  isBlankToken,
  makeFieldId,
  overlapRootField,
  parseClockMinutes,
  parseCoachRoster,
  parseCsv,
  parseExternalFixtures,
  parseFacilityGeometry,
  parseFacilityPermits,
  parseFixtureDate,
  parseGameFormats,
  parseMinutesRange,
  parseScheduleCsv,
  parseSunsets,
  publicationKey,
  resolvePermit,
  resolveSunsetMinutes,
  scheduledOccupancyMinutes,
  toNaiveIso,
  weekdayCode,
  PLACEHOLDER_TOKEN,
  REC_FORMATS,
  SEASON_2026_ROW_KIND,
} from './season2026Parsers.js';
