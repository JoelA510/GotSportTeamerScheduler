/**
 * Zod schemas for constraint records.
 *
 * `.strict()` throughout, matching `facility/schemas.js`, `timing/schemas.js`
 * and `availability/schemas.js`, and deliberately unlike
 * `packages/core/src/schemas/index.js`, whose blanket `.passthrough()` is what
 * let four copies of the slot model drift apart without anything failing
 * (`docs/ARCHITECTURE.md` §1.1).
 *
 * The refinements here carry most of the model's meaning, so they are worth
 * reading as documentation:
 *
 * - a scope names **exactly one** dimension, and nothing else;
 * - a `hard` constraint carries no weight, a `soft` or `preference` one must;
 * - a record that claims to be wired must claim at least one reason code, and a
 *   `declared-only` one must claim none — the two states are exclusive, so a
 *   half-wired record cannot pretend to govern something it does not;
 * - a source with no date must say why it has no date.
 *
 * @module constraints/schemas
 */

import { z } from 'zod';

import { CONSTRAINT_ENFORCEMENT, CONSTRAINT_SCOPE_KIND, CONSTRAINT_TYPE } from './reasonCodes.js';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Which scope field each kind requires. Every other id field must stay null. */
const SCOPE_FIELD_BY_KIND = Object.freeze({
  [CONSTRAINT_SCOPE_KIND.GLOBAL]: [],
  [CONSTRAINT_SCOPE_KIND.DATE]: ['date'],
  [CONSTRAINT_SCOPE_KIND.DATE_RANGE]: ['fromDate', 'toDate'],
  [CONSTRAINT_SCOPE_KIND.VENUE]: ['venueId'],
  [CONSTRAINT_SCOPE_KIND.SURFACE]: ['surfaceId'],
  [CONSTRAINT_SCOPE_KIND.DIVISION]: ['divisionLabel'],
  [CONSTRAINT_SCOPE_KIND.TEAM]: ['teamId'],
  [CONSTRAINT_SCOPE_KIND.PERSON]: ['personId'],
});

/** Every field a scope may narrow on, in a stable order. */
const SCOPE_FIELDS = Object.freeze([
  'venueId',
  'surfaceId',
  'divisionLabel',
  'teamId',
  'personId',
  'date',
  'fromDate',
  'toDate',
]);

/** @see {@link import('./types.js').ConstraintScope} */
export const ConstraintScopeSchema = z
  .object({
    kind: z.enum(/** @type {[string, ...string[]]} */ (Object.values(CONSTRAINT_SCOPE_KIND))),
    venueId: IdSchema.nullable().default(null),
    surfaceId: IdSchema.nullable().default(null),
    divisionLabel: z.string().min(1).nullable().default(null),
    teamId: IdSchema.nullable().default(null),
    personId: IdSchema.nullable().default(null),
    date: IsoDateSchema.nullable().default(null),
    fromDate: IsoDateSchema.nullable().default(null),
    toDate: IsoDateSchema.nullable().default(null),
    label: z.string().nullable().default(null),
  })
  .strict()
  .superRefine((scope, ctx) => {
    const required = SCOPE_FIELD_BY_KIND[scope.kind] ?? [];
    for (const field of required) {
      if (scope[field] === null) {
        ctx.addIssue({
          code: 'custom',
          message: `a ${scope.kind}-scoped constraint must carry ${field}`,
          path: [field],
        });
      }
    }
    for (const field of SCOPE_FIELDS) {
      if (required.includes(field)) continue;
      if (scope[field] !== null) {
        ctx.addIssue({
          code: 'custom',
          message: `a ${scope.kind}-scoped constraint must not carry ${field}; a scope narrows on exactly one dimension`,
          path: [field],
        });
      }
    }
    if (scope.fromDate !== null && scope.toDate !== null && scope.fromDate > scope.toDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'a date-range scope must not end before it starts',
        path: ['toDate'],
      });
    }
  });

/** @see {@link import('./types.js').ConstraintSource} */
export const ConstraintSourceSchema = z
  .object({
    setBy: z.string().min(1, { message: 'a constraint must say who set it' }),
    setAt: IsoDateSchema.nullable().default(null),
    reference: z.string().min(1, { message: 'a constraint must cite where it came from' }),
    note: z.string().min(1).nullable().default(null),
  })
  .strict()
  .refine((source) => source.setAt !== null || source.note !== null, {
    message: 'a source with no date must carry a note explaining why the date is unknown',
    path: ['setAt'],
  });

