/**
 * The format timing table: what one number was hiding.
 *
 * Every format resolves to four spans rather than a duration —
 *
 * ```text
 * ballInPlay   = halves x halfMinutes
 * occupancy    = ballInPlay + halftime            (a RANGE when halftime is)
 * block        = the declared per-field cadence
 * schedulable  = warm-up start -> end of turnover  (computed per kickoff, see windows.js)
 * ```
 *
 * — and the builder **reconciles the derivation against the declaration**
 * instead of trusting either alone. `game_formats.csv` states both
 * `2 x 40 + 5-10` and `85-90`; if those two ever stop agreeing, that is incident
 * 7 happening again and it fires as `OCCUPANCY_DERIVATION_DISAGREES` rather
 * than as several published margins quietly going tight.
 *
 * The table holds **no fixtures and no bookings**. Callers pass their own.
 *
 * @module timing/formatTiming
 */

import { FormatTimingTableInputSchema } from './schemas.js';
import { TIMING_REASON, deriveTimingStatus, makeTimingFinding } from './reasonCodes.js';

/**
 * A zeroed counter block. The first five keys mirror `FacilityMeta` exactly so
 * a facility result can be absorbed without loss.
 *
 * Plumbing, not API: deliberately not re-exported from the barrel, exactly as
 * `facility/facilityGraph.js` keeps `createMeta()` internal.
 *
 * @returns {import('./types.js').TimingMeta}
 */
export function createTimingMeta() {
  return {
    surfacesConsidered: 0,
    cellPairsCompared: 0,
    overlapPairsConsulted: 0,
    equipmentWindowsConsulted: 0,
    bookingPairsCompared: 0,
    formatsConsidered: 0,
    rangesCarried: 0,
    reconciliationsPerformed: 0,
    windowsComputed: 0,
    warmupBookingsBuilt: 0,
    candidateKickoffsTested: 0,
  };
}

/**
 * Add `source`'s counters into `target` in place.
 *
 * @param {import('./types.js').TimingMeta} target
 * @param {import('./types.js').TimingMeta} source
 * @returns {import('./types.js').TimingMeta} `target`
 */
export function mergeTimingMeta(target, source) {
  for (const key of Object.keys(target)) {
    if (typeof source[key] === 'number') target[key] += source[key];
  }
  return target;
}

/**
 * Absorb a `FacilityMeta` into a `TimingMeta`.
 *
 * Only the five shared counters move; the timing-only counters are this
 * module's own and a facility result has nothing to say about them.
 *
 * @param {import('./types.js').TimingMeta} target
 * @param {import('../facility/types.js').FacilityMeta} source
 * @returns {import('./types.js').TimingMeta} `target`
 */
export function absorbFacilityMeta(target, source) {
  target.surfacesConsidered += source.surfacesConsidered;
  target.cellPairsCompared += source.cellPairsCompared;
  target.overlapPairsConsulted += source.overlapPairsConsulted;
  target.equipmentWindowsConsulted += source.equipmentWindowsConsulted;
  target.bookingPairsCompared += source.bookingPairsCompared;
  return target;
}

/**
 * Recursively freeze a value, so no consumer can turn the table into hidden
 * shared state.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
}

/**
 * The record handed back for a format with no timing definition.
 *
 * Every span is `null` and `footprint` is `'unknown'`. There is deliberately no
 * "sensible default": `Scrimmage` occupies a real field for an unknown time
 * (GAP-14), and a guessed 90 minutes would be indistinguishable from a measured
 * one at every downstream call site.
 *
 * @param {string} formatName
 * @returns {import('./types.js').FormatTiming}
 */
export function unknownFormatTiming(formatName) {
  return deepFreeze({
    format: formatName,
    program: null,
    footprint: /** @type {'unknown'} */ ('unknown'),
    halves: null,
    halfMinutes: null,
    halftimeMinutes: null,
    halftimeIsRange: false,
    ballInPlayMinutes: null,
    occupancyMinutes: null,
    derivedOccupancyMinutes: null,
    blockMinutes: null,
    turnoverPreferredMinutes: null,
    turnoverMinMinutes: null,
    turnoverInsideBlock: false,
    blockSlackMinutes: null,
    warmupInsideBlock: false,
    warmupMinutes: null,
    findings: [
      makeTimingFinding(
        TIMING_REASON.FORMAT_TIMING_UNDEFINED,
        `format "${formatName}" has no timing definition, so its field footprint is unknown`,
        { format: formatName }
      ),
    ],
  });
}

