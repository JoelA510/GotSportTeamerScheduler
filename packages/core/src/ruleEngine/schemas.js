/**
 * Zod schemas for rule definitions and the schedule a run judges.
 *
 * `.strict()` throughout, matching `facility/schemas.js`, `timing/schemas.js`,
 * `availability/schemas.js`, `constraints/schemas.js` and `waivers/schemas.js`,
 * and deliberately unlike `packages/core/src/schemas/index.js`, whose blanket
 * `.passthrough()` is what let four copies of the slot model drift apart
 * without anything failing (`docs/ARCHITECTURE.md` §1.1).
 *
 * The refinement that matters most is on {@link RuleExerciseSchema}: a rule
 * whose exercise expectation demands **nothing** is refused. That is the whole
 * design guidance for this prompt in one `superRefine` — *"a rule registered
 * without a declared exercise expectation should be refused at build time"* —
 * and it is enforced here rather than in `engine.js` so that a rule cannot even
 * be constructed in a state the engine would have to work around.
 *
 * @module ruleEngine/schemas
 */

import { z } from 'zod';

import { RULE_IDENTIFIER_KIND } from './reasonCodes.js';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Minutes past midnight. Never a `Date`, never a wall-clock string. */
const MinutesSchema = z.number().int().min(0);

/** Every identifier kind, as a Zod enum. */
const IdentifierKindSchema = z.enum(
  /** @type {[string, ...string[]]} */ (Object.values(RULE_IDENTIFIER_KIND))
);

/** @see {@link import('./types.js').ScheduledGame} */
export const ScheduledGameSchema = z
  .object({
    id: IdSchema,
    date: IsoDateSchema,
    startMinutes: MinutesSchema,
    endMinutes: MinutesSchema.nullable().default(null),
    venueId: IdSchema,
    surfaceId: IdSchema,
    format: z.string().min(1).nullable().default(null),
    divisionLabel: z.string().min(1).nullable().default(null),
    homeTeamId: IdSchema.nullable().default(null),
    awayTeamId: IdSchema.nullable().default(null),
    homeLabel: z.string().default(''),
    awayLabel: z.string().default(''),
    counted: z.boolean().default(true),
  })
  .strict()
  .refine((game) => game.endMinutes === null || game.endMinutes >= game.startMinutes, {
    message: 'a game must not end before it starts',
    path: ['endMinutes'],
  });

/** @see {@link import('./types.js').ScheduledCommitment} */
export const ScheduledCommitmentSchema = z
  .object({
    id: IdSchema,
    personId: IdSchema,
    date: IsoDateSchema,
    startMinutes: MinutesSchema,
    endMinutes: MinutesSchema.nullable().default(null),
    venueId: IdSchema,
    surfaceId: IdSchema.nullable().default(null),
    teamId: IdSchema.nullable().default(null),
    gameId: IdSchema.nullable().default(null),
  })
  .strict();

/**
 * One team, with the people rostered to it.
 *
 * `groupLabel` is the bucket the fairness rule shares a burden across — the age
 * group, for the season-2026 corpus. It is supplied rather than derived because
 * deriving it means parsing a division *label*, and a label is not a key
 * (GAP-24): `16GSelect02` appears under `U16G` and `16GS` in the same corpus.
 * The caller that knows how its own labels are shaped does the parsing; the
 * engine does set arithmetic on the result.
 */
export const ScheduledTeamSchema = z
  .object({
    id: IdSchema,
    divisionLabel: z.string().min(1).nullable().default(null),
    groupLabel: z.string().min(1).nullable().default(null),
    personIds: z.array(IdSchema).default([]),
  })
  .strict();

/**
 * The whole thing a run judges.
 *
 * The universes default to `[]` rather than being derived from `games`, and
 * that is deliberate: a universe derived from the rows it is meant to police
 * cannot police them. If the schedule says the team universe is empty, every
 * team identifier a rule matches is unknown and the run fails loudly, which is
 * the correct answer to "you gave me no way to check".
 *
 * @see {@link import('./types.js').Schedule}
 */
export const ScheduleSchema = z
  .object({
    name: z.string().min(1).nullable().default(null),
    games: z.array(ScheduledGameSchema).default([]),
    commitments: z.array(ScheduledCommitmentSchema).default([]),
    teams: z.array(ScheduledTeamSchema).default([]),
    teamUniverse: z.array(IdSchema).default([]),
    personUniverse: z.array(IdSchema).default([]),
    divisionUniverse: z.array(z.string().min(1)).default([]),
    surfaceUniverse: z.array(IdSchema).default([]),
    venueUniverse: z.array(IdSchema).default([]),
    placeholderLabels: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((schedule, ctx) => {
    for (const [field, values] of [
      ['teamUniverse', schedule.teamUniverse],
      ['personUniverse', schedule.personUniverse],
      ['divisionUniverse', schedule.divisionUniverse],
      ['surfaceUniverse', schedule.surfaceUniverse],
      ['venueUniverse', schedule.venueUniverse],
      ['placeholderLabels', schedule.placeholderLabels],
    ]) {
      const list = /** @type {string[]} */ (values);
      if (new Set(list).size !== list.length) {
        ctx.addIssue({
          code: 'custom',
          message: `${field} must not list the same value twice`,
          path: [/** @type {string} */ (field)],
        });
      }
    }
    const ids = schedule.games.map((game) => game.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'two games claim the same id',
        path: ['games'],
      });
    }
  });

