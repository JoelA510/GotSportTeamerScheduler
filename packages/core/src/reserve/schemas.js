/**
 * Zod schemas for reserved slots, bindings, unplaced fixtures and the capacity
 * question.
 *
 * `.strict()` throughout, matching every module since Phase 1. The facility
 * graph, the timing table and the availability calendar are **not** described
 * here: they are already-built objects from their own modules and arrive as a
 * separate `engines` argument, which is why these schemas can stay strict about
 * the data without tripping over them (`placement/schemas.js` §1 records the
 * same decision, and `docs/ARCHITECTURE.md` §1.1 records what happens when a
 * fifth copy of the slot model appears).
 *
 * The `min(1)` on dates and surfaces is not tidiness. A capacity report over
 * zero dates would clear every requirement having examined nothing — incident
 * 4's "perfect score meaning I looked at nothing" — so it is refused at the
 * door, and `capacity.js` refuses a run that generated no slots for the same
 * reason.
 *
 * @module reserve/schemas
 */

import { z } from 'zod';

import { FIXTURE_SIDE, RESERVE_KIND, SLOT_CONDITION_KIND } from './reasonCodes.js';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Minutes past local midnight. */
const MinutesSchema = z.number().int().min(0);

/** The condition under which a slot exists. */
export const SlotConditionSchema = z
  .object({
    kind: z.enum(Object.values(SLOT_CONDITION_KIND)),
    surfaceIds: z
      .array(IdSchema)
      .min(1, { message: 'a surface-idle condition that names no surface is not a condition' }),
    derivedFrom: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

/** One reserved slot. */
export const ReservedSlotSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(Object.values(RESERVE_KIND)),
    label: z.string().min(1),
    date: IsoDateSchema,
    venueId: IdSchema,
    surfaceId: IdSchema,
    startMinutes: MinutesSchema,
    endMinutes: MinutesSchema.nullable().default(null),
    format: z.string().min(1).nullable().default(null),
    divisionLabel: z.string().min(1).nullable().default(null),
    purpose: z.string().min(1).nullable().default(null),
    homeSide: z.enum(Object.values(FIXTURE_SIDE)),
    awaySide: z.enum(Object.values(FIXTURE_SIDE)),
    homeTeamId: IdSchema.nullable().default(null),
    awayTeamId: IdSchema.nullable().default(null),
    homeLabel: z.string().min(1).nullable().default(null),
    awayLabel: z.string().min(1).nullable().default(null),
    condition: SlotConditionSchema.nullable().default(null),
    source: z.string().min(1).nullable().default(null),
  })
  .strict()
  .superRefine((slot, ctx) => {
    // A side that says `team` and carries no id, or carries an id while saying
    // something else, is the exact confusion this enum exists to prevent: the
    // source project spelled every non-team side as the string `-` and could
    // not tell "waiting on the league" from "there is nobody to wait for".
    for (const side of /** @type {const} */ (['home', 'away'])) {
      const kind = slot[`${side}Side`];
      const teamId = slot[`${side}TeamId`];
      if (kind === FIXTURE_SIDE.TEAM && teamId === null) {
        ctx.addIssue({
          code: 'custom',
          path: [`${side}TeamId`],
          message: `${side}Side is "${FIXTURE_SIDE.TEAM}" but no team id is given`,
        });
      }
      if (kind !== FIXTURE_SIDE.TEAM && teamId !== null) {
        ctx.addIssue({
          code: 'custom',
          path: [`${side}TeamId`],
          message: `${side}Side is "${kind}" but a team id is given; only a "${FIXTURE_SIDE.TEAM}" side names a team`,
        });
      }
    }
  });

/** One request to name the teams in a reserved slot. */
export const SlotBindingSchema = z
  .object({
    slotId: IdSchema,
    homeTeamId: IdSchema.nullable().default(null),
    awayTeamId: IdSchema.nullable().default(null),
  })
  .strict()
  .refine((binding) => binding.homeTeamId !== null || binding.awayTeamId !== null, {
    message: 'a binding that names neither side would report success having done nothing',
  });

