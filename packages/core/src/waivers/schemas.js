/**
 * Zod schemas for waiver records.
 *
 * `.strict()` throughout, matching `facility/schemas.js`, `timing/schemas.js`,
 * `availability/schemas.js` and `constraints/schemas.js`, and deliberately
 * unlike `packages/core/src/schemas/index.js`, whose blanket `.passthrough()`
 * is what let four copies of the slot model drift apart without anything
 * failing (`docs/ARCHITECTURE.md` §1.1).
 *
 * The refinements carry most of the model's meaning:
 *
 * - a scope must narrow on **at least one** dimension — a waiver that narrows
 *   on nothing is not an exception, it is a repeal, and it must be written as
 *   one (by retyping or removing the constraint) rather than smuggled in here;
 * - an approval with no date must say why it has no date;
 * - an expiry may not precede the moment the waiver takes effect;
 * - `.strict()` refuses any field the model does not define, which is how a
 *   record carrying a cached `dormant: true` is rejected instead of believed.
 *
 * @module waivers/schemas
 */

import { z } from 'zod';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/**
 * Every field a waiver scope may narrow on, paired with the dimension name it
 * contributes. Exported so the scope matcher and the specificity check cannot
 * drift from the schema.
 *
 * @type {ReadonlyArray<{ field: string, dimension: string }>}
 */
export const WAIVER_SCOPE_FIELDS = Object.freeze([
  { field: 'personId', dimension: 'person' },
  { field: 'teamId', dimension: 'team' },
  { field: 'gameId', dimension: 'game' },
  { field: 'venueIds', dimension: 'venues' },
  { field: 'surfaceId', dimension: 'surface' },
  { field: 'divisionLabel', dimension: 'division' },
  { field: 'date', dimension: 'date' },
  { field: 'fromDate', dimension: 'date-range' },
  { field: 'toDate', dimension: 'date-range' },
]);

/** @see {@link import('./types.js').WaiverScope} */
export const WaiverScopeSchema = z
  .object({
    personId: IdSchema.nullable().default(null),
    teamId: IdSchema.nullable().default(null),
    gameId: IdSchema.nullable().default(null),
    venueIds: z.array(IdSchema).min(1).nullable().default(null),
    surfaceId: IdSchema.nullable().default(null),
    divisionLabel: z.string().min(1).nullable().default(null),
    date: IsoDateSchema.nullable().default(null),
    fromDate: IsoDateSchema.nullable().default(null),
    toDate: IsoDateSchema.nullable().default(null),
    label: z.string().nullable().default(null),
  })
  .strict()
  .superRefine((scope, ctx) => {
    const named = WAIVER_SCOPE_FIELDS.filter(
      ({ field }) => /** @type {Record<string, unknown>} */ (scope)[field] !== null
    );
    if (named.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message:
          'a waiver must narrow on at least one dimension; a waiver that narrows on nothing is a repeal of the constraint, not an exception to it',
        path: ['personId'],
      });
    }
    if (scope.date !== null && (scope.fromDate !== null || scope.toDate !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a waiver scope may name a single date or a range, not both',
        path: ['date'],
      });
    }
    if (scope.fromDate !== null && scope.toDate !== null && scope.fromDate > scope.toDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'a date-range scope must not end before it starts',
        path: ['toDate'],
      });
    }
    if (scope.venueIds !== null && new Set(scope.venueIds).size !== scope.venueIds.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'a waiver must not name the same venue twice',
        path: ['venueIds'],
      });
    }
  });

/** @see {@link import('./types.js').WaiverApproval} */
export const WaiverApprovalSchema = z
  .object({
    approvedBy: z.string().min(1, { message: 'a waiver must name who approved it' }),
    approvedAt: IsoDateSchema.nullable().default(null),
    reference: z.string().min(1, { message: 'a waiver must cite where the decision is recorded' }),
    note: z.string().min(1).nullable().default(null),
  })
  .strict()
  .refine((approval) => approval.approvedAt !== null || approval.note !== null, {
    message: 'an approval with no date must carry a note explaining why the date is unknown',
    path: ['approvedAt'],
  });

/** A parameter value. Flat primitives only — a parameter is data, not a closure. */
const ParameterValueSchema = z.union([z.number(), z.string().min(1), z.boolean(), z.null()]);

/** @see {@link import('./types.js').WaiverRecord} */
export const WaiverRecordSchema = z
  .object({
    id: IdSchema,
    constraintId: IdSchema,
    name: z.string().min(1),
    scope: WaiverScopeSchema,
    reasonCodes: z.array(z.string().min(1)).default([]),
    reason: z.string().min(1, { message: 'a waiver must say why it was granted' }),
    approval: WaiverApprovalSchema,
    effectiveFrom: IsoDateSchema.nullable().default(null),
    effectiveTo: IsoDateSchema.nullable().default(null),
    parameters: z.record(z.string().min(1), ParameterValueSchema).default({}),
  })
  .strict()
  .refine(
    (record) =>
      record.effectiveFrom === null ||
      record.effectiveTo === null ||
      record.effectiveFrom <= record.effectiveTo,
    {
      message: 'a waiver must not expire before it takes effect',
      path: ['effectiveTo'],
    }
  )
  .refine((record) => new Set(record.reasonCodes).size === record.reasonCodes.length, {
    message: 'a waiver must not name the same reason code twice',
    path: ['reasonCodes'],
  });

/** Input accepted by `buildWaiverLedger()`. */
export const WaiverLedgerInputSchema = z
  .object({
    name: z.string().min(1).nullable().default(null),
    source: z.string().min(1).nullable().default(null),
    waivers: z.array(WaiverRecordSchema).default([]),
  })
  .strict();

/** Context accepted by the applier. Every field optional; absent is not a wildcard. */
export const WaiverContextSchema = z
  .object({
    date: IsoDateSchema.optional(),
    personId: IdSchema.optional(),
    personIds: z.array(IdSchema).optional(),
    teamId: IdSchema.optional(),
    teamIds: z.array(IdSchema).optional(),
    gameId: IdSchema.optional(),
    gameIds: z.array(IdSchema).optional(),
    venueId: IdSchema.optional(),
    venueIds: z.array(IdSchema).optional(),
    surfaceId: IdSchema.optional(),
    surfaceLineage: z.array(IdSchema).optional(),
    divisionLabel: z.string().min(1).optional(),
  })
  .strict();

/** One subject handed to `applyWaivers()`. */
export const WaiverSubjectSchema = z
  .object({
    id: IdSchema,
    context: WaiverContextSchema.default({}),
    findings: z
      .array(
        z
          .object({
            code: z.string().min(1),
            severity: z.string().min(1),
            message: z.string(),
            details: z.record(z.string(), z.unknown()).default({}),
          })
          .strict()
      )
      .default([]),
    details: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
