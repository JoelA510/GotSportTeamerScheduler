# SquadLogic Feature Guardians

Protocol for secure flag lifecycle management, ensuring Zod schema updates and testing for regressions.

## Overview
Status: Production Ready
Frontend: `frontend/src/constants/featureFlags.js`
Integration: `OrganizationContext.jsx`

## Implementation Protocol
When adding a new feature flag:
1. Define the flag key in `FEATURE_FLAGS` object.
2. Update the `FeatureFlagSchema` (Zod) to include the new flag if it's not a generic boolean.
3. Add the flag to the `ALL_FLAGS` whitelist to ensure it's loaded from Supabase.
4. Wrap the target UI with the `<FeatureGuard>` component.

## Best Practices
- **No Magic Strings**: Always use `FEATURE_FLAGS.MY_FLAG` instead of the literal string "my_flag".
- **Fallbacks**: Always provide a sensible `fallback` prop to `<FeatureGuard>`.
- **Deprecation**: When a feature becomes "Standard", remove the `FeatureGuard` wrapper but keep the schema entry until the database is migrated.
- **Rollout**: Always perform a manual toggle test in the Supabase `organizations` table before deploying the code.
