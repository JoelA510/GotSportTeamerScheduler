/**
 * Publication: putting slots that are not fully known, and fixtures that have no
 * slot at all, into the export.
 *
 * > *"They must occupy fields, appear in exports, and accept team assignment
 * > later without moving."* — and, for an unplaced fixture, *"export with
 * > explicit TIME TBD / LOCATION TBD plus the reason."*
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is a **projection**. It turns {@link import('./types.js').ReservedSlot} and
 * {@link import('./types.js').UnplacedFixture} records into flat rows keyed by
 * `SCHEDULE_EXPORT_HEADERS` — the column vocabulary
 * `packages/core/src/outputGeneration.js` already publishes — so the two cannot
 * drift apart into two spellings of "Event Type".
 *
 * It is **not** wired into `generateScheduleExports()`, and that is a decision
 * rather than an omission. That function requires a truthy `homeTeamId` *and* a
 * truthy `awayTeamId`, requires both to resolve in the team directory, requires
 * truthy `start` and `end`, and normalises both through `new Date(value)`.
 * Every one of those is a wall an unnamed fixture or a TIME TBD row hits by
 * construction: a `Select Game 7` has no teams yet, and `TIME TBD` is not a
 * date. Relaxing four validators and a date normaliser inside a function the
 * shipping app already calls is not a small additive change, and Prompt 5.1
 * asks for the data in a shape that function can consume rather than for the
 * rewiring. So: rows in its vocabulary here, wiring named as follow-up in
 * `docs/MODEL_GAPS.md` (GAP-16, GAP-17, GAP-28).
 *
 * ## The one thing it checks
 *
 * That every subject produced at least one row. The export is the last place a
 * fixture can quietly disappear, and a projection that silently emitted nothing
 * for a TIME TBD fixture would reproduce incident 10 at the final step.
 *
 * @module reserve/publication
 */

import { SCHEDULE_EXPORT_COLUMNS, SCHEDULE_EXPORT_HEADERS } from '../outputGeneration.js';

import {
  FIXTURE_SIDE,
  PUBLICATION_TBD,
  RESERVE_KIND,
  RESERVE_REASON,
  createReserveMeta,
  deriveReserveStatus,
  makeReserveFinding,
} from './reasonCodes.js';
import { slotNamesATeam } from './slots.js';

/** The `Event Type` values this module emits. */
export const PUBLICATION_EVENT_TYPE = Object.freeze({
  /** A committed league slot whose teams are not yet known. */
  UNNAMED_FIXTURE: 'Game (teams TBD)',
  /** Ground held for a purpose, with no fixture behind it. */
  RESERVATION: 'Field Reservation',
  /** A named game. */
  GAME: 'Game',
  /** A fixture that must exist and has no legal slot. */
  UNPLACED: 'Game (unscheduled)',
});

/**
 * Render minutes past local midnight as a naive local datetime.
 *
 * The first place in Phases 1-5 that renders a time for a human, and it stays
 * **naive**: no `Date` is constructed and no offset is applied, because the
 * corpus is wall-clock only and two of its dates fall after DST ends (GAP-30).
 * Turning these into absolute instants before the domain model carries a venue
 * timezone is how an evening kickoff moves an hour without anybody asking.
 *
 * @param {string} date - `YYYY-MM-DD`
 * @param {number|null} minutes
 * @param {string} fallback - what to print when there is no time
 * @returns {string}
 */
export function naiveDateTime(date, minutes, fallback) {
  if (minutes === null || minutes === undefined) return fallback;
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mins = String(minutes % 60).padStart(2, '0');
  return `${date}T${hours}:${mins}:00`;
}

/**
 * One blank row in the export's vocabulary.
 *
 * @returns {Record<string, string>}
 */
function blankRow() {
  /** @type {Record<string, string>} */
  const row = {};
  for (const column of SCHEDULE_EXPORT_COLUMNS) row[column] = '';
  return row;
}