/** @see {@link import('./types.js').ConstraintTypeChange} */
export const ConstraintTypeChangeSchema = z
  .object({
    from: z
      .enum(/** @type {[string, ...string[]]} */ (Object.values(CONSTRAINT_TYPE)))
      .nullable()
      .default(null),
    to: z.enum(/** @type {[string, ...string[]]} */ (Object.values(CONSTRAINT_TYPE))),
    at: IsoDateSchema.nullable().default(null),
    by: z.string().min(1),
    note: z.string().min(1, { message: 'a type change must say why it changed' }),
  })
  .strict();

/** A parameter value. Flat primitives only — a parameter is data, not a closure. */
const ParameterValueSchema = z.union([z.number(), z.string().min(1), z.boolean(), z.null()]);

/** @see {@link import('./types.js').ConstraintRecord} */
export const ConstraintRecordSchema = z
  .object({
    id: IdSchema,
    policy: IdSchema,
    name: z.string().min(1),
    type: z.enum(/** @type {[string, ...string[]]} */ (Object.values(CONSTRAINT_TYPE))),
    scope: ConstraintScopeSchema,
    parameters: z.record(z.string().min(1), ParameterValueSchema).default({}),
    restrictiveDirection: z.enum(['higher', 'lower', 'none']).default('higher'),
    rationale: z.string().min(1, { message: 'a constraint must say why it exists' }),
    source: ConstraintSourceSchema,
    effectiveFrom: IsoDateSchema.nullable().default(null),
    effectiveTo: IsoDateSchema.nullable().default(null),
    enforcement: z.enum(
      /** @type {[string, ...string[]]} */ (Object.values(CONSTRAINT_ENFORCEMENT))
    ),
    reasonCodes: z.array(z.string().min(1)).default([]),
    weight: z.number().nullable().default(null),
    waivable: z.boolean().default(false),
    history: z.array(ConstraintTypeChangeSchema).default([]),
  })
  .strict()
  .refine(
    (record) =>
      record.effectiveFrom === null ||
      record.effectiveTo === null ||
      record.effectiveFrom <= record.effectiveTo,
    {
      message: 'a constraint must not expire before it takes effect',
      path: ['effectiveTo'],
    }
  )
  .refine(
    (record) =>
      record.enforcement === CONSTRAINT_ENFORCEMENT.REASON_CODES
        ? record.reasonCodes.length > 0
        : record.reasonCodes.length === 0,
    {
      message:
        'a reason-codes constraint must claim at least one code, and a declared-only one must claim none',
      path: ['reasonCodes'],
    }
  )
  .refine(
    (record) =>
      record.type === CONSTRAINT_TYPE.HARD ? record.weight === null : record.weight !== null,
    {
      message:
        'a hard constraint carries no weight (it is never traded off); a soft or preference constraint must state one',
      path: ['weight'],
    }
  )
  .refine((record) => new Set(record.reasonCodes).size === record.reasonCodes.length, {
    message: 'a constraint must not claim the same reason code twice',
    path: ['reasonCodes'],
  });

/** Input accepted by `buildConstraintRegistry()`. */
export const ConstraintRegistryInputSchema = z
  .object({
    name: z.string().min(1).nullable().default(null),
    source: z.string().min(1).nullable().default(null),
    constraints: z.array(ConstraintRecordSchema).default([]),
  })
  .strict();

/** Context accepted by every resolver. Every field optional; absent is not a wildcard. */
export const ScopeContextSchema = z
  .object({
    date: IsoDateSchema.optional(),
    venueId: IdSchema.optional(),
    surfaceId: IdSchema.optional(),
    surfaceLineage: z.array(IdSchema).optional(),
    divisionLabel: z.string().min(1).optional(),
    teamId: IdSchema.optional(),
    teamIds: z.array(IdSchema).optional(),
    personId: IdSchema.optional(),
    personIds: z.array(IdSchema).optional(),
  })
  .strict();