/**
 * Resolve one input row into a `FormatTiming`, reconciling as it goes.
 *
 * @param {Object} row - already parsed by `FormatTimingInputSchema`
 * @param {number|null} warmupMinutes
 * @returns {import('./types.js').FormatTiming}
 */
function resolveFormat(row, warmupMinutes) {
  /** @type {import('./types.js').TimingFinding[]} */
  const findings = [];

  const halftime = row.halftimeMinutes;
  const halftimeIsRange = halftime !== null && halftime.min !== halftime.max;
  const ballInPlayMinutes =
    row.halves !== null && row.halfMinutes !== null ? row.halves * row.halfMinutes : null;

  if (halftime === null) {
    findings.push(
      makeTimingFinding(TIMING_REASON.HALFTIME_UNDECLARED, `${row.format} declares no halftime`, {
        format: row.format,
      })
    );
  } else if (halftimeIsRange) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.HALFTIME_IS_RANGE,
        `${row.format} halftime is ${halftime.min}-${halftime.max} min; margins use the worst case (${halftime.max})`,
        {
          format: row.format,
          halftimeMinMinutes: halftime.min,
          halftimeMaxMinutes: halftime.max,
        }
      )
    );
  }

  /** @type {import('./types.js').MinutesRange|null} */
  let derivedOccupancyMinutes = null;
  if (ballInPlayMinutes === null) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.PLAY_TIME_UNDERIVABLE,
        `${row.format} declares no halves, so ball-in-play time cannot be derived; occupancy is taken as declared`,
        { format: row.format, occupancyScheduledMinutes: row.occupancyMinutes.scheduled }
      )
    );
  } else {
    derivedOccupancyMinutes = {
      min: ballInPlayMinutes + (halftime?.min ?? 0),
      max: ballInPlayMinutes + (halftime?.max ?? 0),
    };
    const agrees =
      derivedOccupancyMinutes.min === row.occupancyMinutes.min &&
      derivedOccupancyMinutes.max === row.occupancyMinutes.max;
    findings.push(
      agrees
        ? makeTimingFinding(
            TIMING_REASON.OCCUPANCY_DERIVATION_AGREES,
            `${row.format}: ${row.halves}x${row.halfMinutes} + halftime = ${derivedOccupancyMinutes.min}-${derivedOccupancyMinutes.max}, matching the declared occupancy`,
            {
              format: row.format,
              ballInPlayMinutes,
              derivedMinMinutes: derivedOccupancyMinutes.min,
              derivedMaxMinutes: derivedOccupancyMinutes.max,
              declaredMinMinutes: row.occupancyMinutes.min,
              declaredMaxMinutes: row.occupancyMinutes.max,
            }
          )
        : makeTimingFinding(
            TIMING_REASON.OCCUPANCY_DERIVATION_DISAGREES,
            `${row.format}: ${row.halves}x${row.halfMinutes} + halftime = ${derivedOccupancyMinutes.min}-${derivedOccupancyMinutes.max}, but the declared occupancy is ${row.occupancyMinutes.min}-${row.occupancyMinutes.max}`,
            {
              format: row.format,
              ballInPlayMinutes,
              derivedMinMinutes: derivedOccupancyMinutes.min,
              derivedMaxMinutes: derivedOccupancyMinutes.max,
              declaredMinMinutes: row.occupancyMinutes.min,
              declaredMaxMinutes: row.occupancyMinutes.max,
            }
          )
    );
  }

  const blockSlackMinutes = row.blockMinutes - row.occupancyMinutes.scheduled;
  if (blockSlackMinutes < 0) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.BLOCK_SHORTER_THAN_OCCUPANCY,
        `${row.format} declares a ${row.blockMinutes}-minute block that cannot hold its own ${row.occupancyMinutes.scheduled}-minute occupancy`,
        {
          format: row.format,
          blockMinutes: row.blockMinutes,
          occupancyScheduledMinutes: row.occupancyMinutes.scheduled,
        }
      )
    );
  }

  const turnoverInsideBlock = /in block/i.test(row.turnoverPreferredNote ?? '');
  if (turnoverInsideBlock) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.TURNOVER_INSIDE_BLOCK,
        `${row.format}: the source states the preferred turnover is already counted inside the block`,
        {
          format: row.format,
          turnoverPreferredMinutes: row.turnoverPreferredMinutes,
          note: row.turnoverPreferredNote,
        }
      )
    );
  }
  if (row.turnoverMinMinutes === null) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.TURNOVER_FLOOR_UNDECLARED,
        `${row.format} declares no turnover floor`,
        { format: row.format }
      )
    );
  }

  // Does the declared block leave any room beyond the turnover? In this corpus
  // it never does, which is the whole reason a warm-up could collide with a
  // live game while every published block looked legal.
  let warmupInsideBlock = false;
  if (row.turnoverPreferredMinutes !== null) {
    warmupInsideBlock = blockSlackMinutes > row.turnoverPreferredMinutes;
    if (!warmupInsideBlock) {
      findings.push(
        makeTimingFinding(
          TIMING_REASON.BLOCK_EXCLUDES_WARMUP,
          `${row.format}: the ${row.blockMinutes}-minute block covers occupancy (${row.occupancyMinutes.scheduled}) and turnover (${row.turnoverPreferredMinutes}) with nothing left for warm-up`,
          {
            format: row.format,
            blockMinutes: row.blockMinutes,
            occupancyScheduledMinutes: row.occupancyMinutes.scheduled,
            turnoverPreferredMinutes: row.turnoverPreferredMinutes,
            blockSlackMinutes,
          }
        )
      );
    }
  }

  return {
    format: row.format,
    program: row.program,
    footprint: /** @type {'known'} */ ('known'),
    halves: row.halves,
    halfMinutes: row.halfMinutes,
    halftimeMinutes: halftime === null ? null : { min: halftime.min, max: halftime.max },
    halftimeIsRange,
    ballInPlayMinutes,
    occupancyMinutes: { ...row.occupancyMinutes },
    derivedOccupancyMinutes,
    blockMinutes: row.blockMinutes,
    turnoverPreferredMinutes: row.turnoverPreferredMinutes,
    turnoverMinMinutes: row.turnoverMinMinutes,
    turnoverInsideBlock,
    blockSlackMinutes,
    warmupInsideBlock,
    warmupMinutes,
    findings,
  };
}

