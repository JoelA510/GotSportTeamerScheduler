/**
 * The season-2026 corpus's reserved slots, side kinds and capacity question.
 *
 * **Direction of the arrow: fixtures -> reserve.** This module takes
 * already-parsed rows as arguments and imports nothing from
 * `packages/core/src/fixtures/`, exactly as `facility/adapters/season2026Geometry.js`
 * takes parsed geometry and `ruleEngine/adapters/season2026Schedule.js` takes a
 * loaded season.
 *
 * ## The one interesting decision in this file
 *
 * `combined_schedule.csv` spells four different things with the single
 * character `-` in its `Away` column, and the difference between them is the
 * whole of GAP-15 through GAP-18:
 *
 * ```text
 * MinisA          -    there is no opponent and there never will be
 * Select Game 7   -    the league has not said yet
 * Scrimmage TBD   -    this is not a fixture at all, it is held ground
 * 14GSelect02     Visiting Club A - U14G North    a real opponent with no id here
 * ```
 *
 * {@link season2026FixtureSides} tells them apart, and it does so from the row
 * **kind** the loader already derived structurally — never from the `-` itself,
 * which cannot carry the distinction, and never from a name heuristic on the
 * label, which is the second half of incident 4.
 *
 * @module reserve/adapters/season2026Reserve
 */

import {
  season2026SurfaceId,
  season2026VenueId,
} from '../../facility/adapters/season2026Geometry.js';

import { conditionForSurface } from '../conditions.js';
import { FIXTURE_SIDE, RESERVE_KIND } from '../reasonCodes.js';
import { makeReservedSlot } from '../slots.js';

/**
 * The corpus's row kinds, spelled again rather than imported because
 * `fixtures/season2026Loader.js` reads the disk through `node:fs` and
 * `packages/core/src/reserve/` must not — the same reason
 * `ruleEngine/adapters/season2026Schedule.js` re-spells its two.
 *
 * @readonly
 * @enum {string}
 */
export const SEASON_2026_KIND = Object.freeze({
  REC_GAME: 'rec_game',
  MINIS_SESSION: 'minis_session',
  LEAGUE_PLACEHOLDER: 'league_placeholder',
  EXTERNAL_FIXTURE: 'external_fixture',
  SCRIMMAGE: 'scrimmage',
  RESERVATION: 'reservation',
});

/**
 * The format the Select layer's reserved slots are played in.
 *
 * From `combined_schedule.csv`: every one of the 100 `Select Game N` rows
 * carries `11v11`, and `game_formats.csv` gives that format a 90-minute
 * worst-case occupancy inside a 120-minute block.
 */
export const SEASON_2026_RESERVE_FORMAT = '11v11';

/**
 * The external league's cap on how many games it sends the club per Saturday.
 *
 * > *"An external league caps the club at 10 games per Saturday and picks which
 * > teams play, publishing late."*
 *
 * A **policy input**, not a derivation: it is the other league's rule and no
 * file in the corpus states it. It is recorded here with its provenance so that
 * the capacity report can say *which* constraint caps the reserved number — and
 * `tests/reserveCapacity.test.js` checks the corpus against it rather than
 * deriving it from the corpus, which would make the check circular.
 */
export const SEASON_2026_LEAGUE_CAP_PER_DATE = 10;

/**
 * The club's stated first kickoff of a match day.
 *
 * The permits at Alder Park, Brookside, Maplewood, Orchard Park and Riverbend
 * all open at 07:00, and the club does not play at 07:00. Every reserved Select
 * slot on unlit ground in `combined_schedule.csv` starts at 08:00 or later, and
 * the capacity model **proves** this anchor rather than assuming it: a reserved
 * slot that does not land on a generated one is `RESERVED_SLOT_OFF_GRID` at
 * `blocking`.
 *
 * Summit HS is unaffected either way — its permits open at 14:00 or 17:00, both
 * later than this, so the permit governs there.
 */
export const SEASON_2026_EARLIEST_KICKOFF_MINUTES = 8 * 60;

/** `fixtures/season-2026/combined_schedule.csv`, cited often enough to name. */
const COMBINED = 'fixtures/season-2026/combined_schedule.csv';

/** The build plan's statement of the league arrangement, for the cap and the requirement. */
const BUILD_PLAN = 'scheduling build plan, Prompt 5.1 — unnamed fixtures and capacity reporting';

/**
 * Which side kinds each of a row's two sides has.
 *
 * Kind-aware by construction. The `-` token means "nobody" on a Minis row and
 * "not yet" on a reserved league slot, and only the row kind can tell them
 * apart.
 *
 * @param {{ kind: string, homeLabel: string, awayLabel: string }} row
 * @param {{ teamUniverse: ReadonlyArray<string> }} options
 * @returns {{ homeSide: string, awaySide: string }}
 */
