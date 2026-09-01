/**
 * A **demonstration harness**, not a solver.
 *
 * Read this paragraph before reading anything else in the file. This module
 * exists to answer one question — *"does flipping a constraint's hardness
 * actually change where games go, and can the system say which ones?"* — and to
 * answer it against the real corpus rather than a mock. It is deliberately tiny
 * and deliberately dumb:
 *
 * - it places a **bounded** set of games (one date, one format, one venue);
 * - onto a **bounded** grid of candidate slots that the corpus itself already
 *   used, inventing no times and no fields;
 * - **earliest legal slot first**, with no objective function, no repair pass,
 *   no lookahead and no backtracking.
 *
 * That last point is a real limitation and it is intentional. The production
 * objective is *minimal diff against the published schedule* — incident 1 in
 * `fixtures/season-2026/README.md` is 366 games silently moving because nothing
 * rewarded leaving them alone — and earliest-first is the opposite of that. It
 * now exists, in `packages/core/src/resolve/objective.js` (Prompt 4.2), and this
 * harness still does not use it: a minimal-diff placer would be useless here,
 * because the published schedule is legal under both hardnesses, so "keep
 * everything where it is" would report no difference and demonstrate nothing.
 *
 * **The real path is `packages/core/src/resolve/` (Phase 4.1).** That package
 * re-places existing games against a freeze plan, holds everything a change
 * request did not name, and refuses to invent a slot; it is what a production
 * change request goes through. It does **not** supersede this module and does
 * not import it. The two answer different questions, and this one's question
 * still has no other home: *does flipping a constraint's hardness change where
 * games go?* cannot be asked of a minimal-diff re-solver, because a minimal-diff
 * re-solver leaves a legal schedule exactly where it is under either hardness
 * and reports no difference at all.
 *
 * `gameScheduling.js` is still week-indexed while every Phase 1 module, this one
 * and `resolve/` are date-indexed, and bridging that (GAP-32) remains its own
 * piece of work; `scheduleGames()` now refuses a `freeze` argument outright
 * rather than accepting one it could not honour. Nothing here is imported by
 * `gameScheduling.js`, `autoScheduler.js`, `gameMetrics.js` or `resolve/`, and
 * nothing here should grow until it is tempting to.
 *
 * What it *does* legitimately show: the constraint registry is the only thing
 * that differs between two runs, the placement rules themselves are entirely
 * Phase 1 (`checkKickoffAvailability` — occupancy, permit, lighting, daylight,
 * size, lining, equipment), and the diff names the specific games that moved.
 *
 * @module placement/replaceGames
 */

import { checkKickoffAvailability } from '../availability/kickoff.js';
import { applyRegistrySeverity, effectiveSeverityTable } from '../constraints/severity.js';
import { CONSTRAINT_STATUS } from '../constraints/reasonCodes.js';
import { requireSurface } from '../facility/facilityGraph.js';

import { PlacementInputSchema } from './schemas.js';

/**
 * Fresh zeroed counters.
 *
 * Incident 4 is the reason these exist and the reason
 * {@link replaceGamesUnderRegistry} throws when `candidatesEvaluated` would be
 * zero: a run that tried nothing and placed nothing must not read as a run that
 * found everything fine.
 *
 * @returns {import('./types.js').PlacementMeta}
 */
export function createPlacementMeta() {
  return {
    gamesConsidered: 0,
    candidatesEvaluated: 0,
    candidatesRejected: 0,
    placementsMade: 0,
    surfacesConsidered: 0,
    kickoffsConsidered: 0,
    fixedBookingsHeld: 0,
    findingsExamined: 0,
    findingsReseverified: 0,
    registryCodesGoverned: 0,
    registryOverridesApplied: 0,
  };
}

/**
 * Re-place a bounded set of games against the Phase 1 modules, under a supplied
 * constraint registry.
 *
 * The registry enters in exactly one place: `applyRegistrySeverity()` rewrites
 * the severity of the findings Phase 1 produced, and the status is re-derived
 * from that. No branch in this file asks what type any constraint is.
 *
 * @param {{ graph: import('../facility/types.js').FacilityGraph, table: import('../timing/types.js').FormatTimingTable, calendar: import('../availability/types.js').AvailabilityCalendar, registry: import('../constraints/types.js').ConstraintRegistry }} engines
 * @param {Object} input - see `PlacementInputSchema`
 * @returns {import('./types.js').PlacementRun}
 */