/**
 * What a side should print as.
 *
 * @param {string} side - a `FIXTURE_SIDE` value
 * @param {string|null} teamId
 * @param {string|null} label
 * @param {Map<string, Object>} directory
 * @returns {string}
 */
function sideText(side, teamId, label, directory) {
  if (side === FIXTURE_SIDE.TEAM && teamId) {
    return String(directory.get(teamId)?.name ?? teamId);
  }
  if (side === FIXTURE_SIDE.TBD) return PUBLICATION_TBD.OPPONENT;
  if (side === FIXTURE_SIDE.NONE) return '';
  return label ?? '';
}

/**
 * Fill a row's team columns from the directory, or from the id alone.
 *
 * @param {Record<string, string>} row
 * @param {string|null} teamId
 * @param {string} displayName
 * @param {Map<string, Object>} directory
 * @param {string|null} divisionLabel
 * @returns {void}
 */
function fillTeam(row, teamId, displayName, directory, divisionLabel) {
  const team = teamId ? directory.get(teamId) : null;
  row[SCHEDULE_EXPORT_HEADERS.TEAM_ID] = teamId ?? '';
  row[SCHEDULE_EXPORT_HEADERS.TEAM_NAME] = String(team?.name ?? displayName);
  row[SCHEDULE_EXPORT_HEADERS.DIVISION] = String(team?.division ?? divisionLabel ?? '');
  row[SCHEDULE_EXPORT_HEADERS.COACH_NAME] = String(team?.coachName ?? '');
  row[SCHEDULE_EXPORT_HEADERS.COACH_EMAIL] = String(team?.coachEmail ?? '');
  row[SCHEDULE_EXPORT_HEADERS.ASSISTANT_COACHES] = Array.isArray(team?.assistantCoaches)
    ? team.assistantCoaches.join('; ')
    : '';
}

/**
 * Project reserved slots and unplaced fixtures into export rows.
 *
 * @param {{ slots?: ReadonlyArray<import('./types.js').ReservedSlot>, unplaced?: ReadonlyArray<import('./types.js').UnplacedFixture>, teams?: ReadonlyArray<Object> }} input
 * @returns {{ rows: import('./types.js').PublicationRow[], columns: ReadonlyArray<string>, findings: import('./types.js').ReserveFinding[], status: string, meta: import('./types.js').ReserveMeta }}
 */