/** A fixture with no legal slot, kept visible with a reason (incident 10). */
export const UnplacedFixtureSchema = z
  .object({
    fixtureId: IdSchema,
    label: z.string().min(1),
    date: IsoDateSchema.nullable().default(null),
    format: z.string().min(1).nullable().default(null),
    divisionLabel: z.string().min(1).nullable().default(null),
    homeTeamId: IdSchema.nullable().default(null),
    awayTeamId: IdSchema.nullable().default(null),
    homeLabel: z.string().min(1).nullable().default(null),
    awayLabel: z.string().min(1).nullable().default(null),
    reason: z.string().min(1, {
      message:
        'an unplaced fixture with no reason is the category label that made somebody derive the real one by hand',
    }),
    /**
     * Which machinery decided this fixture had nowhere to go — `constraint`,
     * `global-reoptimisation`, `requested`, or null when the source said
     * nothing. Kept as a field rather than inferred from an empty
     * `reasonCodes`, because "no constraint forced this" and "nobody recorded
     * what forced this" are different answers and only one of them is
     * acceptable.
     */
    causeKind: z.string().min(1).nullable().default(null),
    reasonCodes: z.array(z.string().min(1)).default([]),
    constraintIds: z.array(z.string().min(1)).default([]),
    counterpartFixtureIds: z.array(IdSchema).default([]),
    bindingKinds: z.array(z.string().min(1)).default([]),
    slackMinutes: z.number().int().nullable().default(null),
    publishedSurfaceId: IdSchema.nullable().default(null),
    publishedKickoffMinutes: MinutesSchema.nullable().default(null),
    source: z.string().min(1).nullable().default(null),
  })
  .strict();

/** The stated requirement a date's capacity is judged against. */
export const CapacityRequirementSchema = z
  .object({
    slots: z.number().int().min(1, {
      message: 'a requirement of zero slots is met by an empty season and states nothing',
    }),
    label: z.string().min(1),
    source: z.string().min(1),
  })
  .strict();

/** An external cap on how many slots may be reserved. */
export const CapacityCapSchema = z
  .object({
    limit: z.number().int().min(0),
    label: z.string().min(1),
    source: z.string().min(1),
  })
  .strict();

/**
 * Everything `buildReserveCapacityReport()` accepts.
 *
 * `earliestKickoffMinutes` has **no default on purpose**. It is a stated club
 * policy — the first kickoff of a match day — and a silent 08:00 would make
 * every capacity number in this report depend on a constant nobody declared.
 * The season-2026 adapter supplies it with its provenance attached.
 */
export const ReserveCapacityInputSchema = z
  .object({
    name: z.string().min(1).default('reserve capacity'),
    format: z.string().min(1),
    dates: z.array(IsoDateSchema).min(1, {
      message: 'a capacity report over zero dates clears every requirement having examined nothing',
    }),
    surfaceIds: z
      .array(IdSchema)
      .min(1, { message: 'a capacity report over zero surfaces generates no slots' }),
    cadenceMinutes: z.number().int().min(1),
    earliestKickoffMinutes: MinutesSchema,
    latestKickoffMinutes: MinutesSchema.default(24 * 60),
    requirement: CapacityRequirementSchema,
    cap: CapacityCapSchema.nullable().default(null),
    reservedSlots: z.array(z.unknown()).default([]),
    /**
     * What is already standing on the ground, so a conditional slot's condition
     * can be **evaluated** rather than assumed.
     *
     * Required, with no default, and for the same reason
     * `evaluateSlotCondition()` requires it: an empty array is a caller stating
     * that nothing else is booked, and an omitted one is nobody having looked.
     * Defaulting the second to the first would make every conditional slot in a
     * bookings-less run report itself satisfied — a fabricated all-clear on
     * exactly the ground the build plan asks to keep in its own column.
     */
    bookings: z.array(z.unknown()),
  })
  .strict();