export function replaceGamesUnderRegistry(engines, input) {
  const { graph, table: timingTable, calendar, registry } = engines ?? {};
  if (!graph || !timingTable || !calendar || !registry) {
    throw new Error(
      'placement: replaceGamesUnderRegistry needs { graph, table, calendar, registry } as its first argument'
    );
  }
  const parsed = PlacementInputSchema.parse(input);

  const meta = createPlacementMeta();
  const kickoffs = [...parsed.candidateKickoffMinutes].sort((a, b) => a - b);
  const surfaceIds = [...parsed.candidateSurfaceIds].sort();
  meta.kickoffsConsidered = kickoffs.length;
  meta.surfacesConsidered = surfaceIds.length;
  meta.fixedBookingsHeld = parsed.fixedBookings.length;

  for (const surfaceId of surfaceIds) {
    const surface = requireSurface(graph, surfaceId);
    if (parsed.venueId !== undefined && surface.venueId !== parsed.venueId) {
      throw new Error(
        `placement: candidate surface "${surfaceId}" belongs to venue "${surface.venueId}", not "${parsed.venueId}"; this harness is bounded to one venue`
      );
    }
  }

  /** @type {import('../facility/types.js').FacilityBooking[]} */
  const working = parsed.fixedBookings.map((booking) => ({
    ...booking,
    endMinutes: booking.endMinutes ?? null,
  }));
  /** @type {import('./types.js').Placement[]} */
  const placements = [];
  /** @type {import('./types.js').UnplacedGame[]} */
  const unplaced = [];
  /** @type {import('./types.js').RejectedCandidate[]} */
  const rejections = [];

  for (const game of parsed.games) {
    meta.gamesConsidered += 1;
    let placed = null;
    let attempts = 0;

    for (const kickoffMinutes of kickoffs) {
      if (placed) break;
      for (const surfaceId of surfaceIds) {
        attempts += 1;
        meta.candidatesEvaluated += 1;
        const surface = requireSurface(graph, surfaceId);

        const availability = checkKickoffAvailability(
          graph,
          timingTable,
          calendar,
          {
            surfaceId,
            date: parsed.date,
            kickoffMinutes,
            format: game.format,
            ignoreBookingIds: [game.id],
          },
          { existingBookings: working }
        );

        const teamIds = [game.homeTeamId, game.awayTeamId].filter(
          (id) => typeof id === 'string' && id.length > 0
        );
        const severity = effectiveSeverityTable(registry, {
          date: parsed.date,
          venueId: surface.venueId,
          surfaceId,
          surfaceLineage: [...surface.lineage],
          ...(game.divisionLabel ? { divisionLabel: game.divisionLabel } : {}),
          // **The sides are a scope this harness holds.** Round 2 closed exactly
          // this omission in `resolve/legality.js` `checkPlacement()` and left
          // the copy here: `ScopeContextSchema` reads an absent field as "the
          // context does not name one", so every `team`-scoped record came back
          // `CONSTRAINT_SCOPE_UNJUDGED` and was not applied — while
          // `ruleEngine/engine.js` narrows per subject with this very field, so
          // one registry gave two verdicts about one game. Omitted rather than
          // sent empty when the row names no side: an empty array is a stated
          // "no teams" that matches nothing while claiming to have looked.
          ...(teamIds.length > 0 ? { teamIds } : {}),
        });
        meta.registryCodesGoverned += severity.meta.reasonCodesGoverned;
        meta.registryOverridesApplied += severity.meta.reasonCodesOverridden;

        const applied = applyRegistrySeverity(availability.findings, severity);
        meta.findingsExamined += applied.meta.findingsExamined;
        meta.findingsReseverified += applied.meta.findingsReseverified;

        if (applied.status === CONSTRAINT_STATUS.REJECTED) {
          meta.candidatesRejected += 1;
          rejections.push({
            gameId: game.id,
            surfaceId,
            kickoffMinutes,
            status: applied.status,
            findings: applied.findings,
          });
          continue;
        }

        placed = {
          gameId: game.id,
          label: game.label,
          format: game.format,
          divisionLabel: game.divisionLabel,
          surfaceId,
          surfaceName: surface.name,
          venueId: surface.venueId,
          date: parsed.date,
          kickoffMinutes,
          occupancyMinutes: availability.occupancyMinutes,
          endMinutes: availability.endMinutes,
          status: applied.status,
          findings: applied.findings,
          publishedSurfaceId: game.publishedSurfaceId,
          publishedKickoffMinutes: game.publishedKickoffMinutes,
          attempts,
        };
        break;
      }
    }

    if (!placed) {
      // Incident 10: an unplaceable fixture stays visible with a reason. It is
      // never dropped, and the run does not pretend it succeeded.
      unplaced.push({
        gameId: game.id,
        label: game.label,
        attempts,
        publishedSurfaceId: game.publishedSurfaceId,
        publishedKickoffMinutes: game.publishedKickoffMinutes,
        reason: `no candidate slot among ${kickoffs.length} kickoff(s) x ${surfaceIds.length} surface(s) survived the registry`,
      });
      continue;
    }

    meta.placementsMade += 1;
    placements.push(placed);
    working.push({
      id: placed.gameId,
      surfaceId: placed.surfaceId,
      date: parsed.date,
      startMinutes: placed.kickoffMinutes,
      endMinutes: placed.endMinutes,
      format: placed.format,
      label: placed.label,
    });
  }

  if (meta.candidatesEvaluated === 0) {
    throw new Error(
      'placement: the run evaluated zero candidates, so its result is vacuous (incident 4)'
    );
  }

  return {
    date: parsed.date,
    registryName: registry.name ?? null,
    placements,
    unplaced,
    rejections,
    diffVsPublished: diffAgainstPublished(placements, unplaced),
    meta,
  };
}