export function season2026FixtureSides(row, options) {
  if (!options || !Array.isArray(options.teamUniverse)) {
    throw new Error(
      'reserve: season2026FixtureSides needs { teamUniverse } — a team identifier is a member of the roster or it is not one'
    );
  }
  const known = new Set(options.teamUniverse.map(String));
  const home = String(row.homeLabel ?? '');
  const away = String(row.awayLabel ?? '');
  const sideOf = (label) => (known.has(label) ? FIXTURE_SIDE.TEAM : FIXTURE_SIDE.EXTERNAL);

  switch (row.kind) {
    case SEASON_2026_KIND.MINIS_SESSION:
      return {
        homeSide: known.has(home) ? FIXTURE_SIDE.TEAM : FIXTURE_SIDE.SESSION,
        awaySide: FIXTURE_SIDE.NONE,
      };
    case SEASON_2026_KIND.LEAGUE_PLACEHOLDER:
    case SEASON_2026_KIND.RESERVATION:
      return { homeSide: FIXTURE_SIDE.TBD, awaySide: FIXTURE_SIDE.TBD };
    case SEASON_2026_KIND.REC_GAME:
    case SEASON_2026_KIND.SCRIMMAGE:
    case SEASON_2026_KIND.EXTERNAL_FIXTURE:
    default:
      return { homeSide: sideOf(home), awaySide: sideOf(away) };
  }
}

/**
 * The corpus's reserved slots: the 100 unnamed league fixtures and the single
 * field reservation.
 *
 * @param {ReadonlyArray<Object>} rows - already-parsed `combined_schedule.csv` rows
 * @param {{ graph: import('../../facility/types.js').FacilityGraph, teamUniverse: ReadonlyArray<string> }} options
 * @returns {import('../types.js').ReservedSlot[]}
 */
