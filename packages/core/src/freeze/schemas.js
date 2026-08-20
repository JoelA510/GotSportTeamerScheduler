/**
 * Zod schemas for freeze matches, rules and plans.
 *
 * `.strict()` throughout, matching `facility/schemas.js`, `timing/schemas.js`,
 * `availability/schemas.js`, `constraints/schemas.js`, `waivers/schemas.js` and
 * `ruleEngine/schemas.js`, and deliberately unlike
 * `packages/core/src/schemas/index.js`, whose blanket `.passthrough()` is what
 * let four copies of the slot model drift apart without anything failing
 * (`docs/ARCHITECTURE.md` §1.1).
 *
 * Two refinements carry the whole design:
 *
 * 1. **{@link FreezeMatchSchema} refuses a match that names nothing.** A match
 *    with every dimension null matches every game. As a `freeze` that is
 *    harmless noise; as a `thaw` it is a global re-optimisation smuggled in
 *    through the exception clause, which is the one thing this module exists to
 *    make impossible by accident. Refused at construction, the way
 *    `RuleExerciseSchema` refuses a rule that promises nothing about what it
 *    examined.
 * 2. **{@link FreezePlanInputSchema} refuses a thawed default without an
 *    acknowledgement.** `defaultDisposition: 'thawed'` requires a non-empty
 *    `reason` and the **literal** `true` — not a truthy value — on
 *    `acknowledged`. "Everything may move" is never something a caller falls
 *    into by leaving a field out.
 *
 * @module freeze/schemas
 */

import { z } from 'zod';

import { FREEZE_DISPOSITION, FREEZE_RULE_KIND } from './reasonCodes.js';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Every dimension of a match, so the refinements can enumerate them once. */
const MATCH_FIELDS = Object.freeze([
  'date',
  'fromDate',
  'toDate',
  'divisionLabel',
  'venueId',
  'surfaceId',
  'format',
  'teamId',
  'gameId',
]);

/** @see {@link import('./types.js').FreezeMatch} */
export const FreezeMatchSchema = z
  .object({
    date: IsoDateSchema.nullable().default(null),
    fromDate: IsoDateSchema.nullable().default(null),
    toDate: IsoDateSchema.nullable().default(null),
    divisionLabel: z.string().min(1).nullable().default(null),
    venueId: IdSchema.nullable().default(null),
    surfaceId: IdSchema.nullable().default(null),
    format: z.string().min(1).nullable().default(null),
    teamId: IdSchema.nullable().default(null),
    gameId: IdSchema.nullable().default(null),
  })
  .strict()
  .superRefine((match, ctx) => {
    const named = MATCH_FIELDS.filter(
      (field) => /** @type {Record<string, unknown>} */ (match)[field] !== null
    );
    if (named.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message:
          'a freeze match must name at least one dimension; a match that names nothing matches every game, which as a thaw is a global re-optimisation wearing an exception’s clothes (incident 1)',
        path: ['date'],
      });
    }
    if (match.date !== null && (match.fromDate !== null || match.toDate !== null)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'a match names a single date or a date range, not both; two statements about the same dimension have no defined specificity',
        path: ['date'],
      });
    }
    if (match.fromDate !== null && match.toDate !== null && match.fromDate > match.toDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'fromDate must not follow toDate',
        path: ['fromDate'],
      });
    }
  });

/** @see {@link import('./types.js').FreezeRule} */
export const FreezeRuleSchema = z
  .object({
    id: IdSchema.nullable().default(null),
    kind: z.enum([FREEZE_RULE_KIND.FREEZE, FREEZE_RULE_KIND.THAW]),
    match: FreezeMatchSchema,
    reason: z.string().min(1).nullable().default(null),
  })
  .strict();

/**
 * The acknowledgement a thawed default requires.
 *
 * `acknowledged` is `z.literal(true)`: `1`, `'yes'` and `{}` are all truthy and
 * none of them is somebody saying yes.
 */
export const GlobalReoptimisationSchema = z
  .object({
    reason: z.string().min(1, {
      message: 'a global re-optimisation must say why every game is allowed to move',
    }),
    acknowledged: z.literal(true, {
      message:
        'a global re-optimisation requires the literal true on `acknowledged`; a truthy value is not an acknowledgement',
    }),
    requestedBy: z.string().min(1).nullable().default(null),
  })
  .strict();

/** Input accepted by `buildFreezePlan()`. */
export const FreezePlanInputSchema = z
  .object({
    name: z.string().min(1).default('freeze plan'),
    defaultDisposition: z
      .enum([FREEZE_DISPOSITION.FROZEN, FREEZE_DISPOSITION.THAWED])
      .default(FREEZE_DISPOSITION.FROZEN),
    rules: z.array(FreezeRuleSchema).default([]),
    globalReoptimisation: GlobalReoptimisationSchema.nullable().default(null),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (
      plan.defaultDisposition === FREEZE_DISPOSITION.THAWED &&
      plan.globalReoptimisation === null
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'a plan whose default is "thawed" lets every game in the season move; it must carry a globalReoptimisation acknowledgement naming a reason. Build it through resolve/reoptimiseWholeSeason(), which is the only construct of a thawed default.',
        path: ['globalReoptimisation'],
      });
    }
    if (
      plan.defaultDisposition === FREEZE_DISPOSITION.FROZEN &&
      plan.globalReoptimisation !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'a plan whose default is "frozen" is not a global re-optimisation and must not carry its acknowledgement; an acknowledgement parsed and unread is how a guardrail is lost',
        path: ['globalReoptimisation'],
      });
    }
  });

/** The dimensions of a match, exported so callers never spell them twice. */
export const FREEZE_MATCH_FIELDS = MATCH_FIELDS;
