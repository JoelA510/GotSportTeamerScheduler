/**
 * The season-2026 corpus as a {@link import('../types.js').Schedule}.
 *
 * The arrow still points fixtures -> ruleEngine, never back: this module reads
 * nothing from disk and imports nothing from `packages/core/src/fixtures/`. It
 * takes the already-parsed season object as an argument, exactly as
 * `facility/adapters/season2026Geometry.js` takes parsed geometry and
 * `availability/adapters/season2026Permits.js` takes parsed permit rows.
 *
 * ## The one interesting decision in this file
 *
 * `season2026Parsers.js` sets `homeTeamId` to the raw `Home` cell unless that
 * cell announces itself as a placeholder, and `awayTeamId` to the raw `Away`
 * cell unless it is the `-` token. That is the right call *for a loader* — it
 * keeps every row and drops nothing — but it means `MinisA`, `Select Game 7`
 * (via the `Home` side of a reserved slot) and `Visiting Club A - U14G` all
 * arrive wearing a field called `teamId`.
 *
 * **This adapter refuses them.** A team identifier is a member of the roster's
 * team universe or it is not a team identifier, and everything else that ever
 * appeared in a `Home` or `Away` cell is collected into
 * `schedule.placeholderLabels` — the list the engine checks every rule's match
 * against. That list is *derived*, not typed in: it is exactly the set of cells
 * the roster does not know, which for this corpus is `-`, `MinisA`..`MinisD`,
 * `Select Game 1`..`Select Game N`, `Scrimmage - teams TBD` and the non-member
 * opponents.
 *
 * This is incident 4's second half, defused at the seam where it happened:
 * *"a checker misread placeholder labels as team codes and reported violations
 * that didn't exist."* A caller that skips this adapter and hands the loader's
 * `homeTeamId` straight to the engine gets a `blocking`
 * `RULE_MATCHED_PLACEHOLDER` rather than a page of phantom missing fixtures,
 * and `tests/ruleEngine.test.js` does precisely that on purpose.
 *
 * @module ruleEngine/adapters/season2026Schedule
 */

import {
  season2026SurfaceId,
  season2026VenueId,
} from '../../facility/adapters/season2026Geometry.js';

/**
 * The row kinds whose games count toward season structure — the round robin
 * and the hosting balance.
 *
 * Mirrors `SEASON_2026_ROW_KIND` in `fixtures/season2026Parsers.js`, spelled
 * again rather than imported because that module reads the disk through
 * `node:fs` and `packages/core/src/ruleEngine/` must not.
 *
 * @type {ReadonlySet<string>}
 */
export const SEASON_2026_COUNTED_ROW_KINDS = Object.freeze(new Set(['rec_game', 'minis_session']));

/**
 * The age group a division label belongs to, or null.
 *
 * A *label* parse, and it lives in the adapter for that reason: GAP-24 records
 * that division labels are not a key, so the engine never does this and the
 * layer that knows how this corpus spells its labels does it once.
 *
 * @param {string|null|undefined} division
 * @returns {string|null}
 */
export function season2026AgeGroup(division) {
  const match = String(division ?? '').match(/^U?(\d{1,2})/);
  return match ? `U${match[1].padStart(2, '0')}` : null;
}

/**
 * Build the engine's schedule from a loaded season.
 *
 * @param {{ combinedGames: Array<Object>, teams: Array<Object>, people: Array<Object>, coachTimelines: Map<string, Array<Object>> }} season
 * @param {{ name?: string|null, games?: Array<Object>|null }} [options]
 * @returns {import('../types.js').Schedule}
 */
export function toSeason2026Schedule(season, options = {}) {
  const rows = options.games ?? season.combinedGames;
  const teamUniverse = [...new Set(season.teams.map((team) => String(team.id)))].sort();
  const knownTeams = new Set(teamUniverse);
  const personUniverse = [
    ...new Set(season.people.map((person) => String(person.personKey))),
  ].sort();

  /** @type {Set<string>} */
  const placeholders = new Set();
  const games = rows.map((row) => {
    const venueId = season2026VenueId(row.venue);
    const surfaceId = season2026SurfaceId(row.venue, row.field);
    const homeLabel = String(row.homeLabel ?? '');
    const awayLabel = String(row.awayLabel ?? '');
    // A team identifier is a roster member or it is not a team identifier.
    const homeTeamId = knownTeams.has(homeLabel) ? homeLabel : null;
    const awayTeamId = knownTeams.has(awayLabel) ? awayLabel : null;
    if (homeTeamId === null && homeLabel !== '') placeholders.add(homeLabel);
    if (awayTeamId === null && awayLabel !== '') placeholders.add(awayLabel);

    return {
      id: String(row.id),
      date: String(row.date),
      startMinutes: Number(row.kickoffMinutes),
      endMinutes: row.endMinutes === null ? null : Number(row.endMinutes),
      venueId,
      surfaceId,
      format: row.format ? String(row.format) : null,
      divisionLabel: row.division ? String(row.division) : null,
      homeTeamId,
      awayTeamId,
      homeLabel,
      awayLabel,
      counted: SEASON_2026_COUNTED_ROW_KINDS.has(String(row.kind)),
    };
  });

  const teams = season.teams.map((team) => ({
    id: String(team.id),
    divisionLabel: team.division ? String(team.division) : null,
    groupLabel: season2026AgeGroup(team.division),
    personIds: [...(team.coachPersonKeys ?? [])].map(String).sort(),
  }));

  /** @type {Array<Object>} */
  const commitments = [];
  for (const [personKey, entries] of season.coachTimelines) {
    for (const entry of entries) {
      if (!knownTeams.has(String(entry.teamId))) continue;
      commitments.push({
        id: `${personKey}|${entry.gameId}`,
        personId: String(personKey),
        date: String(entry.date),
        startMinutes: Number(entry.startMinutes),
        endMinutes: entry.endMinutes === null ? null : Number(entry.endMinutes),
        venueId: season2026VenueId(entry.game.venue),
        surfaceId: season2026SurfaceId(entry.game.venue, entry.game.field),
        teamId: String(entry.teamId),
        gameId: String(entry.gameId),
      });
    }
  }
  commitments.sort((a, b) => a.id.localeCompare(b.id));

  // Derived from the **team records** first, and only then widened by the
  // division column of the counted rows. Deriving it the other way round —
  // from `game.counted && game.divisionLabel !== null`, the exact filter
  // `roundRobinRule` applies — made the flagship coverage assertion compare a
  // set against itself: a division whose rows all vanish left the universe at
  // the same instant it left the rule's reach, so "the round-robin rule
  // examined every division" could not fail. The rows still contribute,
  // because a label such as `BB` that no rostered team belongs to is a
  // division this schedule genuinely carries and the rule genuinely judges.
  const divisionUniverse = [
    ...new Set([
      ...teams
        .map((team) => team.divisionLabel)
        .filter((label) => label !== null)
        .map((label) => /** @type {string} */ (label)),
      ...games
        .filter((game) => game.counted && game.divisionLabel !== null)
        .map((game) => /** @type {string} */ (game.divisionLabel)),
    ]),
  ].sort();

  return /** @type {import('../types.js').Schedule} */ ({
    name: options.name ?? 'season-2026 combined schedule',
    games,
    commitments,
    teams,
    teamUniverse,
    personUniverse,
    divisionUniverse,
    surfaceUniverse: [...new Set(games.map((game) => game.surfaceId))].sort(),
    venueUniverse: [...new Set(games.map((game) => game.venueId))].sort(),
    placeholderLabels: [...placeholders].sort(),
  });
}
