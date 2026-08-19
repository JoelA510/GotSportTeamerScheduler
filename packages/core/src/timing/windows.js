/**
 * Windows: what one kickoff time implies, minute by minute.
 *
 * ```text
 * kickoff       first half        halftime          second half       final whistle
 *    |--------------------------|~~~~~~~~~~~~~~~~|--------------------------|
 *    ^                                                                      ^
 *    occupancy start                                    occupancy end (WORST case)
 *
 * <--warm-up-->|<----------------------- occupancy ---------------------->|<--turnover-->
 * <------------------------------- schedulable ------------------------------------->
 * ```
 *
 * Two rules run through everything here.
 *
 * **Worst case wins.** 11v11 halftime is `5-10`, so its occupancy is `85-90`
 * and the source says "schedule as 90". Every end this module reports as
 * `endMinutes` is the worst case; the best case rides alongside as
 * `bestCaseEndMinutes` and is never substituted for it. Where halftime is a
 * range, the second half's start *and* end are ranges too — that is the shape
 * the flat-90 model erased.
 *
 * **`block` and `schedulable` are different spans.** `block` is the cadence
 * `game_formats.csv` declares, measured from kickoff, and in this corpus it
 * equals occupancy plus turnover with nothing left for warm-up.
 * `schedulable` is what actually has to be free: warm-up start through the end
 * of turnover. `schedulable` is *reported*, not booked — the ground bookings
 * this module produces are occupancy and warm-up only, because turnover is a
 * preference with a floor (GAP-11) and treating a preference as occupied ground
 * would reject legal back-to-back play.
 *
 * @module timing/windows
 */

import { createTimingMeta, formatTimingOrUnknown, warmupMinutesFor } from './formatTiming.js';
import {
  TIMING_REASON,
  TIMING_SEVERITY,
  deriveTimingStatus,
  makeTimingFinding,
} from './reasonCodes.js';

/**
 * Format-level findings worth repeating on a per-kickoff result.
 *
 * Everything blocking or compromising is repeated, because a caller looking at
 * one fixture must not have to go and read the table to learn its footprint is
 * unknown. Of the informational ones only `HALFTIME_IS_RANGE` is repeated: it
 * is the fact that makes `endMinutes` and `bestCaseEndMinutes` differ, so
 * omitting it would leave the two numbers unexplained. The rest
 * (`OCCUPANCY_DERIVATION_AGREES` and friends) are table provenance and would be
 * noise on all 679 rows.
 *
 * @param {import('./types.js').FormatTiming} timing
 * @returns {import('./types.js').TimingFinding[]}
 */
function carriedFormatFindings(timing) {
  return timing.findings.filter(
    (finding) =>
      finding.severity !== TIMING_SEVERITY.INFO || finding.code === TIMING_REASON.HALFTIME_IS_RANGE
  );
}

/**
 * Every window a single kickoff implies.
 *
 * Returns null windows rather than throwing when the format's footprint is
 * unknown, with `FORMAT_TIMING_UNDEFINED` in `findings`. A caller that ignores
 * `findings` gets `null`s and a `compromised` status — never a plausible number.
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {{ format: string|null, kickoffMinutes: number, date?: string|null, warmupMinutes?: number|null, dayStartMinutes?: number }} request
 * @returns {import('./types.js').GameTimingWindows}
 */