/**
 * A rule's declared exercise expectation.
 *
 * The `superRefine` is the build-time refusal the design guidance asks for. An
 * expectation that demands nothing is not an expectation, and a rule carrying
 * one would pass its own meta-assertion by construction — which is exactly the
 * validator incident 4 is about, only with a schema wrapped round it.
 *
 * @see {@link import('./types.js').RuleExercise}
 */
export const RuleExerciseSchema = z
  .object({
    minimums: z.record(z.string().min(1), z.number().int().min(0)).default({}),
    coverage: z.record(z.string().min(1), IdentifierKindSchema).default({}),
    identifierKinds: z.array(IdentifierKindSchema).default([]),
    rationale: z.string().min(1, {
      message: 'an exercise expectation must say why these are the right numbers to demand',
    }),
  })
  .strict()
  .superRefine((exercise, ctx) => {
    const minimumCount = Object.keys(exercise.minimums).length;
    const coverageCount = Object.keys(exercise.coverage).length;
    if (minimumCount === 0 && coverageCount === 0) {
      ctx.addIssue({
        code: 'custom',
        message:
          'a rule must declare at least one minimum or one coverage expectation; a rule that promises nothing about what it examined cannot be distinguished from a rule that examined nothing (incident 4)',
        path: ['minimums'],
      });
    }
    const positive = Object.values(exercise.minimums).some((value) => value > 0);
    if (minimumCount > 0 && coverageCount === 0 && !positive) {
      ctx.addIssue({
        code: 'custom',
        message:
          'every declared minimum is zero, which every possible run satisfies; declare a floor above zero or a coverage expectation instead',
        path: ['minimums'],
      });
    }
    if (new Set(exercise.identifierKinds).size !== exercise.identifierKinds.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'a rule must not declare the same identifier kind twice',
        path: ['identifierKinds'],
      });
    }
  });

/**
 * One rule definition.
 *
 * `evaluate` is validated as a function and nothing more: it is the only field
 * here that is not data, and the schema's job is to make sure everything around
 * it is.
 *
 * @see {@link import('./types.js').RuleDefinition}
 */
export const RuleDefinitionSchema = z
  .object({
    id: IdSchema,
    title: z.string().min(1),
    constraintIds: z.array(IdSchema).default([]),
    reasonCodes: z.array(z.string().min(1)).default([]),
    /**
     * Which of the rule's constraints each of its codes belongs to, when
     * "all of them" would be wrong.
     *
     * The coach rule enforces two travel constraints and must not let a waiver
     * granted against the inter-venue floor be consulted for a within-venue
     * gap: those are different rules with different numbers, and a waiver that
     * leaked across them would be an exception nobody granted. Optional,
     * because for most rules the honest answer really is "all of them".
     *
     * An **empty** list is meaningful and is the strongest statement here: this
     * code belongs to none of the rule's constraints, so no waiver against any
     * of them may excuse it. `TRAVEL_COMMITMENTS_OVERLAP` is exactly that — a
     * person in two places at once is a fact about physics, and no board
     * signature moves it.
     */
    constraintIdByCode: z.record(z.string().min(1), z.array(IdSchema)).default({}),
    exercise: RuleExerciseSchema,
    rationale: z.string().min(1, { message: 'a rule must say why it exists' }),
    evaluate: z.custom(
      (value) => typeof value === 'function',
      'a rule must carry an evaluate() function'
    ),
  })
  .strict()
  .refine((rule) => new Set(rule.constraintIds).size === rule.constraintIds.length, {
    message: 'a rule must not name the same constraint twice',
    path: ['constraintIds'],
  })
  .refine((rule) => new Set(rule.reasonCodes).size === rule.reasonCodes.length, {
    message: 'a rule must not claim the same reason code twice',
    path: ['reasonCodes'],
  })
  .superRefine((rule, ctx) => {
    for (const [code, ids] of Object.entries(rule.constraintIdByCode)) {
      if (!rule.reasonCodes.includes(code)) {
        ctx.addIssue({
          code: 'custom',
          message: `constraintIdByCode names "${code}", which this rule does not claim`,
          path: ['constraintIdByCode', code],
        });
      }
      for (const id of ids) {
        if (!rule.constraintIds.includes(id)) {
          ctx.addIssue({
            code: 'custom',
            message: `constraintIdByCode maps "${code}" to "${id}", which this rule does not enforce`,
            path: ['constraintIdByCode', code],
          });
        }
      }
    }
  });

/** Input accepted by `buildRuleEngine()`. */
export const RuleEngineInputSchema = z
  .object({
    name: z.string().min(1).nullable().default(null),
    rules: z.array(RuleDefinitionSchema).default([]),
  })
  .strict();
