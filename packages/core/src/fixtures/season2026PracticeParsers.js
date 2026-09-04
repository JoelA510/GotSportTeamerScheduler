/**
 * Pure parsers for the `fixtures/season-2026/practice/` corpus.
 *
 * Every function here takes a **string** and returns plain data; nothing
 * touches the filesystem (that is `season2026PracticeLoader.js`). Each parser
 * returns `{ records, findings, rowsRead }` rather than a bare array, because
 * this corpus states its own parse limits — 28 practice rows with no venue, a
 * working sheet whose dates Excel corrupted — and those are **findings to
 * carry**, never rows to drop. `rowsRead` is the number of CSV rows PapaParse
 * handed over and `records.length` is what came out; a loader that ever lets
 * the two differ has dropped something.
 *
 * Every record type is a `.strict()` Zod schema (`SEASON_2026_PRACTICE_SCHEMAS`),
 * matching `availability/schemas.js` and deliberately unlike the blanket
 * `.passthrough()` in `schemas/index.js`. A column the corpus gains or loses is
 * loud at the CSV level too: `expectCsvColumns()` refuses a header set that is
 * not exactly the one this module was written against.
 *
 * Conventions inherited from the game corpus and `BUILD_PLAN_STATUS.md` §4:
 * dates are `YYYY-MM-DD` strings, clock times are minutes past midnight, and
 * **no `Date` is constructed anywhere** — weekdays come from
 * `availability/calendar.js`'s civil-date arithmetic.
 *
 * @module fixtures/season2026PracticeParsers
 */

import Papa from 'papaparse';
import { z } from 'zod';

import { weekdayCodeOf } from '../availability/calendar.js';
import { isoDayNumber } from '../facility/eligibility.js';
import { FACILITY_SEVERITY } from '../facility/reasonCodes.js';
import { formatClockMinutes, parseClockMinutes, parseCsv, trim } from './season2026Parsers.js';

/* -------------------------------------------------------------------------- */
/* Finding codes                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every finding the practice corpus can raise, at parse time or on the join
 * with the game corpus. Frozen: a code that is not in this table cannot be
 * emitted, and a test that asks for one that is not here is asking the wrong
 * question.
 *
 * @readonly
 * @enum {string}
 */
export const SEASON_2026_PRACTICE_FINDING = Object.freeze({
  /** `practice_grid.csv` row whose venue is `(unresolved)` — kept, not dropped. */
  PRACTICE_VENUE_UNRESOLVED: 'PRACTICE_VENUE_UNRESOLVED',
  /** `field_weekly_availability.csv` row whose raw value Excel turned into a date. */
  AVAILABILITY_EXCEL_DATE_CORRUPTION: 'AVAILABILITY_EXCEL_DATE_CORRUPTION',
  /** `field_weekly_availability.csv` row the source could not interpret at all. */
  AVAILABILITY_UNPARSED: 'AVAILABILITY_UNPARSED',
  /** `field_constraints.csv` `fields` cell that is an ISO date — `1-7` corrupted the same way. */
  CONSTRAINT_FIELDS_EXCEL_DATE_CORRUPTION: 'CONSTRAINT_FIELDS_EXCEL_DATE_CORRUPTION',
  /** A code the two decoder rings both carry and map to different labels. */
  DECODER_RINGS_DISAGREE: 'DECODER_RINGS_DISAGREE',
  /** A `field_code_names.csv` row the source itself marked `?`. */
  DECODER_RING_UNCERTAIN: 'DECODER_RING_UNCERTAIN',
  /** A `practice_field_aliases.csv` row with no actual label at all. */
  DECODER_RING_ALIAS_BLANK: 'DECODER_RING_ALIAS_BLANK',
  /** A `practice_field_aliases.csv` row with a label but no venue: the joins cannot see it. */
  DECODER_RING_ALIAS_VENUE_BLANK: 'DECODER_RING_ALIAS_VENUE_BLANK',
  /** The same code listed twice in one decoder ring; a lookup would keep only one. */
  DUPLICATE_DECODER_CODE: 'DUPLICATE_DECODER_CODE',
  /** `game_change_log.csv` row whose `(Sun)`-style note disagrees with the date it was given. */
  CHANGE_LOG_DAY_MISMATCH: 'CHANGE_LOG_DAY_MISMATCH',
  /** `permit_reservations.csv` row whose `day` disagrees with its `date`. */
  PERMIT_DAY_MISMATCH: 'PERMIT_DAY_MISMATCH',
  /** The same `person_key` registered twice in `coach_registration.csv`. */
  DUPLICATE_PERSON_KEY: 'DUPLICATE_PERSON_KEY',
  /** The same `player_key` registered twice in `player_registration.csv`. */
  DUPLICATE_PLAYER_KEY: 'DUPLICATE_PLAYER_KEY',
  /** The same venue inventoried twice in `field_inventory.csv`. */
  DUPLICATE_INVENTORY_VENUE: 'DUPLICATE_INVENTORY_VENUE',
  /** A registration birth year that cannot be a player's (the season year or later). */
  BIRTH_YEAR_IMPLAUSIBLE: 'BIRTH_YEAR_IMPLAUSIBLE',
  /** A registration's named player key has no `player_registration.csv` row. */
  PLAYER_KEY_NOT_REGISTERED: 'PLAYER_KEY_NOT_REGISTERED',
  /** A preferred co-coach key that is in neither the coach roster nor the registrations. */
  CO_COACH_KEY_UNKNOWN: 'CO_COACH_KEY_UNKNOWN',
  /** A preferred co-coach key that resolves to a registered player and to no coach. */
  CO_COACH_KEY_IS_PLAYER: 'CO_COACH_KEY_IS_PLAYER',
  /* ---- cross-corpus (need `../` game corpus) ---- */
  /** A `practice_grid.csv` team code that is not on `../coach_roster.csv`. */
  PRACTICE_TEAM_NOT_ON_ROSTER: 'PRACTICE_TEAM_NOT_ON_ROSTER',
  /** A rostered practice team that plays no game in `../combined_schedule.csv`. */
  PRACTICE_TEAM_PLAYS_NO_GAME: 'PRACTICE_TEAM_PLAYS_NO_GAME',
  /** A rostered team that plays a game and holds no practice slot in any parsed sheet. */
  ROSTER_TEAM_HOLDS_NO_PRACTICE: 'ROSTER_TEAM_HOLDS_NO_PRACTICE',
  /** A `person_key` in a registration file that `../coach_roster.csv` does not carry: minted. */
  PERSON_KEY_MINTED: 'PERSON_KEY_MINTED',
  /** A `select_coaches.csv` row naming a person `../coach_roster.csv` does not have on that team. */
  SELECT_COACH_NOT_ON_ROSTER_TEAM: 'SELECT_COACH_NOT_ON_ROSTER_TEAM',
  /** A `select_coaches.csv` row naming a rostered coach of that team at a different slot. */
  SELECT_COACH_SLOT_DIFFERS: 'SELECT_COACH_SLOT_DIFFERS',
  /** A rostered coach of a Select team whom `select_coaches.csv` does not list. */
  SELECT_COACH_OMITTED_BY_SHEET: 'SELECT_COACH_OMITTED_BY_SHEET',
  /** A `permit_reservations.csv` window dated outside the game corpus's season year. */
  PERMIT_RESERVATION_OUTSIDE_SEASON: 'PERMIT_RESERVATION_OUTSIDE_SEASON',
  /** A venue named in this corpus that `../facility_geometry.json` does not know by that name. */
  VENUE_NOT_IN_GAME_CORPUS: 'VENUE_NOT_IN_GAME_CORPUS',
  /** A practice alias whose real venue `field_constraints.csv` closes for the season. */
  ALIAS_RESOLVES_TO_CLOSED_VENUE: 'ALIAS_RESOLVES_TO_CLOSED_VENUE',
});