/**
 * Build an immutable format timing table from plain data.
 *
 * Takes what `parseGameFormats()` produces (via
 * `adapters/season2026Formats.js`) rather than re-reading the CSV: there is one
 * parser for `game_formats.csv` in this repo and it lives in `fixtures/`.
 *
 * @param {Object} input - see `FormatTimingTableInputSchema`
 * @returns {import('./types.js').FormatTimingTable}
 */
export function buildFormatTimingTable(input) {
  const parsed = FormatTimingTableInputSchema.parse(input);
  const meta = createTimingMeta();

  /** @type {Record<string, import('./types.js').FormatTiming>} */
  const formats = {};
  /** @type {import('./types.js').TimingFinding[]} */
  const findings = [];

  for (const row of parsed.formats) {
    meta.formatsConsidered += 1;
    if (formats[row.format]) {
      findings.push(
        makeTimingFinding(
          TIMING_REASON.FORMAT_TIMING_DUPLICATE,
          `two timing rows claim format "${row.format}"`,
          { format: row.format }
        )
      );
      continue;
    }
    const resolved = resolveFormat(row, parsed.warmupPolicy[row.format] ?? null);
    meta.reconciliationsPerformed += 1;
    if (
      resolved.occupancyMinutes &&
      resolved.occupancyMinutes.min !== resolved.occupancyMinutes.max
    ) {
      meta.rangesCarried += 1;
    }
    if (resolved.halftimeIsRange) meta.rangesCarried += 1;
    formats[row.format] = resolved;
    findings.push(...resolved.findings);
  }

  const formatNames = Object.keys(formats).sort();
  const table = {
    formats,
    formatNames,
    warmupPolicy: { ...parsed.warmupPolicy },
    source: parsed.source,
    status: deriveTimingStatus(findings),
    findings,
    meta,
    stats: {
      formatCount: formatNames.length,
      knownFootprintCount: formatNames.filter((name) => formats[name].footprint === 'known').length,
      rangedOccupancyCount: formatNames.filter(
        (name) =>
          formats[name].occupancyMinutes !== null &&
          formats[name].occupancyMinutes.min !== formats[name].occupancyMinutes.max
      ).length,
      rangedHalftimeCount: formatNames.filter((name) => formats[name].halftimeIsRange).length,
      derivableBallInPlayCount: formatNames.filter(
        (name) => formats[name].ballInPlayMinutes !== null
      ).length,
      reconciledCount: formatNames.filter((name) => formats[name].derivedOccupancyMinutes !== null)
        .length,
      warmupPolicyCount: Object.keys(parsed.warmupPolicy).length,
    },
  };

  return deepFreeze(/** @type {import('./types.js').FormatTimingTable} */ (table));
}