export function publicationRowsFor(input) {
  const meta = createReserveMeta();
  /** @type {import('./types.js').ReserveFinding[]} */
  const findings = [];
  /** @type {import('./types.js').PublicationRow[]} */
  const rows = [];

  const directory = new Map((input.teams ?? []).map((team) => [String(team.id), team]));
  const slots = input.slots ?? [];
  const unplaced = input.unplaced ?? [];

  for (const slot of slots) {
    meta.slotsExamined += 1;
    const eventType =
      slot.kind === RESERVE_KIND.RESERVATION
        ? PUBLICATION_EVENT_TYPE.RESERVATION
        : slotNamesATeam(slot)
          ? PUBLICATION_EVENT_TYPE.GAME
          : PUBLICATION_EVENT_TYPE.UNNAMED_FIXTURE;

    const sides = /** @type {const} */ (['home', 'away']);
    const named = sides.filter((side) => slot[`${side}Side`] === FIXTURE_SIDE.TEAM);
    const notes = slot.purpose ?? '';

    const base = () => {
      const row = blankRow();
      row[SCHEDULE_EXPORT_HEADERS.EVENT_TYPE] = eventType;
      row[SCHEDULE_EXPORT_HEADERS.START] = naiveDateTime(
        slot.date,
        slot.startMinutes,
        PUBLICATION_TBD.TIME
      );
      row[SCHEDULE_EXPORT_HEADERS.END] = naiveDateTime(
        slot.date,
        slot.endMinutes,
        PUBLICATION_TBD.TIME
      );
      row[SCHEDULE_EXPORT_HEADERS.FIELD] = slot.surfaceId;
      row[SCHEDULE_EXPORT_HEADERS.SLOT] = slot.id;
      row[SCHEDULE_EXPORT_HEADERS.NOTES] = notes;
      return row;
    };

    if (named.length === 0) {
      // Nobody is named yet, and the row still has to exist: the club committed
      // this field and this kickoff, and a schedule that omitted it would show
      // the ground as free.
      const row = base();
      fillTeam(row, null, slot.label, directory, slot.divisionLabel);
      row[SCHEDULE_EXPORT_HEADERS.OPPONENT] = sideText(
        slot.awaySide,
        slot.awayTeamId,
        slot.awayLabel,
        directory
      );
      rows.push({ row, subjectId: slot.id, teamId: null });
      meta.rowsEmitted += 1;
      continue;
    }

    for (const side of named) {
      const other = side === 'home' ? 'away' : 'home';
      const teamId = slot[`${side}TeamId`];
      const row = base();
      fillTeam(row, teamId, String(teamId), directory, slot.divisionLabel);
      row[SCHEDULE_EXPORT_HEADERS.ROLE] = side === 'home' ? 'Home' : 'Away';
      row[SCHEDULE_EXPORT_HEADERS.OPPONENT] = sideText(
        slot[`${other}Side`],
        slot[`${other}TeamId`],
        slot[`${other}Label`],
        directory
      );
      rows.push({ row, subjectId: slot.id, teamId: /** @type {string} */ (teamId) });
      meta.rowsEmitted += 1;
    }
  }

  for (const fixture of unplaced) {
    meta.fixturesTimeTbd += 1;
    const base = () => {
      const row = blankRow();
      row[SCHEDULE_EXPORT_HEADERS.EVENT_TYPE] = PUBLICATION_EVENT_TYPE.UNPLACED;
      row[SCHEDULE_EXPORT_HEADERS.START] = fixture.timeStatus;
      row[SCHEDULE_EXPORT_HEADERS.END] = fixture.timeStatus;
      row[SCHEDULE_EXPORT_HEADERS.FIELD] = fixture.locationStatus;
      row[SCHEDULE_EXPORT_HEADERS.SLOT] = fixture.fixtureId;
      row[SCHEDULE_EXPORT_HEADERS.NOTES] = fixture.reason;
      return row;
    };

    const sides = /** @type {const} */ (['home', 'away']);
    const named = sides.filter((side) => Boolean(fixture[`${side}TeamId`]));

    if (named.length === 0) {
      const row = base();
      fillTeam(row, null, fixture.label, directory, fixture.divisionLabel);
      rows.push({ row, subjectId: fixture.fixtureId, teamId: null });
      meta.rowsEmitted += 1;
      continue;
    }

    for (const side of named) {
      const other = side === 'home' ? 'away' : 'home';
      const teamId = /** @type {string} */ (fixture[`${side}TeamId`]);
      const row = base();
      fillTeam(row, teamId, teamId, directory, fixture.divisionLabel);
      row[SCHEDULE_EXPORT_HEADERS.ROLE] = side === 'home' ? 'Home' : 'Away';
      row[SCHEDULE_EXPORT_HEADERS.OPPONENT] = String(
        fixture[`${other}TeamId`] ?? fixture[`${other}Label`] ?? PUBLICATION_TBD.OPPONENT
      );
      rows.push({ row, subjectId: fixture.fixtureId, teamId });
      meta.rowsEmitted += 1;
    }
  }

  // The export is the last place a fixture can disappear.
  const covered = new Set(rows.map((entry) => entry.subjectId));
  for (const fixture of unplaced) {
    if (covered.has(fixture.fixtureId)) continue;
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.FIXTURE_DROPPED,
        `fixture "${fixture.fixtureId}" is carried as ${fixture.timeStatus} and produced no export row, so it would be invisible to the people it belongs to`,
        { fixtureId: fixture.fixtureId }
      )
    );
  }

  return {
    rows,
    columns: SCHEDULE_EXPORT_COLUMNS,
    findings,
    status: deriveReserveStatus(findings),
    meta,
  };
}
