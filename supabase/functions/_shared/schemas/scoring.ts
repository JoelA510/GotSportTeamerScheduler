import { z } from 'zod';

/**
 * Reusable Zod schemas for the Scoring Engine (Deno/Edge compatible)
 */

export const TeamSchema = z
  .object({
    id: z.string(),
    division: z.string(),
    coachId: z.string().nullable().optional(),
    organization_id: z.string().uuid().optional(),
  })
  .passthrough();

export const SlotSchema = z
  .object({
    id: z.string(),
    capacity: z.number().min(0),
    start: z.string().or(z.date()),
    end: z.string().or(z.date()),
    day: z.string().nullable().optional(),
    organization_id: z.string().uuid().optional(),
  })
  .passthrough();

export const PracticeAssignmentSchema = z
  .object({
    teamId: z.string(),
    slotId: z.string(),
  })
  .passthrough();

export const GameAssignmentSchema = z
  .object({
    weekIndex: z.number().positive(),
    division: z.string(),
    fieldId: z.string().optional(),
    homeTeamId: z.string(),
    awayTeamId: z.string(),
    start: z.string().or(z.date()),
    end: z.string().or(z.date()),
  })
  .passthrough();

export const ScoringInputSchema = z.object({
  organizationId: z.string().uuid(),
  practice: z
    .object({
      teams: z.array(TeamSchema),
      slots: z.array(SlotSchema),
      assignments: z.array(PracticeAssignmentSchema),
      unassigned: z
        .array(z.object({ teamId: z.string(), reason: z.string() }))
        .nullable()
        .optional()
        .default([]),
    })
    .nullable(),
  games: z
    .object({
      teams: z.array(TeamSchema),
      slots: z.array(SlotSchema),
      games: z.array(GameAssignmentSchema),
    })
    .nullable(),
  persist: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type Team = z.infer<typeof TeamSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type PracticeAssignment = z.infer<typeof PracticeAssignmentSchema>;
export type GameAssignment = z.infer<typeof GameAssignmentSchema>;
export type ScoringInput = z.infer<typeof ScoringInputSchema>;