/**
 * How much each finding counts against the corpus, in the vocabulary every
 * other finding table in this package uses. `blocking` is a contradiction the
 * data cannot both halves of; `compromise` is an interpretation a later reader
 * may need to overrule; `info` is a documented property of the corpus that a
 * consumer should know about and need not act on.
 *
 * @readonly
 */
export const SEASON_2026_PRACTICE_FINDING_SEVERITY = Object.freeze({
  [SEASON_2026_PRACTICE_FINDING.PRACTICE_VENUE_UNRESOLVED]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.AVAILABILITY_EXCEL_DATE_CORRUPTION]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.AVAILABILITY_UNPARSED]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.CONSTRAINT_FIELDS_EXCEL_DATE_CORRUPTION]:
    FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.DECODER_RINGS_DISAGREE]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.DECODER_RING_UNCERTAIN]: FACILITY_SEVERITY.INFO,
  [SEASON_2026_PRACTICE_FINDING.DECODER_RING_ALIAS_BLANK]: FACILITY_SEVERITY.INFO,
  [SEASON_2026_PRACTICE_FINDING.DECODER_RING_ALIAS_VENUE_BLANK]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.DUPLICATE_DECODER_CODE]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.CHANGE_LOG_DAY_MISMATCH]: FACILITY_SEVERITY.BLOCKING,
  [SEASON_2026_PRACTICE_FINDING.PERMIT_DAY_MISMATCH]: FACILITY_SEVERITY.BLOCKING,
  [SEASON_2026_PRACTICE_FINDING.DUPLICATE_PERSON_KEY]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.DUPLICATE_PLAYER_KEY]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.DUPLICATE_INVENTORY_VENUE]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.BIRTH_YEAR_IMPLAUSIBLE]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.PLAYER_KEY_NOT_REGISTERED]: FACILITY_SEVERITY.INFO,
  [SEASON_2026_PRACTICE_FINDING.CO_COACH_KEY_UNKNOWN]: FACILITY_SEVERITY.INFO,
  [SEASON_2026_PRACTICE_FINDING.CO_COACH_KEY_IS_PLAYER]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.PRACTICE_TEAM_NOT_ON_ROSTER]: FACILITY_SEVERITY.BLOCKING,
  [SEASON_2026_PRACTICE_FINDING.PRACTICE_TEAM_PLAYS_NO_GAME]: FACILITY_SEVERITY.INFO,
  [SEASON_2026_PRACTICE_FINDING.ROSTER_TEAM_HOLDS_NO_PRACTICE]: FACILITY_SEVERITY.INFO,
  [SEASON_2026_PRACTICE_FINDING.PERSON_KEY_MINTED]: FACILITY_SEVERITY.INFO,
  [SEASON_2026_PRACTICE_FINDING.SELECT_COACH_NOT_ON_ROSTER_TEAM]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.SELECT_COACH_SLOT_DIFFERS]: FACILITY_SEVERITY.INFO,
  [SEASON_2026_PRACTICE_FINDING.SELECT_COACH_OMITTED_BY_SHEET]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.PERMIT_RESERVATION_OUTSIDE_SEASON]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.VENUE_NOT_IN_GAME_CORPUS]: FACILITY_SEVERITY.COMPROMISE,
  [SEASON_2026_PRACTICE_FINDING.ALIAS_RESOLVES_TO_CLOSED_VENUE]: FACILITY_SEVERITY.COMPROMISE,
});

/* -------------------------------------------------------------------------- */
/* Primitive schemas                                                           */
/* -------------------------------------------------------------------------- */

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });
const MinutesSchema = z.number().int().min(0);
const ClockSchema = z.string().regex(/^\d{2}:\d{2}$/);
const WeekdaySchema = z.enum(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
const NonEmpty = z.string().min(1);
const RawRowSchema = z.record(z.string(), z.string());
const FindingCodeSchema = z.enum(
  /** @type {[string, ...string[]]} */ (Object.values(SEASON_2026_PRACTICE_FINDING))
);
const SeveritySchema = z.enum(
  /** @type {[string, ...string[]]} */ (Object.values(FACILITY_SEVERITY))
);

/** The class labels the anonymiser wrote in place of the registration prose. */
export const REGISTRATION_REF_CLASSES = Object.freeze([
  'named',
  'named-in-prose',
  'narrative',
  'unresolved',
  'declined',
  'none',
]);
const RefClassSchema = z.enum(/** @type {[string, ...string[]]} */ ([...REGISTRATION_REF_CLASSES]));

/** The interpretation labels `field_weekly_availability.csv` carries, `null` for a plain window. */
export const AVAILABILITY_INTERPRETATIONS = Object.freeze([
  'excel-date-corruption',
  'unavailable',
  'competitive-programme',
  'unparsed',
]);
const InterpretationSchema = z
  .enum(/** @type {[string, ...string[]]} */ ([...AVAILABILITY_INTERPRETATIONS]))
  .nullable();

/**
 * A finding. `raw` keeps whatever the source said so a later reader can
 * overrule the interpretation — that is the whole point of carrying one.
 */
export const PracticeFindingSchema = z
  .object({
    code: FindingCodeSchema,
    severity: SeveritySchema,
    file: NonEmpty,
    rowIndex: z.number().int().min(0).nullable(),
    subject: NonEmpty,
    detail: NonEmpty,
    raw: z.union([RawRowSchema, z.string(), z.null()]),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Record schemas                                                              */
/* -------------------------------------------------------------------------- */

const PracticeSlotSchema = z
  .object({
    id: NonEmpty,
    rowIndex: z.number().int().min(0),
    sourceSheet: NonEmpty,
    venue: NonEmpty,
    venueResolved: z.boolean(),
    field: NonEmpty,
    subunit: NonEmpty.nullable(),
    day: NonEmpty,
    weekday: WeekdaySchema,
    startMinutes: MinutesSchema,
    start: ClockSchema,
    durationMinutes: z.number().int().positive(),
    endMinutes: MinutesSchema,
    end: ClockSchema,
    teamCode: NonEmpty,
    raw: RawRowSchema,
  })
  .strict();

const PracticeFieldAliasSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    displayName: NonEmpty,
    actualLabel: NonEmpty.nullable(),
    venue: NonEmpty.nullable(),
    field: NonEmpty.nullable(),
    subunit: NonEmpty.nullable(),
    raw: RawRowSchema,
  })
  .strict();

const FieldCodeNameSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    codeName: NonEmpty,
    actualLabel: NonEmpty,
    venue: NonEmpty,
    remainder: NonEmpty.nullable(),
    uncertain: z.boolean(),
    confirmed: NonEmpty.nullable(),
    usedFor: NonEmpty.nullable(),
    raw: RawRowSchema,
  })
  .strict();

