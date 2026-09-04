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
  trim,
  weekdayCode,
  PLACEHOLDER_TOKEN,
  REC_FORMATS,
  SEASON_2026_ROW_KIND,
} from './season2026Parsers.js';

export {
  computePracticeFixtureChecksums,
  crossCorpusFindings,
  loadPracticeFile,
  loadSeason2026Practice,
  practiceFixtureFilePath,
  readPracticeFixtureFile,
  SEASON_2026_PRACTICE_FILES,
  SEASON_LONG_CLOSURE_MIN_FRACTION,
} from './season2026PracticeLoader.js';

export {
  compareDecoderRings,
  expectCsvColumns,
  inclusiveSpanDays,
  makePracticeFinding,
  parseClock24Minutes,
  parseCoachRegistration,
  parseFieldCodeNames,
  parseFieldConstraints,
  parseFieldEquipment,
  parseFieldInventory,
  parseGameChangeLog,
  parseMonthDayDate,
  parsePermitReservations,
  parsePermits,
  parsePlayerRegistration,
  parsePracticeFieldAliases,
  parsePracticeGrid,
  parseSelectCoaches,
  parseWeeklyAvailability,
  selectTeamCode,
  weekdayCodeOfDayName,
  AVAILABILITY_INTERPRETATIONS,
  DECODER_DISAGREEMENT_KIND,
  PracticeFindingSchema,
  REGISTRATION_REF_CLASSES,
  SEASON_2026_PRACTICE_COLUMNS,
  SEASON_2026_PRACTICE_FINDING,
  SEASON_2026_PRACTICE_FINDING_SEVERITY,
  SEASON_2026_PRACTICE_PARSERS,
  SEASON_2026_PRACTICE_SCHEMAS,
  UNRESOLVED_VENUE_TOKEN,
} from './season2026PracticeParsers.js';
