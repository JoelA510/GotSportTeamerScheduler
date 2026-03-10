import { z } from 'zod';

/**
 * Schema for a Team entity.
 */
export const TeamSchema = z.object({
  id: z.any().refine(val => !!val, { message: "each team requires an id" }),
  division: z.any().refine(val => !!val, { message: "team division is required" }),
  organization_id: z.string().uuid().optional(),
}).passthrough();

/**
 * Schema for a Player entity.
 */
export const PlayerSchema = z.object({
  id: z.any().refine(val => !!val, { message: "each player requires an id" }),
  division: z.any().refine(val => !!val, { message: "each player requires a division" }),
  organization_id: z.string().uuid().optional(),
}).passthrough();

/**
 * Schema for a Slot entity.
 */
export const SlotSchema = z.object({
  id: z.any().refine(val => !!val, { message: "each slot requires an id" }),
  capacity: z.number().min(0, { message: "slot capacity must define a non-negative capacity" }),
  organization_id: z.string().uuid().optional(),
  start: z.coerce.date(),
  end: z.coerce.date(),
}).refine(data => data.end > data.start, {
  message: "slot must end after it starts",
  path: ["end"],
}).passthrough();

/**
 * Schema for an Assignment entity.
 */
export const AssignmentSchema = z.object({
  weekIndex: z.number().positive({ message: "assignment.weekIndex must be a positive number" }),
  division: z.any().refine(val => !!val, { message: "assignment.division is required" }),
  slotId: z.any().refine(val => !!val, { message: "assignment.slotId is required" }),
  homeTeamId: z.any().refine(val => !!val, { message: "homeTeamId is required" }),
  awayTeamId: z.any().refine(val => !!val, { message: "awayTeamId is required" }),
  start: z.coerce.date(),
  end: z.coerce.date(),
}).refine(data => data.end > data.start, {
  message: "assignment end time must be after the start time",
  path: ["end"],
}).passthrough();

/**
 * Schema for the Team Persistence Payload.
 */
export const PersistencePayloadSchema = z.object({
  snapshot: z.object({
    payload: z.object({
      teamRows: z.array(z.object({ id: z.string() }).passthrough()),
      teamPlayerRows: z.array(
        z.object({ team_id: z.string(), player_id: z.string() }).passthrough()
      ),
    }),
  }),
  overrides: z.array(z.unknown()).optional(),
  runMetadata: z.record(z.string(), z.unknown()).optional(),
});