export function computeGameWindows(table, request) {
  const {
    format,
    kickoffMinutes,
    date = null,
    warmupMinutes = null,
    dayStartMinutes = 0,
  } = request;

  if (!Number.isInteger(kickoffMinutes) || kickoffMinutes < 0) {
    throw new TypeError(
      `timing: kickoffMinutes must be a non-negative integer, got ${kickoffMinutes}`
    );
  }

  const meta = createTimingMeta();
  const timing = formatTimingOrUnknown(table, format);
  meta.formatsConsidered = 1;
  meta.windowsComputed = 1;

  /** @type {import('./types.js').TimingFinding[]} */
  const findings = [...carriedFormatFindings(timing)];

  const resolvedWarmup = warmupMinutesFor(table, format, warmupMinutes);
  /** @type {import('./types.js').TimingWindow|null} */
  let warmup = null;
  if (resolvedWarmup === null) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.WARMUP_DURATION_UNSPECIFIED,
        `no warm-up length is stated for ${timing.format}; game_formats.csv has no warm-up column and none is assumed`,
        { format: timing.format, kickoffMinutes }
      )
    );
  } else {
    const startMinutes = kickoffMinutes - resolvedWarmup;
    if (startMinutes < dayStartMinutes) {
      findings.push(
        makeTimingFinding(
          TIMING_REASON.WARMUP_STARTS_BEFORE_DAY_START,
          `a ${resolvedWarmup}-minute warm-up before a kickoff at minute ${kickoffMinutes} would start before minute ${dayStartMinutes}`,
          {
            format: timing.format,
            kickoffMinutes,
            warmupMinutes: resolvedWarmup,
            warmupStartMinutes: startMinutes,
            dayStartMinutes,
          }
        )
      );
    }
    warmup = { startMinutes, endMinutes: kickoffMinutes, minutes: resolvedWarmup };
  }

  if (timing.footprint === 'unknown' || timing.occupancyMinutes === null) {
    return {
      status: deriveTimingStatus(findings),
      findings,
      meta,
      format: timing.format,
      date,
      kickoffMinutes,
      footprint: 'unknown',
      ballInPlayMinutes: null,
      firstHalf: null,
      halftime: null,
      secondHalf: null,
      occupancy: null,
      warmup,
      block: null,
      schedulable: null,
    };
  }

  if (timing.occupancyMinutes.min !== timing.occupancyMinutes.max) meta.rangesCarried += 1;
  if (timing.halftimeIsRange) meta.rangesCarried += 1;

  const occupancy = {
    startMinutes: kickoffMinutes,
    endMinutes: kickoffMinutes + timing.occupancyMinutes.scheduled,
    bestCaseEndMinutes: kickoffMinutes + timing.occupancyMinutes.min,
    minutes: timing.occupancyMinutes.scheduled,
    bestCaseMinutes: timing.occupancyMinutes.min,
  };

  /** @type {import('./types.js').TimingWindow|null} */
  let firstHalf = null;
  /** @type {import('./types.js').HalftimeWindow|null} */
  let halftime = null;
  /** @type {import('./types.js').SecondHalfWindow|null} */
  let secondHalf = null;

  if (timing.halfMinutes !== null) {
    firstHalf = {
      startMinutes: kickoffMinutes,
      endMinutes: kickoffMinutes + timing.halfMinutes,
      minutes: timing.halfMinutes,
    };
    if (timing.halftimeMinutes !== null) {
      const breakStart = firstHalf.endMinutes;
      halftime = {
        startMinutes: breakStart,
        earliestEndMinutes: breakStart + timing.halftimeMinutes.min,
        latestEndMinutes: breakStart + timing.halftimeMinutes.max,
        minMinutes: timing.halftimeMinutes.min,
        maxMinutes: timing.halftimeMinutes.max,
      };
      // Only a two-half game decomposes this way. Nothing in the corpus has
      // more, and guessing at a three-period structure would be invention.
      if (timing.halves === 2) {
        secondHalf = {
          earliestStartMinutes: halftime.earliestEndMinutes,
          latestStartMinutes: halftime.latestEndMinutes,
          earliestEndMinutes: halftime.earliestEndMinutes + timing.halfMinutes,
          latestEndMinutes: halftime.latestEndMinutes + timing.halfMinutes,
        };
      }
    }
  }

  const block =
    timing.blockMinutes === null
      ? null
      : {
          startMinutes: kickoffMinutes,
          endMinutes: kickoffMinutes + timing.blockMinutes,
          minutes: timing.blockMinutes,
        };

  const schedulableStart = warmup ? warmup.startMinutes : kickoffMinutes;
  const schedulableEnd = occupancy.endMinutes + (timing.turnoverPreferredMinutes ?? 0);
  const schedulable = {
    startMinutes: schedulableStart,
    endMinutes: schedulableEnd,
    minutes: schedulableEnd - schedulableStart,
  };

  return {
    status: deriveTimingStatus(findings),
    findings,
    meta,
    format: timing.format,
    date,
    kickoffMinutes,
    footprint: 'known',
    ballInPlayMinutes: timing.ballInPlayMinutes,
    firstHalf,
    halftime,
    secondHalf,
    occupancy,
    warmup,
    block,
    schedulable,
  };
}
