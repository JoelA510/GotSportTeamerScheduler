/**
 * Zod schemas for timing input.
 *
 * `.strict()` throughout, matching `facility/schemas.js` and deliberately
 * unlike `packages/core/src/schemas/index.js`, whose blanket `.passthrough()`
 * is what let four copies of the slot model drift apart without anything
 * failing (`docs/ARCHITECTURE.md` §1.1).
 *
 * @module timing/schemas
 */

import { z } from 'zod';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Minutes past local midnight. */
const MinutesSchema = z.number().int().min(0);

/** @see {@link import('./types.js').MinutesRange} */
export const MinutesRangeSchema = z
  .object({
    min: MinutesSchema,
    max: MinutesSchema,
  })
  .strict()
  .refine((range) => range.min <= range.max, {
    message: 'range min must not exceed max',
    path: ['max'],
  });

/**
 * A range plus the value to schedule against.
 *
 * `scheduled` is required to sit inside `[min, max]`. A "worst case" outside
 * its own range is a producer bug, and accepting it would silently change every
 * margin computed from it.
 *
 * @see {@link import('./types.js').ScheduledMinutesRange}
 */
export const ScheduledMinutesRangeSchema = z
  .object({
    min: MinutesSchema,
    max: MinutesSchema,
    scheduled: MinutesSchema,
    note: z.string().nullable().default(null),
  })
  .strict()
  .refine((range) => range.min <= range.max, {
    message: 'range min must not exceed max',
    path: ['max'],
  })
  .refine((range) => range.scheduled >= range.min && range.scheduled <= range.max, {
    message: 'the scheduled value must fall inside the range it is drawn from',
    path: ['scheduled'],
  });

/** @see {@link import('./types.js').FormatTimingInput} */
export const FormatTimingInputSchema = z
  .object({
    format: IdSchema,
    program: z.string().nullable().default(null),
    /** Null for a format with no halves at all — the corpus's Minis sessions. */
    halves: z.number().int().positive().nullable().default(null),
    halfMinutes: z.number().int().positive().nullable().default(null),
    halftimeMinutes: MinutesRangeSchema.nullable().default(null),
    occupancyMinutes: ScheduledMinutesRangeSchema,
    blockMinutes: z.number().int().positive(),
    turnoverPreferredMinutes: MinutesSchema.nullable().default(null),
    /** The source's own words, e.g. `in block`. Carried for audit. */
    turnoverPreferredNote: z.string().nullable().default(null),
    turnoverMinMinutes: MinutesSchema.nullable().default(null),
  })
  .strict();

/**
 * Input for `buildFormatTimingTable()`.
 *
 * `warmupPolicy` is separate from the formats for a reason: `game_formats.csv`
 * has **no warm-up column**. A warm-up requirement is a policy the operator
 * states, not a fact the corpus contains, and folding it into the format rows
 * would disguise an invention as source data.
 */
export const FormatTimingTableInputSchema = z
  .object({
    formats: z.array(FormatTimingInputSchema),
    warmupPolicy: z.record(IdSchema, MinutesSchema).default({}),
    source: z.string().nullable().default(null),
  })
  .strict();

/** @see {@link import('./types.js').TimingFixture} */
export const TimingFixtureSchema = z
  .object({
    id: IdSchema,
    surfaceId: IdSchema,
    date: IsoDateSchema,
    kickoffMinutes: MinutesSchema,
    /** Null when the row's format is unknown to the table (GAP-14). */
    format: z.string().min(1).nullable(),
    label: z.string().nullable().default(null),
    /** Null means "no warm-up requirement stated"; it is never defaulted. */
    warmupMinutes: MinutesSchema.nullable().default(null),
  })
  .strict();

/** Query accepted by `warmupWindowAvailability()`. */
export const WarmupWindowQuerySchema = z
  .object({
    surfaceId: IdSchema,
    date: IsoDateSchema,
    kickoffMinutes: MinutesSchema,
    format: z.string().min(1).nullable().default(null),
    warmupMinutes: MinutesSchema.nullable().default(null),
    /** Earliest minute of the day the warm-up may occupy ground. */
    dayStartMinutes: MinutesSchema.default(0),
    /** Bookings that belong to the fixture being asked about, so it is not compared with itself. */
    ignoreBookingIds: z.array(IdSchema).default([]),
  })
  .strict();

/** Query accepted by `earliestKickoffWithWarmup()`. */
export const EarliestKickoffQuerySchema = z
  .object({
    surfaceId: IdSchema,
    date: IsoDateSchema,
    format: z.string().min(1).nullable(),
    warmupMinutes: MinutesSchema.nullable().default(null),
    /** Earliest minute a warm-up may start. Defaults to the start of the day. */
    notBeforeMinutes: MinutesSchema.default(0),
    /** Latest minute a kickoff may take. Defaults to the end of the day. */
    notAfterMinutes: MinutesSchema.default(24 * 60),
    ignoreBookingIds: z.array(IdSchema).default([]),
  })
  .strict();
