/**
 * Barrel for the game-time model.
 *
 * Every public export of `timing/` goes through this file, exactly as
 * `packages/core/src/facility/index.js` does for the facility graph.
 *
 * The package is pure domain logic: no React, no `node:*`, no `Date`
 * construction, and **no import from `fixtures/`**. The arrow points
 * fixtures -> timing, never back; the season-2026 adapter takes the
 * already-parsed format rows as an argument, so this module never learns where
 * the corpus lives or how it is read. It *does* import `facility/`, and that is
 * the point: warm-up occupancy is checked by the Phase 1.1 overlap machinery
 * rather than by a second implementation of it.
 *
 * Phase 1 is **in-memory only**. There is no SQL home for any of this yet and
 * this work deliberately does not create one — see
 * [`docs/DURATION_MIGRATION.md`](../../../../docs/DURATION_MIGRATION.md) for the
 * migration path that has been analysed but not performed.
 *
 * @module timing
 */

export {
  TIMING_REASON,
  TIMING_REASON_SEVERITY,
  TIMING_SEVERITY,
  TIMING_STATUS,
  WARMUP_CODE_BY_FACILITY_CODE,
  deriveTimingStatus,
  makeTimingFinding,
  timingSeverityOf,
} from './reasonCodes.js';

export {
  EarliestKickoffQuerySchema,
  FormatTimingInputSchema,
  FormatTimingTableInputSchema,
  MinutesRangeSchema,
  ScheduledMinutesRangeSchema,
  TimingFixtureSchema,
  WarmupWindowQuerySchema,
} from './schemas.js';

export {
  buildFormatTimingTable,
  formatTimingOrUnknown,
  getFormatTiming,
  hasKnownFootprint,
  occupancyEndMinutes,
  requireFormatTiming,
  unknownFormatTiming,
  warmupMinutesFor,
} from './formatTiming.js';

export { computeGameWindows } from './windows.js';

export {
  WARMUP_BOOKING_SUFFIX,
  buildTimingBookings,
  checkFixtureTiming,
  earliestKickoffWithWarmup,
  findTimingConflicts,
  gameBookingFor,
  warmupBookingFor,
  warmupBookingId,
  warmupWindowAvailability,
} from './warmup.js';

export {
  SEASON_2026_INCIDENT_8_WARMUP_MINUTES,
  SEASON_2026_WARMUP_POLICY,
  buildFormatTimingTableFromSeason2026,
  toFormatTimingInput,
} from './adapters/season2026Formats.js';
