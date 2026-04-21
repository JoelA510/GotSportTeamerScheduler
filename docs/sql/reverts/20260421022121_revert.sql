-- Revert script for migration 20260421022121_auto_create_profile_on_signup.sql
--
-- USE WITH CAUTION: reverting breaks the onboarding wizard again for any user
-- who signs up after this revert. The backfilled profiles rows are NOT
-- deleted (removing them would orphan any organization_members rows).

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Restore NOT NULL on profiles.email. This will FAIL if any profile row
-- currently has email = NULL (e.g. backfilled phone-auth users). Either
-- populate those rows first or omit this step if phone signups are in use.
ALTER TABLE public.profiles ALTER COLUMN email SET NOT NULL;

-- Note: backfilled public.profiles rows are intentionally NOT removed.
-- Deleting them here would cascade-delete any organization_members /
-- downstream rows that reference them. If a clean slate is truly needed,
-- that must be a separate, operator-gated migration.
