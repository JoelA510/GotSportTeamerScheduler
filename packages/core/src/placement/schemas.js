/**
 * Zod schemas for the placement demonstration harness.
 *
 * `.strict()` throughout, matching the Phase 1 modules. The graph, the timing
 * table, the availability calendar and the constraint registry are *not*
 * described here: they are already-built objects from their own modules, and
 * re-describing them in a fifth schema is exactly the
 * four-copies-of-the-slot-model problem `docs/ARCHITECTURE.md` §1.1 records.
 * They arrive as a separate first argument, which is why this schema can stay
 * strict about the data without tripping over them.
 *
 * The `min(1)` on games, surfaces and kickoffs is not tidiness. A run over zero
 * games would place nothing, reject nothing and report a clean diff — incident
 * 4's "perfect score meaning I looked at nothing" — so it is refused at the door.
 *
 * @module placement/schemas
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

/** One game to be re-placed, with where it was published for the diff. */
export const PlacementGameSchema = z
  .object({
    id: IdSchema,
    format: z.string().min(1).nullable(),
    label: z.string().min(1).nullable().default(null),
    divisionLabel: z.string().min(1).nullable().default(null),
    /** Null when the game has no published position to be compared against. */
    publishedSurfaceId: IdSchema.nullable().default(null),
    publishedKickoffMinutes: MinutesSchema.nullable().default(null),
  })
  .strict();

/**
 * A booking the harness may not move: the Select layer, other formats, anything
 * already agreed. Same shape as `FacilityBookingSchema` and re-parsed by it
 * downstream; declared here only so `.strict()` catches a typo at the door.
 */
export const FixedBookingSchema = z
  .object({
    id: IdSchema,
    surfaceId: IdSchema,
    date: IsoDateSchema,
    startMinutes: MinutesSchema,
    endMinutes: MinutesSchema.nullable(),
    format: z.string().min(1).nullable().default(null),
    label: z.string().min(1).nullable().default(null),
  })
  .strict();

/** Input accepted by `replaceGamesUnderRegistry()`. */
export const PlacementInputSchema = z
  .object({
    date: IsoDateSchema,
    /** The one venue this bounded run covers. Checked against the surfaces. */
    venueId: IdSchema.optional(),
    games: z.array(PlacementGameSchema).min(1, {
      message: 'a placement run over zero games would report a clean result having done nothing',
    }),
    fixedBookings: z.array(FixedBookingSchema).default([]),
    candidateSurfaceIds: z
      .array(IdSchema)
      .min(1, { message: 'a placement run needs at least one candidate surface' }),
    candidateKickoffMinutes: z
      .array(MinutesSchema)
      .min(1, { message: 'a placement run needs at least one candidate kickoff' }),
  })
  .strict();
