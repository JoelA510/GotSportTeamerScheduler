import { z } from 'zod';

/**
 * Centralized registry of organization-level feature flags.
 * Use these constants throughout the application to ensure consistency
 * and avoid typos when using FeatureGuard or useOrganization context.
 */

export const FEATURE_FLAGS = {
  // Advanced scheduling complexities (Phase 1.2+)
  ADVANCED_FAIRNESS: 'advanced_fairness',
  COACH_OVERLAP_STRICT: 'coach_overlap_strict',
  
  // High-impact UI features (Phase 4)
  SPATIAL_CANVAS: 'spatial_canvas',
  SCHEDULE_MINIMAP: 'schedule_minimap',
  ENTERPRISE_OVERLAYS: 'enterprise_overlays',
  
  // Accessibility & Fallbacks (User Feedback)
  LIST_VIEW_TOGGLE: 'list_view_toggle',
  ACCESSIBILITY_LIST_VIEW: 'accessibility_list_view',
  
  // Management & Automation
  GHOST_ROSTERS: 'ghost_rosters',
  PIM_GUARDRAILS: 'pim_guardrails',
  FUZZY_IMPORT_MAPPING: 'fuzzy_import_mapping',
};

// For development convenience, a list of all known flag names
export const ALL_FLAGS = Object.values(FEATURE_FLAGS);

/**
 * Zod schema for validating the feature_flags JSONB object from Supabase.
 * Each known flag must be a boolean. Unknown flags are ignored during validation.
 */
export const FeatureFlagSchema = z.record(
  z.string(),
  z.boolean()
).transform((flags) => {
  // Option B: Selective Ignore
  // Filter out any entries that aren't in OUR official FEATURE_FLAGS list
  // or that might have somehow bypassed the boolean check (though Zod handles the latter).
  const validated = {};
  Object.keys(flags).forEach((key) => {
    if (ALL_FLAGS.includes(key)) {
      validated[key] = flags[key];
    } else if (process.env.NODE_ENV === 'development') {
      console.warn(`[FeatureFlag] Ignoring an unknown feature flag in database: "${key}"`);
    }
  });
  return validated;
});
