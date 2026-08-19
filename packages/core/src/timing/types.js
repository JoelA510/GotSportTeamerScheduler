/**
 * JSDoc typedefs for the game-time model.
 *
 * Type-only module: no runtime exports, ending in `export {};` exactly like
 * `packages/core/src/facility/types.js`.
 *
 * **Vocabulary.** "Duration" is banned from this module's public surface. It is
 * the word that hid incident 7, because it can equally mean any of four
 * different spans:
 *
 * ```text
 * ballInPlay   halves x halfMinutes                 the ball is moving
 * occupancy    ballInPlay + halftime                kickoff -> final whistle
 * block        the declared per-field cadence       = occupancy + turnover here
 * schedulable  warm-up start -> end of turnover     what actually blocks ground
 * ```
 *
 * Every span in this module names which one it is. Where a span is a range —
 * 11v11 halftime is `5-10`, so its occupancy is `85-90` — the range is carried
 * whole. Margins are computed against `scheduled` (the worst case, which
 * `game_formats.csv` states outright as "schedule as 90"); the best case rides
 * along beside it and never replaces it.
 *
 * Times are minutes past local midnight and dates are ISO `YYYY-MM-DD`. No
 * `Date` is constructed anywhere (GAP-30).
 *
 * @module timing/types
 */

/**
 * An inclusive minutes range.
 *
 * @typedef {Object} MinutesRange
 * @property {number} min
 * @property {number} max
 */

/**
 * A minutes range plus the value the corpus instructs scheduling against.
 *
 * `scheduled` is the **worst case**. It is a separate field rather than "just
 * use `max`" because the instruction is a statement in the source data
 * (`85-90 (schedule as 90)`) and deserves to survive as one.
 *
 * @typedef {Object} ScheduledMinutesRange
 * @property {number} min
 * @property {number} max
 * @property {number} scheduled
 * @property {string|null} note - the source's own words, for audit
 */

/**
 * Plain input for one format, as accepted by `buildFormatTimingTable()`.
 *
 * @typedef {Object} FormatTimingInput
 * @property {string} format
 * @property {string|null} [program]
 * @property {number|null} [halves]
 * @property {number|null} [halfMinutes]
 * @property {MinutesRange|null} [halftimeMinutes]
 * @property {ScheduledMinutesRange} occupancyMinutes
 * @property {number} blockMinutes
 * @property {number|null} [turnoverPreferredMinutes]
 * @property {string|null} [turnoverPreferredNote]
 * @property {number|null} [turnoverMinMinutes]
 */

/**
 * One format's resolved timing.
 *
 * `footprint` is tri-stated down to two values on purpose: `'known'` or
 * `'unknown'`. `Scrimmage` appears in `combined_schedule.csv` and has no row in
 * `game_formats.csv` (GAP-14), so its footprint is genuinely unknown and stays
 * that way. Nothing in this module invents a number for it.
 *
 * @typedef {Object} FormatTiming
 * @property {string} format
 * @property {string|null} program
 * @property {'known'|'unknown'} footprint
 * @property {number|null} halves
 * @property {number|null} halfMinutes
 * @property {MinutesRange|null} halftimeMinutes
 * @property {boolean} halftimeIsRange
 * @property {number|null} ballInPlayMinutes - halves x halfMinutes
 * @property {ScheduledMinutesRange|null} occupancyMinutes
 * @property {MinutesRange|null} derivedOccupancyMinutes - ballInPlay + halftime
 * @property {number|null} blockMinutes
 * @property {number|null} turnoverPreferredMinutes
 * @property {number|null} turnoverMinMinutes
 * @property {boolean} turnoverInsideBlock
 * @property {number|null} blockSlackMinutes - blockMinutes - occupancy.scheduled
 * @property {boolean} warmupInsideBlock - false for every season-2026 format
 * @property {number|null} warmupMinutes - from policy; null means "not stated"
 * @property {TimingFinding[]} findings - reconciliation findings for this format
 */

/**
 * A half-open window `[startMinutes, endMinutes)` in minutes past midnight.
 *
 * @typedef {Object} TimingWindow
 * @property {number} startMinutes
 * @property {number} endMinutes
 * @property {number} minutes
 */

/**
 * The occupancy window, carrying both ends of the range.
 *
 * `endMinutes` is the **worst case** and is the value every margin uses.
 * `bestCaseEndMinutes` is reported so an operator can see the slack that exists
 * when halftime runs short — never so a check can quietly use it.
 *
 * @typedef {Object} OccupancyWindow
 * @property {number} startMinutes
 * @property {number} endMinutes
 * @property {number} bestCaseEndMinutes
 * @property {number} minutes
 * @property {number} bestCaseMinutes
 */

