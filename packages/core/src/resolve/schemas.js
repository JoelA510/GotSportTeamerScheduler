/**
 * Zod schemas for change requests and pipeline stages.
 *
 * `.strict()` throughout, matching every Phase 1-3 module.
 *
 * The refinement that carries the design is on {@link FreezeContractSchema}: a
 * stage whose freeze contract is **empty** is refused at build time, exactly as
 * `RuleExerciseSchema.superRefine` refuses a rule that promises nothing about
 * what it examined. A stage must say which kinds of write it performs, which
 * adversarial probe proves it honours the freeze, and what it claims about
 * frozen games — and the three have to agree with each other. A stage that
 * declares no mutation kinds must carry the `writes-nothing` probe, and one
 * that declares any must carry `offers-frozen-move`; a stage cannot be
 * registered in a state where its probe would pass without testing anything.
 *
 * @module resolve/schemas
 */

import { z } from 'zod';

import { MOVE_KIND } from './state.js';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Minutes past midnight. Never a `Date`, never a wall-clock string. */
const MinutesSchema = z.number().int().min(0);

/**
 * One requested change.
 *
 * `date` and `surfaceId` default to null, meaning "wherever it is now": the
 * common request is a time change on the ground the game already has.
 */
export const ScheduleChangeRequestSchema = z
  .object({
    gameId: IdSchema,
    date: IsoDateSchema.nullable().default(null),
    surfaceId: IdSchema.nullable().default(null),
    startMinutes: MinutesSchema,
    reason: z.string().min(1).nullable().default(null),
  })
  .strict();

/** The probe kinds a stage can declare. */
export const STAGE_PROBE = Object.freeze({
  /**
   * The stage is offered a frozen game it would want to move. The probe asserts
   * both that nothing frozen moved **and** that `movesRejectedByFreeze` grew.
   * The second half is the teeth: without it the probe passes against a stage
   * that never looked.
   */
  OFFERS_FROZEN_MOVE: 'offers-frozen-move',
  /**
   * The stage writes nothing. The probe asserts it applied no move at all and
   * left every placement identical.
   */
  WRITES_NOTHING: 'writes-nothing',
});

/** @see {@link import('./types.js').FreezeContract} */
export const FreezeContractSchema = z
  .object({
    mutationKinds: z
      .array(z.enum([MOVE_KIND.RELOCATE, MOVE_KIND.DISLODGE, MOVE_KIND.TIME_TBD]))
      .default([]),
    probe: z.enum([STAGE_PROBE.OFFERS_FROZEN_MOVE, STAGE_PROBE.WRITES_NOTHING]),
    claim: z.string().min(1, {
      message:
        'a stage must state what it promises about frozen games; a stage that promises nothing cannot be told apart from one that ignores the freeze (incident 2)',
    }),
  })
  .strict()
  .superRefine((contract, ctx) => {
    if (new Set(contract.mutationKinds).size !== contract.mutationKinds.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'a stage must not declare the same mutation kind twice',
        path: ['mutationKinds'],
      });
    }
    const writes = contract.mutationKinds.length > 0;
    if (writes && contract.probe !== STAGE_PROBE.OFFERS_FROZEN_MOVE) {
      ctx.addIssue({
        code: 'custom',
        message: `a stage that declares mutation kinds must carry the "${STAGE_PROBE.OFFERS_FROZEN_MOVE}" probe; the "${STAGE_PROBE.WRITES_NOTHING}" probe would pass without ever offering it a frozen game`,
        path: ['probe'],
      });
    }
    if (!writes && contract.probe !== STAGE_PROBE.WRITES_NOTHING) {
      ctx.addIssue({
        code: 'custom',
        message: `a stage that declares no mutation kinds must carry the "${STAGE_PROBE.WRITES_NOTHING}" probe; the "${STAGE_PROBE.OFFERS_FROZEN_MOVE}" probe demands a rejection counter it can never produce`,
        path: ['probe'],
      });
    }
  });

/** @see {@link import('./types.js').ResolveStage} */
export const ResolveStageSchema = z
  .object({
    id: IdSchema,
    title: z.string().min(1),
    freezeContract: FreezeContractSchema,
    run: z.custom((value) => typeof value === 'function', 'a stage must carry a run() function'),
  })
  .strict();