/**
 * How far a run drifted from the schedule families already have.
 *
 * Reported by **game**, never as a bare count: incident 1 is a count that said
 * "366" long after the damage was done, and the only recovery was re-importing
 * the published file game by game.
 *
 * @param {ReadonlyArray<import('./types.js').Placement>} placements
 * @param {ReadonlyArray<import('./types.js').UnplacedGame>} unplaced
 * @returns {import('./types.js').PlacementDiff}
 */
export function diffAgainstPublished(placements, unplaced = []) {
  /** @type {import('./types.js').PlacementChange[]} */
  const changed = [];
  /** @type {string[]} */
  const unchanged = [];

  for (const placement of placements) {
    /** @type {string[]} */
    const changedFields = [];
    if (
      placement.publishedSurfaceId !== null &&
      placement.publishedSurfaceId !== placement.surfaceId
    ) {
      changedFields.push('surfaceId');
    }
    if (
      placement.publishedKickoffMinutes !== null &&
      placement.publishedKickoffMinutes !== placement.kickoffMinutes
    ) {
      changedFields.push('kickoffMinutes');
    }
    if (changedFields.length === 0) {
      unchanged.push(placement.gameId);
      continue;
    }
    changed.push({
      gameId: placement.gameId,
      label: placement.label,
      changedFields,
      before: {
        surfaceId: placement.publishedSurfaceId,
        kickoffMinutes: placement.publishedKickoffMinutes,
      },
      after: { surfaceId: placement.surfaceId, kickoffMinutes: placement.kickoffMinutes },
    });
  }

  changed.sort((a, b) => a.gameId.localeCompare(b.gameId));
  unchanged.sort();

  return {
    changed,
    unchanged,
    unplacedGameIds: unplaced.map((game) => game.gameId).sort(),
    counts: {
      changed: changed.length,
      unchanged: unchanged.length,
      unplaced: unplaced.length,
    },
  };
}

/**
 * Which specific games differ between two runs.
 *
 * The literal wording of the acceptance test is "the system reports **which
 * specific games** differ", so this returns the games and not a number. It
 * refuses to compare runs over different game sets: a diff between two
 * populations is not a diff, it is a category error wearing one.
 *
 * @param {import('./types.js').PlacementRun} before
 * @param {import('./types.js').PlacementRun} after
 * @returns {import('./types.js').RunComparison}
 */
export function compareRuns(before, after) {
  const idsOf = (run) =>
    [...run.placements.map((p) => p.gameId), ...run.unplaced.map((g) => g.gameId)].sort();
  const beforeIds = idsOf(before);
  const afterIds = idsOf(after);
  if (beforeIds.join('\u0000') !== afterIds.join('\u0000')) {
    throw new Error(
      `placement: the two runs cover different games (${beforeIds.length} vs ${afterIds.length}); a comparison between different populations is meaningless`
    );
  }
  if (beforeIds.length === 0) {
    throw new Error('placement: both runs are empty, so the comparison is vacuous (incident 4)');
  }

  /** @type {Map<string, import('./types.js').Placement>} */
  const beforeById = new Map(before.placements.map((p) => [p.gameId, p]));
  /** @type {Map<string, import('./types.js').Placement>} */
  const afterById = new Map(after.placements.map((p) => [p.gameId, p]));

  /** @type {import('./types.js').RunChange[]} */
  const changed = [];
  /** @type {string[]} */
  const unchanged = [];

  for (const gameId of beforeIds) {
    const a = beforeById.get(gameId) ?? null;
    const b = afterById.get(gameId) ?? null;
    /** @type {string[]} */
    const changedFields = [];
    if ((a === null) !== (b === null)) changedFields.push('placed');
    if (a && b) {
      if (a.surfaceId !== b.surfaceId) changedFields.push('surfaceId');
      if (a.kickoffMinutes !== b.kickoffMinutes) changedFields.push('kickoffMinutes');
      if (a.status !== b.status) changedFields.push('status');
    }
    if (changedFields.length === 0) {
      unchanged.push(gameId);
      continue;
    }
    changed.push({
      gameId,
      label: a?.label ?? b?.label ?? null,
      changedFields,
      before: a
        ? { surfaceId: a.surfaceId, kickoffMinutes: a.kickoffMinutes, status: a.status }
        : null,
      after: b
        ? { surfaceId: b.surfaceId, kickoffMinutes: b.kickoffMinutes, status: b.status }
        : null,
    });
  }

  changed.sort((a, b) => a.gameId.localeCompare(b.gameId));
  unchanged.sort();

  return {
    changed,
    unchanged,
    counts: { changed: changed.length, unchanged: unchanged.length, compared: beforeIds.length },
  };
}
