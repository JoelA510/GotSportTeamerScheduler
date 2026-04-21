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
-- Fix (3 parts, incorporates Gemini PR #176 review):
--
--   1. Drop NOT NULL on `public.profiles.email`. Supabase supports phone and
--      certain social-provider signups where `auth.users.email` is NULL; the
--      original `NOT NULL` would fail both the trigger AND the backfill for
--      those users, blocking signup entirely. Existing rows keep their values.
--
--   2. `public.handle_new_user()` INSERT-OR-UPDATE trigger on `auth.users`:
--      auto-creates (or refreshes) the matching `profiles` row with the user's
--      email + metadata-derived full_name. SECURITY DEFINER with pinned
--      search_path (advisor-lint §1 compliant). `ON CONFLICT (id) DO UPDATE`
--      keeps `public.profiles` in sync when the user later changes their
--      email or name in Supabase Auth. Trigger fires on INSERT OR UPDATE OF
--      the mirrored columns only (not every UPDATE — narrower trigger is
--      cheaper and avoids needless `updated_at` churn).
--
--   3. Backfill pass: insert a profiles row for every existing auth.users row
--      that currently lacks one. Uses `ON CONFLICT DO NOTHING` here (not DO
--      UPDATE) to preserve any manually-curated existing profile data.
--
-- The `initialize_new_tenant()` RPC itself is not modified — the trigger
-- guarantees the `profiles` row exists by the time the RPC runs. No behavior
-- change for the happy path; only the currently-broken signup → onboarding
-- flow becomes functional.
--
-- Reversal: docs/sql/reverts/20260421022121_revert.sql.
-- Smoke: docs/sql/tests/20260421022121_smoke.sql.

BEGIN;

-- 1. Allow NULL email in profiles (for phone / social signups with no email).
ALTER TABLE public.profiles ALTER COLUMN email DROP NOT NULL;

-- 2. Trigger function: upsert profiles row from auth.users.
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
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 3. Attach trigger to auth.users — fire on INSERT OR UPDATE of the columns
--    we mirror. Narrow column-scoped UPDATE clause avoids re-running the
--    upsert on every password change / session tick.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 4. Backfill: any existing auth.users row without a matching profiles row
--    gets one now. Safe to re-run: the LEFT JOIN + IS NULL guard + ON CONFLICT
--    DO NOTHING together make this idempotent. DO NOTHING (not DO UPDATE)
--    because existing profiles rows may have been manually curated.
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