export function season2026ReservedSlots(rows, options) {
  const { graph, teamUniverse } = options ?? {};
  if (!graph || !Array.isArray(teamUniverse)) {
    throw new Error('reserve: season2026ReservedSlots needs { graph, teamUniverse }');
  }

  return rows
    .filter(
      (row) =>
        row.kind === SEASON_2026_KIND.LEAGUE_PLACEHOLDER ||
        row.kind === SEASON_2026_KIND.RESERVATION
    )
    .map((row) => {
      const surfaceId = season2026SurfaceId(row.venue, row.field);
      const sides = season2026FixtureSides(row, { teamUniverse });
      const isReservation = row.kind === SEASON_2026_KIND.RESERVATION;
      return makeReservedSlot({
        id: String(row.id),
        kind: isReservation ? RESERVE_KIND.RESERVATION : RESERVE_KIND.UNNAMED_FIXTURE,
        label: String(row.homeLabel),
        date: String(row.date),
        venueId: season2026VenueId(row.venue),
        surfaceId,
        startMinutes: Number(row.kickoffMinutes),
        endMinutes: row.endMinutes === null ? null : Number(row.endMinutes),
        format: row.format ? String(row.format) : null,
        divisionLabel: row.division ? String(row.division) : null,
        // The reservation's purpose is the thing the ground is held *for*, and
        // the corpus states it in the `Format` column: `Scrimmage`.
        purpose: isReservation && row.format ? String(row.format) : null,
        homeSide: sides.homeSide,
        awaySide: sides.awaySide,
        homeTeamId: null,
        awayTeamId: null,
        homeLabel: String(row.homeLabel),
        awayLabel: null,
        condition: conditionForSurface(graph, surfaceId),
        source: COMBINED,
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every corpus row as a facility booking, so a condition can be evaluated
 * against what is genuinely standing on the ground.
 *
 * Rows of unknown footprint keep `endMinutes: null` (GAP-14) rather than being
 * dropped: a booking nobody can measure is still a booking somebody has to work
 * around, and `evaluateSlotCondition()` reports it as undecidable instead of
 * quietly treating the ground as free.
 *
 * @param {ReadonlyArray<Object>} rows
 * @param {{ excludeIds?: ReadonlyArray<string> }} [options]
 * @returns {import('../../facility/types.js').FacilityBooking[]}
 */
export function season2026ReserveBookings(rows, options = {}) {
  const excluded = new Set((options.excludeIds ?? []).map(String));
  return rows
    .filter((row) => !excluded.has(String(row.id)))
    .map(
      (row) =>
        /** @type {import('../../facility/types.js').FacilityBooking} */ ({
          id: String(row.id),
          surfaceId: season2026SurfaceId(row.venue, row.field),
          date: String(row.date),
          startMinutes: Number(row.kickoffMinutes),
          endMinutes: row.endMinutes === null ? null : Number(row.endMinutes),
          format: row.format ? String(row.format) : null,
          label: `${row.homeLabel} v ${row.awayLabel}`,
        })
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The Select teams, from the roster.
 *
 * A **label parse**, and it lives in the adapter for that reason: GAP-24 records
 * that division labels are not a key, so this is derived from the team codes the
 * roster carries (`14GSelect02`) rather than from the `Division` column, which
 * disagrees with itself for this layer. It is enumerated from the roster and not
 * from the fixtures on purpose — `16BSelect02` is on the roster and appears in
 * no fixture at all, and a requirement derived from the fixtures would quietly
 * be one team short.
 *
 * @param {ReadonlyArray<{ id: string }>} teams
 * @returns {string[]}
 */
export function season2026SelectTeamIds(teams) {
  return teams
    .map((team) => String(team.id))
    .filter((id) => /Select\d+$/.test(id))
    .sort();
}

/**
 * The stated requirement: every reserved Saturday must hold every Select team,
 * should the league send them all home.
 *
 * @param {ReadonlyArray<{ id: string }>} teams
 * @returns {import('../types.js').CapacityRequirement}
 */
export function season2026CapacityRequirement(teams) {
  const selectTeamIds = season2026SelectTeamIds(teams);
  return {
    slots: selectTeamIds.length,
    label: `all ${selectTeamIds.length} Select teams at home on the same day`,
    source: `${BUILD_PLAN}; team count derived from fixtures/season-2026/coach_roster.csv`,
  };
}

/**
 * The external league's cap, as a record.
 *
 * @returns {import('../types.js').CapacityCap}
 */
export function season2026LeagueCap() {
  return {
    limit: SEASON_2026_LEAGUE_CAP_PER_DATE,
    label: 'games the external league sends the club per Saturday',
    source: BUILD_PLAN,
  };
}

/**
 * Build the whole capacity question from a loaded season.
 *
 * The dates are the dates the corpus actually reserved slots on; the surfaces
 * are every surface in the graph that is *sized* for the format, which is wider
 * than the four the club used and is the right universe for a capacity question
 * — "how much ground could hold this" rather than "how much did we book".
 *
 * @param {{ combinedGames: ReadonlyArray<Object>, teams: ReadonlyArray<{ id: string }> }} season
 * @param {{ graph: import('../../facility/types.js').FacilityGraph, table: import('../../timing/types.js').FormatTimingTable, format?: string, name?: string }} options
 * @returns {Object} input for `buildReserveCapacityReport()`
 */
export function season2026ReserveCapacityInput(season, options) {
  const { graph, table } = options ?? {};
  if (!graph || !table) {
    throw new Error('reserve: season2026ReserveCapacityInput needs { graph, table }');
  }
  const format = options.format ?? SEASON_2026_RESERVE_FORMAT;
  const teamUniverse = season.teams.map((team) => String(team.id));

  const reservedSlots = season2026ReservedSlots(season.combinedGames, { graph, teamUniverse });
  const forFormat = reservedSlots.filter((slot) => slot.format === format);
  const dates = [...new Set(forFormat.map((slot) => slot.date))].sort();
  const surfaceIds = graph.surfaceIds
    .filter((id) => (graph.surfaces[id].sizes ?? []).includes(format))
    .sort();

  const timing = table.formats[format];
  const cadenceMinutes = timing?.blockMinutes ?? null;
  if (!cadenceMinutes) {
    throw new Error(
      `reserve: format "${format}" has no block length in the timing table, so no kickoff cadence can be derived; game_formats.csv is where that number lives`
    );
  }

  return {
    name: options.name ?? `season-2026 reserve capacity (${format})`,
    format,
    dates,
    surfaceIds,
    cadenceMinutes,
    earliestKickoffMinutes: SEASON_2026_EARLIEST_KICKOFF_MINUTES,
    requirement: season2026CapacityRequirement(season.teams),
    cap: season2026LeagueCap(),
    reservedSlots,
    // **Every** published row, reserved ground included. A reservation is not a
    // game and it still occupies a field (GAP-17), so excluding the slots here
    // would delete the only field reservation the corpus has from the very
    // bookings the conditions are judged against — and a condition can then
    // never be blocked by held ground, which is most of what a conditional slot
    // is for. A candidate slot is not blocked by *itself*, structurally: a
    // condition never names the surface its own slot stands on, so nothing
    // standing on that surface is watched at all.
    bookings: season2026ReserveBookings(season.combinedGames),
  };
}
