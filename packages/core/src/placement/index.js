/**
 * Barrel for the placement **demonstration harness**.
 *
 * The name is the warning. This package is not a scheduler and must not become
 * one: it re-places one date's worth of one format at one venue, earliest legal
 * slot first, so that the effect of a constraint's hardness on a real schedule
 * can be seen and diffed. `replaceGames.js` opens with the full statement of
 * what it does not do and why; read it before extending anything here.
 *
 * The production change-request path is `packages/core/src/resolve/` (Phase
 * 4.1), which re-places games against a freeze plan and refuses to invent a
 * slot. It neither supersedes nor imports this harness: a minimal-diff
 * re-solver cannot demonstrate the hardness flip, because it leaves a legal
 * schedule where it is under either hardness. Reconciling `gameScheduling.js`'s
 * week index with the date index every other module uses is still open
 * (GAP-32). Nothing in this package is imported by `gameScheduling.js`,
 * `autoScheduler.js`, `gameMetrics.js` or `resolve/`.
 *
 * @module placement
 */

export { FixedBookingSchema, PlacementGameSchema, PlacementInputSchema } from './schemas.js';

export {
  compareRuns,
  createPlacementMeta,
  diffAgainstPublished,
  replaceGamesUnderRegistry,
} from './replaceGames.js';

export {
  SEASON_2026_PLACEMENT_FORMAT,
  toSeason2026PlacementInput,
} from './adapters/season2026Placement.js';
