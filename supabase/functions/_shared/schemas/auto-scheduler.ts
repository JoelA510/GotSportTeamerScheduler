/**
 * Request schema for the auto-scheduler Edge Function. Lives in _shared so a Deno test can
 * validate a request without importing the serving module, and so the team shape is the one
 * `TeamSchema` in ./scoring.ts (Phase 8.1: `assistantCoachIds`, nullable).
 */
import { z } from 'zod';
import { TeamSchema } from './scoring.ts';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const SlotSchema = z
  .object({
    id: z.string(),
    day: z.string().nullable().optional(),
    start: z.string().or(z.date()),
    end: z.string().or(z.date()),
    capacity: z.number().int().min(0),
    baseSlotId: z.string().optional(),
  })
  .passthrough();

const CoachPreferenceSchema = z
  .object({
    preferredDays: z.array(z.string()).optional(),
    preferredSlotIds: z.array(z.string()).optional(),
    unavailableSlotIds: z.array(z.string()).optional(),
  })
  .passthrough();

export const AutoSchedulerInputSchema = z.object({
  organizationId: z.string().uuid(),
  seasonSettingsId: z.string().uuid().optional(),
  teams: z.array(TeamSchema).min(1),
  slots: z.array(SlotSchema).min(1),
  coachPreferences: z.record(z.string(), CoachPreferenceSchema).optional().default({}),
  divisionPreferences: z
    .record(
      z.string(),
      z
        .object({
          preferredDays: z.array(z.string()).optional(),
        })
        .passthrough()
    )
    .optional()
    .default({}),
  lockedAssignments: z
    .array(
      z.object({
        teamId: z.string(),
        slotId: z.string(),
      })
    )
    .optional()
    .default([]),
  scoringWeights: z.record(z.string(), z.number()).optional().default({}),
  schoolDayEnd: z.string().optional(),
  timezone: z.string().optional(),
  config: z
    .object({
      timeBudgetMs: z.number().int().min(1000).max(25000).optional().default(25000),
      maxIterations: z.number().int().min(10).max(5000).optional().default(2000),
      seed: z.number().int().optional().default(42),
    })
    .optional()
    .default({}),
});