const FieldConstraintSchema = z
  .object({
    id: NonEmpty,
    rowIndex: z.number().int().min(0),
    dateStart: IsoDateSchema,
    dateEnd: IsoDateSchema,
    startMinutes: MinutesSchema,
    endMinutes: MinutesSchema,
    venue: NonEmpty,
    /** The `fields` cell as written — `4`, `All`, `Parking`, `Adjacent Fields`, or a corrupted date. */
    fields: NonEmpty,
    allFields: z.boolean(),
    spanDays: z.number().int().min(1),
    /** An all-fields closure spanning `SEASON_LONG_CLOSURE_MIN_DAYS` or more. */
    seasonLong: z.boolean(),
    reason: NonEmpty,
    sourceKind: NonEmpty.nullable(),
    raw: RawRowSchema,
  })
  .strict();

const RegisteredPlayerRefSchema = z
  .object({
    slot: z.union([z.literal(1), z.literal(2)]),
    key: NonEmpty.nullable(),
    refClass: RefClassSchema,
    gender: z.enum(['male', 'female']).nullable(),
    birthYear: z.number().int().nullable(),
    playingUp: z.boolean(),
  })
  .strict();

const CoCoachRefSchema = z
  .object({
    slot: z.union([z.literal(1), z.literal(2)]),
    key: NonEmpty.nullable(),
    refClass: RefClassSchema,
  })
  .strict();

const CoachRegistrationSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    coachName: NonEmpty,
    personKey: NonEmpty,
    players: z.array(RegisteredPlayerRefSchema).length(2),
    preferredCoCoaches: z.array(CoCoachRefSchema).length(2),
    raw: RawRowSchema,
  })
  .strict();

const PlayerRegistrationSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    playerName: NonEmpty,
    playerKey: NonEmpty,
    gender: z.enum(['m', 'f']),
    birthYear: z.number().int(),
    ageGroup: z.number().int().positive(),
    ageGroupCode: NonEmpty.nullable(),
    program: NonEmpty.nullable(),
    playingUp: z.boolean(),
    raw: RawRowSchema,
  })
  .strict();

const ChangeSideSchema = z
  .object({
    raw: NonEmpty,
    /** `true` for `(not previously scheduled)`. */
    unscheduled: z.boolean(),
    minutes: MinutesSchema.nullable(),
    location: NonEmpty.nullable(),
  })
  .strict();

const GameChangeSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    /** The cell as written, e.g. `Nov 08 (Sun)`. */
    dateLabel: NonEmpty,
    date: IsoDateSchema,
    dateNote: NonEmpty.nullable(),
    matchup: NonEmpty,
    homeLabel: NonEmpty,
    awayLabel: NonEmpty,
    was: ChangeSideSchema,
    now: ChangeSideSchema,
    reason: NonEmpty,
    raw: RawRowSchema,
  })
  .strict();

const SelectCoachSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    division: NonEmpty,
    teamNumber: z.number().int().positive(),
    /** `U14B` + `1` → `14BSelect01`, the roster's own spelling. */
    teamCode: NonEmpty,
    coachSlot: z.number().int().positive(),
    coachName: NonEmpty,
    personKey: NonEmpty,
    raw: RawRowSchema,
  })
  .strict();

const PermitSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    permitId: NonEmpty,
    venue: NonEmpty,
    event: NonEmpty,
    issued: IsoDateSchema,
    maxDailyAttendance: z.number().int().positive(),
    sourcePages: z.number().int().positive(),
    raw: RawRowSchema,
  })
  .strict();

const PermitReservationSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    permitId: NonEmpty,
    venue: NonEmpty,
    date: IsoDateSchema,
    day: NonEmpty,
    weekday: WeekdaySchema,
    startMinutes: MinutesSchema,
    endMinutes: MinutesSchema,
    facility: NonEmpty,
    services: NonEmpty.nullable(),
    raw: RawRowSchema,
  })
  .strict();

const FieldInventorySchema = z
  .object({
    rowIndex: z.number().int().min(0),
    venue: NonEmpty,
    fieldSizes: NonEmpty,
    ageGroups: NonEmpty.nullable(),
    practiceMaxTeams: NonEmpty.nullable(),
    bathroom: NonEmpty.nullable(),
    notes: NonEmpty.nullable(),
    raw: RawRowSchema,
  })
  .strict();

const WeeklyAvailabilitySchema = z
  .object({
    rowIndex: z.number().int().min(0),
    venue: NonEmpty,
    day: NonEmpty,
    weekday: WeekdaySchema,
    rawValue: NonEmpty,
    startMinutes: MinutesSchema.nullable(),
    endMinutes: MinutesSchema.nullable(),
    interpretation: InterpretationSchema,
    raw: RawRowSchema,
  })
  .strict();

const FieldEquipmentSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    venue: NonEmpty,
    item: NonEmpty,
    value: NonEmpty,
    quantity: z.number().nullable(),
    raw: RawRowSchema,
  })
  .strict();

/**
 * One strict schema per corpus file, keyed by file name.
 *
 * @readonly
 */
export const SEASON_2026_PRACTICE_SCHEMAS = Object.freeze({
  'practice_grid.csv': PracticeSlotSchema,
  'practice_field_aliases.csv': PracticeFieldAliasSchema,
  'field_code_names.csv': FieldCodeNameSchema,
  'field_constraints.csv': FieldConstraintSchema,
  'coach_registration.csv': CoachRegistrationSchema,
  'player_registration.csv': PlayerRegistrationSchema,
  'game_change_log.csv': GameChangeSchema,
  'select_coaches.csv': SelectCoachSchema,
  'permits.csv': PermitSchema,
  'permit_reservations.csv': PermitReservationSchema,
  'field_inventory.csv': FieldInventorySchema,
  'field_weekly_availability.csv': WeeklyAvailabilitySchema,
  'field_equipment.csv': FieldEquipmentSchema,
});

/**
 * The exact header each file was written against. A drift here fails the
 * parse loudly rather than leaving a new column parsed and unread.
 *
 * @readonly
 */
