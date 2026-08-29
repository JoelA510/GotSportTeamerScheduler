/**
 * Zod schemas for what this module is asked about.
 *
 * `.strict()` throughout, matching `facility/schemas.js`, `timing/schemas.js`,
 * `availability/schemas.js`, `attribution/schemas.js` and
 * `feasibility/schemas.js`, and deliberately unlike
 * `packages/core/src/schemas/index.js`, whose blanket `.passthrough()` is what
 * let four copies of the slot model drift apart without anything failing
 * (`docs/ARCHITECTURE.md` §1.1).
 *
 * ## Why the fixture itself is parsed here, unlike in `feasibility/schemas.js`
 *
 * 7.1 parses only queries, because the engines it asks them of arrive as
 * already-built objects from the modules that own them. This module has no such
 * owner: a fairness report is computed over a **fixture list**, which reaches it
 * from an adapter, and the whole correctness of the report depends on fields
 * that a loose object is free to omit. `homeSubjectId` absent and
 * `homeSubjectId: null` mean opposite things — "you forgot" and "this fixture
 * genuinely names one side" — and a `.passthrough()` schema cannot tell them
 * apart, which is exactly how a Minis session becomes a team with a 100%
 * hosting record. So every field is required and explicitly nullable where null
 * is a real answer.
 *
 * @module fairness/schemas
 */

import { z } from 'zod';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere (GAP-30). */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Minutes past local midnight. Not capped at 1440: a fixture may run past it. */
const MinutesSchema = z.number().int().min(0);

/**
 * One fixture, as this module needs to see it.
 *
 * `competition` is a plain non-empty string rather than a `z.enum()` of
 * {@link import('./classification.js').FAIRNESS_COMPETITION} on purpose: an
 * unrecognised competition must reach `classifyFairnessFixtures()` and be
 * refused there with a **blocking** `FAIRNESS_FIXTURE_UNCLASSIFIED` naming the
 * value and the count, which is an answer a caller can act on. A schema
 * rejection at the boundary would throw a parse error naming a field path, and
 * the caller would learn that fixture 412 is invalid rather than that this
 * report would have counted 8 tournament games as league games.
 */
export const FairnessFixtureSchema = z
  .object({
    fixtureId: IdSchema,
    /** The season/organisation this fixture belongs to. One report, one scope (GAP-24). */
    scopeId: IdSchema,
    competition: z.string().min(1),
    date: IsoDateSchema,
    /** Null where the fixture carries no time — an unplaced fixture is still a fixture. */
    kickoffMinutes: MinutesSchema.nullable(),
    venueId: IdSchema.nullable(),
    surfaceId: IdSchema.nullable(),
    /** A label, not a key (GAP-24). Null where the source states none. */
    division: z.string().min(1).nullable(),
    /** Null where the division label parses to no age group — `BB` does not. */
    ageGroup: z.string().min(1).nullable(),
    format: z.string().min(1).nullable(),
    /** Null when this side of the fixture names no participant. */
    homeSubjectId: IdSchema.nullable(),
    /** Null when there is no opponent. The single most load-bearing null here. */
    awaySubjectId: IdSchema.nullable(),
  })
  .strict();

/**
 * *"Is anybody in this season being treated unlike their peers?"*
 *
 * `memberSubjectIds` is nullable and defaults to null rather than to `[]`,
 * because those mean opposite things: `null` is "nobody told me who the members
 * are" and `[]` is "there are none". The first is reported as
 * `FAIRNESS_MEMBERSHIP_UNSTATED` and changes no metric; the second would make
 * every participant a guest.
 */
export const FairnessReportQuerySchema = z
  .object({
    fixtures: z.array(FairnessFixtureSchema).min(1, {
      message:
        'a fairness report over zero fixtures is a perfect score meaning "I looked at nothing"',
    }),
    /** Null means unstated. `[]` means "none of these participants are members". */
    memberSubjectIds: z.array(IdSchema).nullable().default(null),
    /** Restrict the report to these metrics. Empty means every declared metric. */
    metricIds: z.array(IdSchema).default([]),
  })
  .strict();

/**
 * The configuration of one objective evaluation.
 *
 * `weight` has no default beyond `1`, and there is deliberately no table of
 * per-objective default weights anywhere in this module: the relative worth of
 * hosting balance against slot rotation is a club's policy decision, and a
 * default would be this module quietly making it.
 */
export const FairnessObjectiveConfigSchema = z
  .object({
    objectiveId: IdSchema,
    weight: z.number().finite().default(1),
    /** Which cohort each subject's penalty is measured within. */
    basisKind: z.string().min(1).default('division'),
  })
  .strict();