/**
 * Look a format up, or `null`.
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {string|null} formatName
 * @returns {import('./types.js').FormatTiming|null}
 */
export function getFormatTiming(table, formatName) {
  if (formatName === null || formatName === undefined) return null;
  return table.formats[formatName] ?? null;
}

/**
 * Look a format up, or throw. Use where a missing format is a programming
 * error rather than data.
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {string} formatName
 * @returns {import('./types.js').FormatTiming}
 */
export function requireFormatTiming(table, formatName) {
  const timing = getFormatTiming(table, formatName);
  if (!timing) throw new Error(`timing: unknown format "${formatName}"`);
  return timing;
}

/**
 * Look a format up, falling back to an explicit **unknown footprint** record.
 *
 * This is the function every scheduling path should use. It never throws and
 * never invents: a format the table has never heard of comes back carrying
 * `FORMAT_TIMING_UNDEFINED`, so the caller is forced to notice rather than
 * receiving a plausible-looking number.
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {string|null} formatName
 * @returns {import('./types.js').FormatTiming}
 */
export function formatTimingOrUnknown(table, formatName) {
  return getFormatTiming(table, formatName) ?? unknownFormatTiming(formatName ?? '(no format)');
}

/**
 * Is this format's field footprint known?
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {string|null} formatName
 * @returns {boolean}
 */
export function hasKnownFootprint(table, formatName) {
  return getFormatTiming(table, formatName) !== null;
}

/**
 * The warm-up requirement for a format, in minutes.
 *
 * Resolution order is explicit-override, then table policy, then `null`.
 * `null` means "nobody has stated one" and is *not* interchangeable with `0`:
 * zero is a decision, null is an absence, and only the absence produces
 * `WARMUP_DURATION_UNSPECIFIED`.
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {string|null} formatName
 * @param {number|null} [override]
 * @returns {number|null}
 */
export function warmupMinutesFor(table, formatName, override = null) {
  if (override !== null && override !== undefined) return override;
  const timing = getFormatTiming(table, formatName);
  return timing?.warmupMinutes ?? null;
}

/**
 * Worst-case and best-case occupancy end for a kickoff.
 *
 * Returns `null` when the footprint is unknown — never a fabricated end.
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {string|null} formatName
 * @param {number} kickoffMinutes
 * @returns {{ endMinutes: number, bestCaseEndMinutes: number }|null}
 */
export function occupancyEndMinutes(table, formatName, kickoffMinutes) {
  const timing = getFormatTiming(table, formatName);
  if (!timing || timing.occupancyMinutes === null) return null;
  return {
    endMinutes: kickoffMinutes + timing.occupancyMinutes.scheduled,
    bestCaseEndMinutes: kickoffMinutes + timing.occupancyMinutes.min,
  };
}