export const SEASON_2026_PRACTICE_COLUMNS = Object.freeze({
  'practice_grid.csv': Object.freeze([
    'source_sheet',
    'venue',
    'field',
    'subunit',
    'day',
    'start',
    'duration_minutes',
    'team_code',
  ]),
  'practice_field_aliases.csv': Object.freeze([
    'display_name',
    'actual_label',
    'venue',
    'field',
    'subunit',
  ]),
  'field_code_names.csv': Object.freeze([
    'code_name',
    'actual_label',
    'venue',
    'remainder',
    'uncertain',
    'confirmed',
    'used_for',
  ]),
  'field_constraints.csv': Object.freeze([
    'date_start',
    'date_end',
    'time_start',
    'time_end',
    'venue',
    'fields',
    'reason',
    'source_kind',
  ]),
  'coach_registration.csv': Object.freeze([
    'coach_name',
    'person_key',
    'player_1_key',
    'player_1_ref_class',
    'player_1_gender',
    'player_1_birth_year',
    'player_1_playing_up',
    'preferred_co_coach_1_key',
    'preferred_co_coach_1_class',
    'player_2_key',
    'player_2_ref_class',
    'player_2_gender',
    'player_2_birth_year',
    'player_2_playing_up',
    'preferred_co_coach_2_key',
    'preferred_co_coach_2_class',
  ]),
  'player_registration.csv': Object.freeze([
    'player_name',
    'player_key',
    'gender',
    'birth_year',
    'age_group',
    'age_group_code',
    'program',
    'playing_up',
  ]),
  'game_change_log.csv': Object.freeze(['date', 'matchup', 'was', 'now', 'reason']),
  'select_coaches.csv': Object.freeze([
    'division',
    'team_number',
    'coach_slot',
    'coach_name',
    'person_key',
  ]),
  'permits.csv': Object.freeze([
    'permit_id',
    'venue',
    'event',
    'issued',
    'max_daily_attendance',
    'source_pages',
  ]),
  'permit_reservations.csv': Object.freeze([
    'permit_id',
    'venue',
    'date',
    'day',
    'start',
    'end',
    'facility',
    'services',
  ]),
  'field_inventory.csv': Object.freeze([
    'venue',
    'field_sizes',
    'age_groups',
    'practice_max_teams',
    'bathroom',
    'notes',
  ]),
  'field_weekly_availability.csv': Object.freeze([
    'venue',
    'day',
    'raw_value',
    'interpreted_window',
    'interpretation',
  ]),
  'field_equipment.csv': Object.freeze(['venue', 'item', 'value']),
});

/** The venue label the grid carries where the section heading was not machine readable. */
export const UNRESOLVED_VENUE_TOKEN = '(unresolved)';

/**
 * An all-fields constraint spanning at least this many days is "closed for
 * effectively the whole season" in the README's words. The corpus's three such
 * rows span 92 and 120 days inclusive; its longest single-event blackout spans one.
 */
export const SEASON_LONG_CLOSURE_MIN_DAYS = 60;

/* -------------------------------------------------------------------------- */
/* Primitive parsers                                                           */
/* -------------------------------------------------------------------------- */

const orNull = (value) => (trim(value) === '' ? null : trim(value));

/** A Map, not an object: `'constructor'` must not resolve to anything. */
const DAY_NAME_TO_CODE = new Map([
  ['Sunday', 'SUN'],
  ['Monday', 'MON'],
  ['Tuesday', 'TUE'],
  ['Wednesday', 'WED'],
  ['Thursday', 'THU'],
  ['Friday', 'FRI'],
  ['Saturday', 'SAT'],
  ['Sun', 'SUN'],
  ['Mon', 'MON'],
  ['Tue', 'TUE'],
  ['Wed', 'WED'],
  ['Thu', 'THU'],
  ['Fri', 'FRI'],
  ['Sat', 'SAT'],
]);

