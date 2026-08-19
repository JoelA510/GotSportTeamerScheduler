/**
 * Adapter from what `parseGameFormats()` produces to a format timing table.
 *
 * **Direction of the arrow: fixtures -> timing.** This module takes the
 * already-parsed array and never imports anything from
 * `packages/core/src/fixtures/`. `game_formats.csv` has exactly one parser in
 * this repo and it is not here; re-parsing it would create a second reading of
 * `85-90 (schedule as 90)` free to disagree with the first.
 *
 * @module timing/adapters/season2026Formats
 */

import { buildFormatTimingTable } from '../formatTiming.js';

/**
 * The warm-up length incident 8 is stated in terms of.
 *
 * It is **not** in `game_formats.csv` — that file has no warm-up column — so it
 * is not attached to any format by default. It lives here as a named constant
 * with its provenance attached, quoted from
 * `fixtures/season-2026/README.md`:
 *
 * > On the busiest date the answer to "earliest kickoff with a full 30-minute
 * > warm-up" was 3:25 PM.
 *
 * A caller that wants it must say so, by passing a `warmupPolicy`. That is the
 * difference between a policy an operator chose and a number this module made
 * up.
 */
export const SEASON_2026_INCIDENT_8_WARMUP_MINUTES = 30;

/**
 * Default warm-up policy for the corpus: **empty**.
 *
 * There is no warm-up data in `game_formats.csv`, so the honest default is "no
 * warm-up requirement has been stated", which surfaces as
 * `WARMUP_DURATION_UNSPECIFIED` rather than as a silently applied 30.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const SEASON_2026_WARMUP_POLICY = Object.freeze({});

/**
 * Convert `parseGameFormats()` output into `buildFormatTimingTable()` input.
 *
 * The parser's `raw` source row is dropped: `FormatTimingInputSchema` is
 * `.strict()`, and a whole CSV row riding along inside a domain object is how a
 * "just in case" field becomes a dependency.
 *
 * @param {ReadonlyArray<Object>} formats - `Season2026Format[]`
 * @param {{ warmupPolicy?: Record<string, number>, source?: string|null }} [options]
 * @returns {Object} input for {@link buildFormatTimingTable}
 */
export function toFormatTimingInput(formats, options = {}) {
  return {
    source: options.source ?? 'fixtures/season-2026/game_formats.csv',
    warmupPolicy: { ...SEASON_2026_WARMUP_POLICY, ...(options.warmupPolicy ?? {}) },
    formats: formats.map((format) => ({
      format: format.format,
      program: format.program || null,
      halves: format.halves ?? null,
      halfMinutes: format.halfMinutes ?? null,
      halftimeMinutes: format.halftimeMinutes
        ? { min: format.halftimeMinutes.min, max: format.halftimeMinutes.max }
        : null,
      occupancyMinutes: {
        min: format.occupancyMinutes.min,
        max: format.occupancyMinutes.max,
        // "schedule as 90" is the corpus's own worst-case instruction; the
        // parser already extracted it and it is carried through untouched.
        scheduled: format.occupancyMinutes.scheduled,
        note: format.occupancyMinutes.note ?? null,
      },
      blockMinutes: format.blockMinutes,
      turnoverPreferredMinutes: format.turnoverPreferred?.minutes ?? null,
      turnoverPreferredNote: format.turnoverPreferred?.note ?? null,
      turnoverMinMinutes: format.turnoverMinMinutes ?? null,
    })),
  };
}

/**
 * Build the format timing table straight from `parseGameFormats()` output.
 *
 * @param {ReadonlyArray<Object>} formats - `Season2026Format[]`
 * @param {{ warmupPolicy?: Record<string, number>, source?: string|null }} [options]
 * @returns {import('../types.js').FormatTimingTable}
 */
export function buildFormatTimingTableFromSeason2026(formats, options = {}) {
  return buildFormatTimingTable(toFormatTimingInput(formats, options));
}
