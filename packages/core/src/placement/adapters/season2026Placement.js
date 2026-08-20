/**
 * Turn a slice of the season-2026 corpus into a placement run's input.
 *
 * Everything here is *selection*, not invention. The harness is bounded to one
 * date, one format and one venue, and every element of the grid it searches is
 * taken from the corpus:
 *
 * - **the games** are the rows of that format on that date;
 * - **the candidate surfaces** are the surfaces the published schedule actually
 *   used for that format on that date — not "every surface big enough", which
 *   would put a 9v9 game on a full Pitch 1 that the club never books that way;
 * - **the candidate kickoffs** are the kickoff times used *at that venue on that
 *   date by any format*. This is the interesting choice: it is what puts 10:00
 *   and 12:00 — the negotiated Select kickoffs from incident 3 — into the search
 *   space, and therefore what makes field adjacency binding at all;
 * - **the fixed bookings** are every other row at that venue on that date, held
 *   still. On 08/22 those are the four 11v11 Select games on Pitches 2 and 3,
 *   which overlap Pitches 1 and 4.
 *
 * Like every other adapter in this package it takes **already-parsed rows** as
 * arguments and reads nothing from disk; the arrow points fixtures -> placement,
 * never back.
 *
 * @module placement/adapters/season2026Placement
 */

import { season2026SurfaceId } from '../../facility/adapters/season2026Geometry.js';
import { requireSurface } from '../../facility/facilityGraph.js';

/**
 * The date and format the acceptance test uses.
 *
 * 08/22 is the first rec Saturday and the date incident 3 turns on: the external
 * league published its seeding fixtures at 10:30/12:30, the final agreement
 * moved that pair 30 minutes earlier to 10:00/12:00, and those are the times the
 * corpus carries. Those Select games sit on Pitches 2 and 3, which overlap the
 * 9v9 ground on 1 and 4.
 */
export const SEASON_2026_PLACEMENT_FORMAT = '9v9';

/**
 * Build the input for one bounded placement run.
 *
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {ReadonlyArray<Object>} rows - already-parsed `combined_schedule.csv` rows
 * @param {{ date: string, format?: string }} selection
 * @returns {{ date: string, venueId: string, games: Array<Object>, fixedBookings: Array<Object>, candidateSurfaceIds: string[], candidateKickoffMinutes: number[] }}
 */
export function toSeason2026PlacementInput(graph, rows, selection) {
  const format = selection.format ?? SEASON_2026_PLACEMENT_FORMAT;
  const date = selection.date;

  const onDate = rows.filter((row) => row.date === date);
  if (onDate.length === 0) {
    throw new Error(`placement: the corpus has no rows on ${date}`);
  }

  const chosen = onDate.filter((row) => row.format === format);
  if (chosen.length === 0) {
    throw new Error(`placement: the corpus has no ${format} rows on ${date}`);
  }

  const venues = [...new Set(chosen.map((row) => row.venue))];
  if (venues.length !== 1) {
    throw new Error(
      `placement: this harness is bounded to one venue, and ${format} on ${date} spans ${venues.length} (${venues.join(', ')})`
    );
  }
  const venueName = venues[0];
  const venueId = requireSurface(graph, season2026SurfaceId(venueName, chosen[0].field)).venueId;

  const atVenue = onDate.filter((row) => row.venue === venueName);

  const games = [...chosen]
    .sort(
      (a, b) =>
        a.kickoffMinutes - b.kickoffMinutes ||
        a.field.localeCompare(b.field) ||
        a.id.localeCompare(b.id)
    )
    .map((row) => ({
      id: row.id,
      format: row.format,
      label: `${row.homeLabel} v ${row.awayLabel}`,
      divisionLabel: row.division || null,
      publishedSurfaceId: season2026SurfaceId(row.venue, row.field),
      publishedKickoffMinutes: row.kickoffMinutes,
    }));

  const chosenIds = new Set(chosen.map((row) => row.id));
  const fixedBookings = atVenue
    .filter((row) => !chosenIds.has(row.id))
    .map((row) => ({
      id: row.id,
      surfaceId: season2026SurfaceId(row.venue, row.field),
      date: row.date,
      startMinutes: row.kickoffMinutes,
      endMinutes: row.endMinutes,
      format: row.format || null,
      label: `${row.homeLabel} v ${row.awayLabel}`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const candidateSurfaceIds = [
    ...new Set(chosen.map((row) => season2026SurfaceId(row.venue, row.field))),
  ].sort();

  const candidateKickoffMinutes = [...new Set(atVenue.map((row) => row.kickoffMinutes))].sort(
    (a, b) => a - b
  );

  return { date, venueId, games, fixedBookings, candidateSurfaceIds, candidateKickoffMinutes };
}