const MONTH_ABBREVIATIONS = Object.freeze({
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Days in a month, Gregorian. `Feb 30` is not a date a regex will refuse.
 *
 * @param {number} year
 * @param {number} month - 1..12
 * @returns {number}
 */
function daysInMonth(year, month) {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Refuse a calendar date that does not exist.
 *
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {string} label
 */
function assertCalendarDate(year, month, day, label) {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`${label}: ${year}-${month}-${day} is not a calendar date`);
  }
}

/**
 * Parse a 24-hour `HH:MM` clock into minutes past midnight. The practice
 * corpus writes every time this way; the game corpus's `parseClockMinutes()`
 * is 12-hour with AM/PM and is used where the change log speaks that dialect.
 *
 * @param {string} value - e.g. `16:45`
 * @returns {number}
 */
export function parseClock24Minutes(value) {
  const text = trim(value);
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new TypeError(`unparseable 24h clock time: ${JSON.stringify(value)}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new RangeError(`out-of-range 24h clock time: ${JSON.stringify(value)}`);
  }
  return hour * 60 + minute;
}

/**
 * Weekday code for a day name in either spelling the corpus uses
 * (`Monday` / `Mon`).
 *
 * @param {string} value
 * @returns {string}
 */
export function weekdayCodeOfDayName(value) {
  const code = DAY_NAME_TO_CODE.get(trim(value));
  if (code === undefined) throw new TypeError(`unparseable day name: ${JSON.stringify(value)}`);
  return code;
}

/**
 * Parse the change log's `Mon DD` (optionally `Mon DD (Sun)`) date into an ISO
 * date in the given season year. The year is not in the file; the caller
 * derives it from the corpus (`permit_reservations.csv` spans one year).
 *
 * @param {string} value - e.g. `Nov 08 (Sun)`
 * @param {number} seasonYear
 * @returns {{ date: string, note: string|null }}
 */
export function parseMonthDayDate(value, seasonYear) {
  const text = trim(value);
  const match = text.match(/^([A-Z][a-z]{2}) (\d{1,2})(?: \(([^)]+)\))?$/);
  if (!match) throw new TypeError(`unparseable month-day date: ${JSON.stringify(value)}`);
  const month = MONTH_ABBREVIATIONS[match[1]];
  if (!month) throw new TypeError(`unknown month in ${JSON.stringify(value)}`);
  if (!Number.isInteger(seasonYear)) throw new TypeError('seasonYear must be an integer');
  const day = Number(match[2]);
  assertCalendarDate(seasonYear, month, day, `month-day date ${JSON.stringify(value)}`);
  return {
    date: `${seasonYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    note: match[3] ?? null,
  };
}

/**
 * Validate an ISO calendar date string without constructing a `Date`.
 *
 * @param {string} value
 * @param {string} label
 * @returns {string}
 */
function requireIsoDate(value, label) {
  const text = trim(value);
  if (!ISO_DATE_RE.test(text))
    throw new TypeError(`${label}: not an ISO date ${JSON.stringify(value)}`);
  assertCalendarDate(
    Number(text.slice(0, 4)),
    Number(text.slice(5, 7)),
    Number(text.slice(8, 10)),
    label
  );
  return text;
}

/**
 * Inclusive day count of a date range.
 *
 * @param {string} dateStart
 * @param {string} dateEnd
 * @returns {number}
 */
export function inclusiveSpanDays(dateStart, dateEnd) {
  return isoDayNumber(dateEnd) - isoDayNumber(dateStart) + 1;
}

/**
 * Parse `yes` / blank flags. Anything else is a new vocabulary and is loud.
 *
 * @param {string} value
 * @param {string} label
 * @returns {boolean}
 */
function parseYesFlag(value, label) {
  const text = trim(value);
  if (text === '') return false;
  if (text === 'yes') return true;
  throw new TypeError(`${label}: unexpected flag ${JSON.stringify(value)}`);
}

/**
 * Parse an integer cell; blank is `null`.
 *
 * @param {string} value
 * @param {string} label
 * @returns {number|null}
 */
function parseIntOrNull(value, label) {
  const text = trim(value);
  if (text === '') return null;
  if (!/^-?\d+$/.test(text))
    throw new TypeError(`${label}: not an integer ${JSON.stringify(value)}`);
  return Number(text);
}

/**
 * Parse an integer cell that must be present.
 *
 * @param {string} value
 * @param {string} label
 * @returns {number}
 */
function parseIntCell(value, label) {
  const parsed = parseIntOrNull(value, label);
  if (parsed === null) throw new TypeError(`${label}: missing integer`);
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* CSV plumbing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Parse a CSV and refuse any header set other than the one expected. The
 * header line is checked on its own — PapaParse keys a short row only by the
 * cells it has, so a column added to the header alone would otherwise slip
 * past a per-row check — and then every row must carry exactly those keys, so
 * a short or long row (PapaParse's `FieldMismatch`) is loud too.
 *
 * @param {string} text
 * @param {string} fileName - a key of `SEASON_2026_PRACTICE_COLUMNS`
 * @returns {Array<Record<string, string>>}
 */
export function expectCsvColumns(text, fileName) {
  const expected = SEASON_2026_PRACTICE_COLUMNS[fileName];
  if (!expected) throw new Error(`no column contract for ${fileName}`);
  const header = Papa.parse(String(text), { header: true, preview: 1 }).meta.fields ?? [];
  const sameHeader =
    header.length === expected.length && header.every((key, i) => key === expected[i]);
  if (!sameHeader) {
    throw new Error(`${fileName}: header [${header.join(', ')}] is not [${expected.join(', ')}]`);
  }
  const rows = parseCsv(text, fileName);
  if (rows.length === 0) throw new Error(`${fileName}: no rows read`);
  rows.forEach((row, rowIndex) => {
    const keys = Object.keys(row);
    const same = keys.length === expected.length && keys.every((key, i) => key === expected[i]);
    if (!same) {
      throw new Error(
        `${fileName} row ${rowIndex}: columns [${keys.join(', ')}] are not [${expected.join(', ')}]`
      );
    }
  });
  return rows;
}

/**
 * Build a finding. The severity is looked up, never passed, so a code the
 * table does not grade cannot be emitted; validated on construction so a
 * malformed finding cannot exist.
 *
 * @param {{ code: string, file: string, rowIndex: number|null, subject: string, detail: string, raw: Object|string|null }} finding
 * @returns {Object}
 */
export function makePracticeFinding(finding) {
  const severity = SEASON_2026_PRACTICE_FINDING_SEVERITY[finding.code];
  if (!severity) throw new Error(`no severity graded for practice finding ${finding.code}`);
  return PracticeFindingSchema.parse({ ...finding, severity });
}

/**
 * Validate every record against the file's strict schema, in order, and
 * return the parse result shape every parser shares.
 *
 * @param {string} fileName
 * @param {Array<Object>} records
 * @param {Array<Object>} findings
 * @param {number} rowsRead
 */
function finish(fileName, records, findings, rowsRead) {
  const schema = SEASON_2026_PRACTICE_SCHEMAS[fileName];
  return {
    records: records.map((record) => schema.parse(record)),
    findings,
    rowsRead,
  };
}

/* -------------------------------------------------------------------------- */
/* practice_grid.csv                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Parse `practice_grid.csv`. Every row produces one record; the 28 rows whose
 * venue the source could not supply are records **and** findings.
 *
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parsePracticeGrid(text, _options = {}) {
  const fileName = 'practice_grid.csv';
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const records = rows.map((row, rowIndex) => {
    const venue = trim(row.venue);
    const venueResolved = venue !== UNRESOLVED_VENUE_TOKEN;
    if (!venueResolved) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.PRACTICE_VENUE_UNRESOLVED,
          file: fileName,
          rowIndex,
          subject: `${trim(row.source_sheet)} / ${trim(row.field)}`,
          detail: `source label names a field with no venue; heading not machine readable`,
          raw: row,
        })
      );
    }
    const startMinutes = parseClock24Minutes(row.start);
    const durationMinutes = parseIntCell(
      row.duration_minutes,
      `${fileName} row ${rowIndex} duration`
    );
    const endMinutes = startMinutes + durationMinutes;
    return {
      id: `${fileName}#${rowIndex}`,
      rowIndex,
      sourceSheet: trim(row.source_sheet),
      venue,
      venueResolved,
      field: trim(row.field),
      subunit: orNull(row.subunit),
      day: trim(row.day),
      weekday: weekdayCodeOfDayName(row.day),
      startMinutes,
      start: /** @type {string} */ (formatClockMinutes(startMinutes)),
      durationMinutes,
      endMinutes,
      end: /** @type {string} */ (formatClockMinutes(endMinutes)),
      teamCode: trim(row.team_code),
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/* -------------------------------------------------------------------------- */
/* The two decoder rings                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record a code seen twice in one decoder ring. `compareDecoderRings()` indexes
 * a ring by code, so a duplicate would otherwise be resolved by whichever row
 * came last — which is exactly the silent reconciliation the plan warns of.
 *
 * @param {Map<string, number>} seen
 * @param {string} code
 * @param {number} rowIndex
 * @param {string} fileName
 * @param {Record<string, string>} row
 * @param {Array<Object>} findings
 */
function noteDuplicateCode(seen, code, rowIndex, fileName, row, findings) {
  if (seen.has(code)) {
    findings.push(
      makePracticeFinding({
        code: SEASON_2026_PRACTICE_FINDING.DUPLICATE_DECODER_CODE,
        file: fileName,
        rowIndex,
        subject: code,
        detail: `also listed at row ${seen.get(code)}; a lookup by code would keep only one`,
        raw: row,
      })
    );
  } else {
    seen.set(code, rowIndex);
  }
}

/**
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parsePracticeFieldAliases(text, _options = {}) {
  const fileName = 'practice_field_aliases.csv';
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const seen = new Map();
  const records = rows.map((row, rowIndex) => {
    noteDuplicateCode(seen, trim(row.display_name), rowIndex, fileName, row, findings);
    const actualLabel = orNull(row.actual_label);
    if (actualLabel === null) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.DECODER_RING_ALIAS_BLANK,
          file: fileName,
          rowIndex,
          subject: trim(row.display_name),
          detail: 'the practice workbook lists the code with no field behind it',
          raw: row,
        })
      );
    }
    const venue = orNull(row.venue);
    if (actualLabel !== null && venue === null) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.DECODER_RING_ALIAS_VENUE_BLANK,
          file: fileName,
          rowIndex,
          subject: trim(row.display_name),
          detail: `resolves to ${JSON.stringify(actualLabel)} but names no venue, so no venue join can see it`,
          raw: row,
        })
      );
    }
    return {
      rowIndex,
      displayName: trim(row.display_name),
      actualLabel,
      venue,
      field: orNull(row.field),
      subunit: orNull(row.subunit),
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/**
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parseFieldCodeNames(text, _options = {}) {
  const fileName = 'field_code_names.csv';
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const seen = new Map();
  const records = rows.map((row, rowIndex) => {
    noteDuplicateCode(seen, trim(row.code_name), rowIndex, fileName, row, findings);
    const uncertain = parseYesFlag(row.uncertain, `${fileName} row ${rowIndex} uncertain`);
    if (uncertain) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.DECODER_RING_UNCERTAIN,
          file: fileName,
          rowIndex,
          subject: trim(row.code_name),
          detail: `the fields workbook wrote "?" against ${trim(row.actual_label)}`,
          raw: row,
        })
      );
    }
    return {
      rowIndex,
      codeName: trim(row.code_name),
      actualLabel: trim(row.actual_label),
      venue: trim(row.venue),
      remainder: orNull(row.remainder),
      uncertain,
      confirmed: orNull(row.confirmed),
      usedFor: orNull(row.used_for),
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/**
 * Compare the two decoder rings on the codes they share. A disagreement is a
 * shared code whose `actual_label` differs by exact text — spelling variants
 * included, because resolving one silently would delete the test case.
 *
 * The fields sheet's `confirmed` column is carried on every disagreement so
 * that "neither side is marked authoritative" is something a reader derives
 * from the data rather than takes on trust. Nothing here resolves on it.
 *
 * @param {Array<{rowIndex:number, displayName:string, actualLabel:string|null, raw:Object}>} aliases
 * @param {Array<{codeName:string, actualLabel:string, confirmed:string|null, raw:Object}>} codeNames
 * @returns {{ shared: string[], disagreements: Array<{code:string, practiceSheet:string|null, fieldsSheet:string, fieldsSheetConfirmed:string|null}>, findings: Array<Object> }}
 */
export function compareDecoderRings(aliases, codeNames) {
  const byCode = new Map(codeNames.map((record) => [record.codeName, record]));
  const shared = [];
  const disagreements = [];
  const findings = [];
  for (const alias of aliases) {
    const other = byCode.get(alias.displayName);
    if (!other) continue;
    shared.push(alias.displayName);
    if (alias.actualLabel === other.actualLabel) continue;
    disagreements.push({
      code: alias.displayName,
      practiceSheet: alias.actualLabel,
      fieldsSheet: other.actualLabel,
      fieldsSheetConfirmed: other.confirmed,
    });
    findings.push(
      makePracticeFinding({
        code: SEASON_2026_PRACTICE_FINDING.DECODER_RINGS_DISAGREE,
        file: 'practice_field_aliases.csv',
        rowIndex: alias.rowIndex,
        subject: alias.displayName,
        detail: `practice sheet says ${JSON.stringify(alias.actualLabel)}; fields sheet says ${JSON.stringify(other.actualLabel)}${other.confirmed === null ? '' : ` (confirmed: ${other.confirmed})`}`,
        raw: alias.raw,
      })
    );
  }
  return { shared, disagreements, findings };
}

/* -------------------------------------------------------------------------- */
/* field_constraints.csv                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parseFieldConstraints(text, _options = {}) {
  const fileName = 'field_constraints.csv';
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const records = rows.map((row, rowIndex) => {
    const fields = trim(row.fields);
    if (ISO_DATE_RE.test(fields)) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.CONSTRAINT_FIELDS_EXCEL_DATE_CORRUPTION,
          file: fileName,
          rowIndex,
          subject: `${trim(row.venue)} ${trim(row.date_start)}`,
          detail: `fields cell ${JSON.stringify(fields)} is a date; the author most likely typed a field range`,
          raw: row,
        })
      );
    }
    const dateStart = requireIsoDate(row.date_start, `${fileName} row ${rowIndex} date_start`);
    const dateEnd = requireIsoDate(row.date_end, `${fileName} row ${rowIndex} date_end`);
    const spanDays = inclusiveSpanDays(dateStart, dateEnd);
    const allFields = fields === 'All';
    return {
      id: `${fileName}#${rowIndex}`,
      rowIndex,
      dateStart,
      dateEnd,
      startMinutes: parseClock24Minutes(row.time_start),
      endMinutes: parseClock24Minutes(row.time_end),
      venue: trim(row.venue),
      fields,
      allFields,
      spanDays,
      seasonLong: allFields && spanDays >= SEASON_LONG_CLOSURE_MIN_DAYS,
      reason: trim(row.reason),
      sourceKind: orNull(row.source_kind),
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/* -------------------------------------------------------------------------- */
/* Registrations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parse `coach_registration.csv`. Both player slots and both co-coach slots
 * are always emitted — an empty slot carries `refClass: 'none'` from the
 * source — so a consumer never has to guess whether a missing element meant
 * "none" or "not looked at".
 *
 * The season year is required, not optional: the implausible-birth-year
 * check cannot run without it, and a check that quietly does not run is the
 * hollow guarantee CLAUDE.md §3 names.
 *
 * @param {string} text
 * @param {{ seasonYear: number }} options
 */
export function parseCoachRegistration(text, options) {
  const fileName = 'coach_registration.csv';
  if (!options || !Number.isInteger(options.seasonYear)) {
    throw new TypeError(`${fileName}: seasonYear is required to judge birth years`);
  }
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const seen = new Map();
  const records = rows.map((row, rowIndex) => {
    const personKey = trim(row.person_key);
    if (seen.has(personKey)) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.DUPLICATE_PERSON_KEY,
          file: fileName,
          rowIndex,
          subject: personKey,
          detail: `also registered at row ${seen.get(personKey)}`,
          raw: row,
        })
      );
    } else {
      seen.set(personKey, rowIndex);
    }
    const players = /** @type {Array<1|2>} */ ([1, 2]).map((slot) => {
      const birthYear = parseIntOrNull(
        row[`player_${slot}_birth_year`],
        `${fileName} row ${rowIndex} player_${slot}_birth_year`
      );
      if (birthYear !== null && birthYear >= options.seasonYear) {
        findings.push(
          makePracticeFinding({
            code: SEASON_2026_PRACTICE_FINDING.BIRTH_YEAR_IMPLAUSIBLE,
            file: fileName,
            rowIndex,
            subject: `${personKey} player ${slot}`,
            detail: `birth year ${birthYear} is not before the ${options.seasonYear} season`,
            raw: row,
          })
        );
      }
      return {
        slot,
        key: orNull(row[`player_${slot}_key`]),
        refClass: trim(row[`player_${slot}_ref_class`]),
        gender: orNull(row[`player_${slot}_gender`]),
        birthYear,
        playingUp: parseYesFlag(
          row[`player_${slot}_playing_up`],
          `${fileName} row ${rowIndex} player_${slot}_playing_up`
        ),
      };
    });
    const preferredCoCoaches = /** @type {Array<1|2>} */ ([1, 2]).map((slot) => ({
      slot,
      key: orNull(row[`preferred_co_coach_${slot}_key`]),
      refClass: trim(row[`preferred_co_coach_${slot}_class`]),
    }));
    return {
      rowIndex,
      coachName: trim(row.coach_name),
      personKey,
      players,
      preferredCoCoaches,
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/**
 * Same contract as `parseCoachRegistration()`: the season year is required so
 * the birth-year check cannot silently not run.
 *
 * @param {string} text
 * @param {{ seasonYear: number }} options
 */
export function parsePlayerRegistration(text, options) {
  const fileName = 'player_registration.csv';
  if (!options || !Number.isInteger(options.seasonYear)) {
    throw new TypeError(`${fileName}: seasonYear is required to judge birth years`);
  }
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const seen = new Map();
  const records = rows.map((row, rowIndex) => {
    const playerKey = trim(row.player_key);
    if (seen.has(playerKey)) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.DUPLICATE_PLAYER_KEY,
          file: fileName,
          rowIndex,
          subject: playerKey,
          detail: `also registered at row ${seen.get(playerKey)}`,
          raw: row,
        })
      );
    } else {
      seen.set(playerKey, rowIndex);
    }
    const birthYear = parseIntCell(row.birth_year, `${fileName} row ${rowIndex} birth_year`);
    if (birthYear >= options.seasonYear) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.BIRTH_YEAR_IMPLAUSIBLE,
          file: fileName,
          rowIndex,
          subject: playerKey,
          detail: `birth year ${birthYear} is not before the ${options.seasonYear} season`,
          raw: row,
        })
      );
    }
    return {
      rowIndex,
      playerName: trim(row.player_name),
      playerKey,
      gender: trim(row.gender),
      birthYear,
      ageGroup: parseIntCell(row.age_group, `${fileName} row ${rowIndex} age_group`),
      ageGroupCode: orNull(row.age_group_code),
      program: orNull(row.program),
      playingUp: parseYesFlag(row.playing_up, `${fileName} row ${rowIndex} playing_up`),
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/**
 * The roster spells a Select team `14BSelect01`; `select_coaches.csv` carries
 * `U14B` and `1`. One derivation, here.
 *
 * @param {string} division - e.g. `U14B`
 * @param {number} teamNumber
 * @returns {string}
 */
export function selectTeamCode(division, teamNumber) {
  const match = trim(division).match(/^U(\d{2}[BG])$/);
  if (!match) throw new TypeError(`unparseable Select division: ${JSON.stringify(division)}`);
  return `${match[1]}Select${String(teamNumber).padStart(2, '0')}`;
}

/**
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parseSelectCoaches(text, _options = {}) {
  const fileName = 'select_coaches.csv';
  const rows = expectCsvColumns(text, fileName);
  const records = rows.map((row, rowIndex) => {
    const teamNumber = parseIntCell(row.team_number, `${fileName} row ${rowIndex} team_number`);
    return {
      rowIndex,
      division: trim(row.division),
      teamNumber,
      teamCode: selectTeamCode(row.division, teamNumber),
      coachSlot: parseIntCell(row.coach_slot, `${fileName} row ${rowIndex} coach_slot`),
      coachName: trim(row.coach_name),
      personKey: trim(row.person_key),
      raw: row,
    };
  });
  return finish(fileName, records, [], rows.length);
}

/* -------------------------------------------------------------------------- */
/* game_change_log.csv                                                         */
/* -------------------------------------------------------------------------- */

const NOT_PREVIOUSLY_SCHEDULED = '(not previously scheduled)';

/**
 * A `was` / `now` cell: `5:30 PM Alder Park Soccer 2`, or the unscheduled
 * marker. Anything else is a third form the corpus does not currently carry.
 *
 * @param {string} value
 * @param {string} label
 */
function parseChangeSide(value, label) {
  const raw = trim(value);
  if (raw === NOT_PREVIOUSLY_SCHEDULED) {
    return { raw, unscheduled: true, minutes: null, location: null };
  }
  const match = raw.match(/^(\d{1,2}:\d{2} [AP]M) (.+)$/);
  if (!match) throw new TypeError(`${label}: unparseable change cell ${JSON.stringify(value)}`);
  return {
    raw,
    unscheduled: false,
    minutes: /** @type {number} */ (parseClockMinutes(match[1])),
    location: match[2].trim(),
  };
}

/**
 * @param {string} text
 * @param {{ seasonYear: number }} options - the log carries no year
 */
export function parseGameChangeLog(text, options) {
  const fileName = 'game_change_log.csv';
  if (!options || !Number.isInteger(options.seasonYear)) {
    throw new TypeError(`${fileName}: seasonYear is required to date the log`);
  }
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const records = rows.map((row, rowIndex) => {
    const { date, note } = parseMonthDayDate(row.date, options.seasonYear);
    // The note is the log's only evidence about the year it was given, since
    // the year comes from another file. Same contract as the permit sheet.
    if (
      note !== null &&
      DAY_NAME_TO_CODE.has(note) &&
      DAY_NAME_TO_CODE.get(note) !== weekdayCodeOf(date)
    ) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.CHANGE_LOG_DAY_MISMATCH,
          file: fileName,
          rowIndex,
          subject: trim(row.date),
          detail: `note says ${note}; ${date} is a ${weekdayCodeOf(date)}`,
          raw: row,
        })
      );
    }
    const matchup = trim(row.matchup);
    const sides = matchup.split(' vs ');
    if (sides.length !== 2) {
      throw new TypeError(`${fileName} row ${rowIndex}: matchup is not "A vs B": ${matchup}`);
    }
    return {
      rowIndex,
      dateLabel: trim(row.date),
      date,
      dateNote: note,
      matchup,
      homeLabel: sides[0].trim(),
      awayLabel: sides[1].trim(),
      was: parseChangeSide(row.was, `${fileName} row ${rowIndex} was`),
      now: parseChangeSide(row.now, `${fileName} row ${rowIndex} now`),
      reason: trim(row.reason),
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/* -------------------------------------------------------------------------- */
/* Permits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parsePermits(text, _options = {}) {
  const fileName = 'permits.csv';
  const rows = expectCsvColumns(text, fileName);
  const records = rows.map((row, rowIndex) => ({
    rowIndex,
    permitId: trim(row.permit_id),
    venue: trim(row.venue),
    event: trim(row.event),
    issued: requireIsoDate(row.issued, `${fileName} row ${rowIndex} issued`),
    maxDailyAttendance: parseIntCell(
      row.max_daily_attendance,
      `${fileName} row ${rowIndex} max_daily_attendance`
    ),
    sourcePages: parseIntCell(row.source_pages, `${fileName} row ${rowIndex} source_pages`),
    raw: row,
  }));
  return finish(fileName, records, [], rows.length);
}

/**
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parsePermitReservations(text, _options = {}) {
  const fileName = 'permit_reservations.csv';
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const records = rows.map((row, rowIndex) => {
    const date = requireIsoDate(row.date, `${fileName} row ${rowIndex} date`);
    const weekday = weekdayCodeOf(date);
    const day = trim(row.day);
    if (weekdayCodeOfDayName(day) !== weekday) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.PERMIT_DAY_MISMATCH,
          file: fileName,
          rowIndex,
          subject: `${trim(row.permit_id)} ${date}`,
          detail: `sheet says ${day}; ${date} is a ${weekday}`,
          raw: row,
        })
      );
    }
    return {
      rowIndex,
      permitId: trim(row.permit_id),
      venue: trim(row.venue),
      date,
      day,
      weekday,
      startMinutes: parseClock24Minutes(row.start),
      endMinutes: parseClock24Minutes(row.end),
      facility: trim(row.facility),
      services: orNull(row.services),
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/* -------------------------------------------------------------------------- */
/* The fields workbook                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Parse `field_inventory.csv`. The cells are operator shorthand
 * (`11v11 (4) 9v9 (8)`, `??`, `XX`) and are kept as written; nothing here is
 * load-bearing enough yet to justify inventing a grammar for it.
 *
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parseFieldInventory(text, _options = {}) {
  const fileName = 'field_inventory.csv';
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const seen = new Map();
  const records = rows.map((row, rowIndex) => {
    const venue = trim(row.venue);
    if (seen.has(venue)) {
      findings.push(
        makePracticeFinding({
          code: SEASON_2026_PRACTICE_FINDING.DUPLICATE_INVENTORY_VENUE,
          file: fileName,
          rowIndex,
          subject: venue,
          detail: `also inventoried at row ${seen.get(venue)}`,
          raw: row,
        })
      );
    } else {
      seen.set(venue, rowIndex);
    }
    return {
      rowIndex,
      venue,
      fieldSizes: trim(row.field_sizes),
      ageGroups: orNull(row.age_groups),
      practiceMaxTeams: orNull(row.practice_max_teams),
      bathroom: orNull(row.bathroom),
      notes: orNull(row.notes),
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/**
 * Parse `field_weekly_availability.csv`. The `raw_value` is kept beside the
 * interpretation on every record, and the two interpretations a later reader
 * might overrule — `excel-date-corruption` and `unparsed` — are findings.
 *
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parseWeeklyAvailability(text, _options = {}) {
  const fileName = 'field_weekly_availability.csv';
  const rows = expectCsvColumns(text, fileName);
  const findings = [];
  const records = rows.map((row, rowIndex) => {
    const interpretation = orNull(row.interpretation);
    const window = trim(row.interpreted_window);
    let startMinutes = null;
    let endMinutes = null;
    if (window !== '') {
      const match = window.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
      if (!match) throw new TypeError(`${fileName} row ${rowIndex}: unparseable window ${window}`);
      startMinutes = parseClock24Minutes(match[1]);
      endMinutes = parseClock24Minutes(match[2]);
    }
    // Corruption is detected from the data, the same way `field_constraints.csv`
    // is judged: a raw value that is an ISO date was never a time window. The
    // source's own label is read beside it, and the finding says whether the
    // two agree, so a row the anonymiser left unlabelled is still reported.
    const rawValue = trim(row.raw_value);
    const dateShaped = ISO_DATE_RE.test(rawValue);
    const labelled = interpretation === 'excel-date-corruption';
    const flagged =
      dateShaped || labelled
        ? SEASON_2026_PRACTICE_FINDING.AVAILABILITY_EXCEL_DATE_CORRUPTION
        : interpretation === 'unparsed'
          ? SEASON_2026_PRACTICE_FINDING.AVAILABILITY_UNPARSED
          : null;
    if (flagged) {
      const agreement =
        flagged !== SEASON_2026_PRACTICE_FINDING.AVAILABILITY_EXCEL_DATE_CORRUPTION
          ? ''
          : dateShaped && labelled
            ? '; the source labels it so'
            : dateShaped
              ? `; the source labels it ${JSON.stringify(interpretation)}`
              : '; the raw value is not date-shaped';
      findings.push(
        makePracticeFinding({
          code: flagged,
          file: fileName,
          rowIndex,
          subject: `${trim(row.venue)} ${trim(row.day)}`,
          detail: `raw ${JSON.stringify(rawValue)} interpreted as ${JSON.stringify(window)}${agreement}`,
          raw: row,
        })
      );
    }
    return {
      rowIndex,
      venue: trim(row.venue),
      day: trim(row.day),
      weekday: weekdayCodeOfDayName(row.day),
      rawValue,
      startMinutes,
      endMinutes,
      interpretation,
      raw: row,
    };
  });
  return finish(fileName, records, findings, rows.length);
}

/**
 * @param {string} text
 * @param {{ seasonYear?: number }} [_options] - accepted so every parser has one shape
 */
export function parseFieldEquipment(text, _options = {}) {
  const fileName = 'field_equipment.csv';
  const rows = expectCsvColumns(text, fileName);
  const records = rows.map((row, rowIndex) => {
    const value = trim(row.value);
    return {
      rowIndex,
      venue: trim(row.venue),
      item: trim(row.item),
      value,
      quantity: /^\d+(\.\d+)?$/.test(value) ? Number(value) : null,
      raw: row,
    };
  });
  return finish(fileName, records, [], rows.length);
}

/**
 * The parser for a corpus file, by file name.
 *
 * @readonly
 */
export const SEASON_2026_PRACTICE_PARSERS = Object.freeze({
  'practice_grid.csv': parsePracticeGrid,
  'practice_field_aliases.csv': parsePracticeFieldAliases,
  'field_code_names.csv': parseFieldCodeNames,
  'field_constraints.csv': parseFieldConstraints,
  'coach_registration.csv': parseCoachRegistration,
  'player_registration.csv': parsePlayerRegistration,
  'game_change_log.csv': parseGameChangeLog,
  'select_coaches.csv': parseSelectCoaches,
  'permits.csv': parsePermits,
  'permit_reservations.csv': parsePermitReservations,
  'field_inventory.csv': parseFieldInventory,
  'field_weekly_availability.csv': parseWeeklyAvailability,
  'field_equipment.csv': parseFieldEquipment,
});
