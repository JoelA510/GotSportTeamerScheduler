-- Bug fix: onboarding wizard fails with
--   "insert or update on table organization_members violates foreign key
--    constraint organization_members_profile_id_fkey"
--
-- Root cause: `20251214000004_core_auth.sql:60` explicitly deferred the
-- auth.users → profiles sync ("optional, usually handled by Auth Hook. For
-- now, we assume application logic creates it or an Edge Function trigger.").
-- That assumption was never implemented. New users hit the onboarding wizard
-- with `auth.users.id = X` but no matching `profiles.id = X`. The
-- `initialize_new_tenant()` RPC then tries
--   INSERT INTO organization_members (profile_id, ...) VALUES (auth.uid(), ...);
-- which fails the `profile_id REFERENCES profiles(id)` FK constraint.
--
-- Fix (2 parts):
--
--   1. `public.handle_new_user()` AFTER-INSERT trigger on `auth.users`:
--      auto-creates the matching `profiles` row with the user's email +
--      metadata-derived full_name. SECURITY DEFINER with pinned search_path
--      (advisor-lint §1 compliant). ON CONFLICT DO NOTHING so re-runs are
--      idempotent.
--
--   2. Backfill pass: insert a profiles row for every existing auth.users row
--      that currently lacks one. This closes the bug for users who signed up
--      BEFORE this migration ships.
--
-- The `initialize_new_tenant()` RPC itself is not modified — the trigger
-- guarantees the `profiles` row exists by the time the RPC runs. No behavior
-- change for the happy path; only the currently-broken signup → onboarding
-- flow becomes functional.
--
-- Reversal: docs/sql/reverts/20260421022121_revert.sql.
-- Smoke: docs/sql/tests/20260421022121_smoke.sql.

BEGIN;

-- 1. Trigger function: auto-create profiles row on auth.users INSERT.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. Attach trigger to auth.users. Drop-if-exists in case a partial fix was
--    attempted manually; the AFTER INSERT timing ensures the profiles row is
--    visible to any follow-on transaction (e.g. the onboarding RPC).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3. Backfill: any existing auth.users row without a matching profiles row
--    gets one now. Safe to re-run: the LEFT JOIN + IS NULL guard + ON CONFLICT
--    DO NOTHING together make this idempotent.
INSERT INTO public.profiles (id, email, full_name)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

COMMIT;