/**
 * Where halftime can fall. Both ends move when halftime is a range.
 *
 * @typedef {Object} HalftimeWindow
 * @property {number} startMinutes
 * @property {number} earliestEndMinutes
 * @property {number} latestEndMinutes
 * @property {number} minMinutes
 * @property {number} maxMinutes
 */

/**
 * The second half, whose start and end are both ranges when halftime is.
 *
 * @typedef {Object} SecondHalfWindow
 * @property {number} earliestStartMinutes
 * @property {number} latestStartMinutes
 * @property {number} earliestEndMinutes
 * @property {number} latestEndMinutes
 */

/**
 * Every window a single kickoff implies.
 *
 * `block` is the **declared** cadence from `game_formats.csv`, measured from
 * kickoff. `schedulable` is the span that actually has to be free: warm-up
 * start through the end of turnover. They are different, and in this corpus the
 * declared block never contains the warm-up — which is precisely why warm-up
 * collisions were invisible (incident 8).
 *
 * @typedef {Object} GameTimingWindows
 * @property {string} status - a `TIMING_STATUS` value
 * @property {TimingFinding[]} findings
 * @property {TimingMeta} meta
 * @property {string} format
 * @property {string|null} date
 * @property {number} kickoffMinutes
 * @property {'known'|'unknown'} footprint
 * @property {number|null} ballInPlayMinutes
 * @property {TimingWindow|null} firstHalf
 * @property {HalftimeWindow|null} halftime
 * @property {SecondHalfWindow|null} secondHalf
 * @property {OccupancyWindow|null} occupancy
 * @property {TimingWindow|null} warmup
 * @property {TimingWindow|null} block
 * @property {TimingWindow|null} schedulable
 */

/**
 * Counters proving a check looked at something.
 *
 * The first five mirror `FacilityMeta` exactly so a facility result can be
 * absorbed without loss; the rest are this module's own. Incident 4 is the
 * reason: a validator that matched zero records once reported a perfect score.
 *
 * @typedef {Object} TimingMeta
 * @property {number} surfacesConsidered
 * @property {number} cellPairsCompared
 * @property {number} overlapPairsConsulted
 * @property {number} equipmentWindowsConsulted
 * @property {number} bookingPairsCompared
 * @property {number} formatsConsidered
 * @property {number} rangesCarried
 * @property {number} reconciliationsPerformed
 * @property {number} windowsComputed
 * @property {number} warmupBookingsBuilt
 * @property {number} candidateKickoffsTested
 */

/**
 * One machine-readable reason. Identical in shape to `FacilityFinding` so the
 * two merge into one list without a translation layer at every call site.
 *
 * @typedef {Object} TimingFinding
 * @property {string} code
 * @property {string} severity
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

/**
 * The result shape shared by every check in this module.
 *
 * @typedef {Object} TimingCheckResult
 * @property {string} status
 * @property {TimingFinding[]} findings
 * @property {TimingMeta} meta
 */

/**
 * A fixture this module can reason about: a kickoff on a surface on a date.
 *
 * `format` is nullable because the corpus has rows whose format has no timing
 * row at all; `warmupMinutes` is nullable because a warm-up requirement is a
 * **policy input**, not a column in `game_formats.csv`. Nothing here defaults
 * it — an unstated warm-up produces a finding, never a guessed 30.
 *
 * @typedef {Object} TimingFixture
 * @property {string} id
 * @property {string} surfaceId
 * @property {string} date - ISO `YYYY-MM-DD`
 * @property {number} kickoffMinutes
 * @property {string|null} format
 * @property {string|null} [label]
 * @property {number|null} [warmupMinutes]
 */

/**
 * The built, deep-frozen format table.
 *
 * @typedef {Object} FormatTimingTable
 * @property {Record<string, FormatTiming>} formats
 * @property {string[]} formatNames
 * @property {Record<string, number>} warmupPolicy
 * @property {string|null} source
 * @property {string} status
 * @property {TimingFinding[]} findings
 * @property {TimingMeta} meta
 * @property {FormatTimingStats} stats
 */

/**
 * Structural counts, so a test can meta-assert the *table* before asserting any
 * behaviour on it. A table with zero ranged formats would make every worst-case
 * test pass trivially.
 *
 * @typedef {Object} FormatTimingStats
 * @property {number} formatCount
 * @property {number} knownFootprintCount
 * @property {number} rangedOccupancyCount
 * @property {number} rangedHalftimeCount
 * @property {number} derivableBallInPlayCount
 * @property {number} reconciledCount
 * @property {number} warmupPolicyCount
 */

export {};
