/**
 * Zod schemas for the questions this module answers.
 *
 * `.strict()` throughout, matching `facility/schemas.js`, `timing/schemas.js`
 * and `availability/schemas.js`, and deliberately unlike
 * `packages/core/src/schemas/index.js`, whose blanket `.passthrough()` is what
 * let four copies of the slot model drift apart without anything failing
 * (`docs/ARCHITECTURE.md` §1.1).
 *
 * Only **queries** are parsed here. The engines a question is asked against —
 * the facility graph, the timing table, the calendar, the registry, a rule-engine
 * run — arrive as already-built objects from the modules that own them, exactly
 * as they do in `resolve/legality.js`; re-parsing them here would be a second
 * validation of a shape somebody else's schema already guarantees.
 *
 * @module attribution/schemas
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

/** A slot, in the same three fields `resolve/types.js` uses. */
const SlotSchema = z
  .object({
    date: IsoDateSchema,
    surfaceId: IdSchema,
    startMinutes: MinutesSchema,
  })
  .strict();

/** Query accepted by `explainGame()`. */
export const GameAttributionQuerySchema = z
  .object({
    gameId: IdSchema,
  })
  .strict();

/**
 * Query accepted by `explainKickoffTime()` — *"why is this game at 12:00 and
 * not 12:30?"*
 *
 * The alternative is stated in full rather than as a minute offset: the
 * externally-published fixture that motivates this question arrived with a
 * surface as well as a time, and an alternative that could only move the clock
 * would be unable to express it.
 */
export const AlternativeTimeQuerySchema = z
  .object({
    gameId: IdSchema,
    /** The kickoff being asked about instead. */
    insteadOfMinutes: MinutesSchema,
    /** Defaults to the surface the game already stands on. */
    insteadOfSurfaceId: IdSchema.nullable().default(null),
    /** Defaults to the date the game already stands on. */
    insteadOfDate: IsoDateSchema.nullable().default(null),
  })
  .strict();

/** Query accepted by `explainLatestKickoff()` — *"why can't this game go later?"* */
export const LatestKickoffQuestionSchema = z
  .object({
    gameId: IdSchema,
    /** Latest kickoff to consider. Defaults to the end of the day. */
    notAfterMinutes: MinutesSchema.default(24 * 60),
  })
  .strict();

/**
 * Query accepted by `explainEarliestKickoff()` — *"what's the earliest kickoff
 * allowing a full 30-minute warm-up?"*
 *
 * `warmupMinutes` is nullable and never defaulted, for the reason
 * `timing/schemas.js` states: a warm-up requirement is a policy the operator
 * states, not a fact any corpus contains, and a silently applied 30 would
 * disguise an invention as data.
 */
export const EarliestKickoffQuestionSchema = z
  .object({
    surfaceId: IdSchema,
    date: IsoDateSchema,
    format: z.string().min(1).nullable(),
    warmupMinutes: MinutesSchema.nullable().default(null),
    notBeforeMinutes: MinutesSchema.default(0),
    notAfterMinutes: MinutesSchema.default(24 * 60),
    /** The fixture being placed, so it is not compared with itself. */
    ignoreGameIds: z.array(IdSchema).default([]),
  })
  .strict();

/** Query accepted by `explainTeamConflict()` — *"why did this team get a conflict?"* */
export const TeamConflictQuerySchema = z
  .object({
    teamId: IdSchema,
    /** Narrow to one date. Null means every date the run holds. */
    date: IsoDateSchema.nullable().default(null),
  })
  .strict();

/** Query accepted by `minimalBlockingSet()`. */
export const MinimalBlockingSetQuerySchema = z
  .object({
    gameId: IdSchema,
    /** Defaults to the slot the game already stands on. */
    slot: SlotSchema.nullable().default(null),
  })
  .strict();
