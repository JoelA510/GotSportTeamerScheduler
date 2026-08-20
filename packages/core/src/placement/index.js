/**
 * Barrel for the placement **demonstration harness**.
 *
 * The name is the warning. This package is not a scheduler and must not become
 * one: it re-places one date's worth of one format at one venue, earliest legal
 * slot first, so that the effect of a constraint's hardness on a real schedule
 * can be seen and diffed. `replaceGames.js` opens with the full statement of
 * what it does not do and why; read it before extending anything here.
 *
 * The production solver integration — teaching `gameScheduling.js` to consult
 * the registry, and reconciling its week index with the date index every Phase 1
 * module uses — is **Phase 4** and is deliberately out of scope. Nothing in this
 * package is imported by `gameScheduling.js`, `autoScheduler.js` or
 * `gameMetrics.js`.
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
