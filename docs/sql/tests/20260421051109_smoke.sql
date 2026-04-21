-- Smoke test for migration 20260421051109_add_registration_forms_division.sql

-- 1. Column added.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'registration_forms'
  AND column_name = 'division_id';
-- Expected: 1 row; data_type = uuid; is_nullable = YES.

-- 2. submit_registration exists with the right signature + pinned search_path.
SELECT proname, pg_get_function_arguments(oid) AS args, prosecdef, proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'submit_registration';
-- Expected: 1 row; args = 'p_organization_id uuid, p_form_id uuid, p_profile_id uuid, p_responses jsonb, p_player_id uuid DEFAULT NULL::uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text';
-- prosecdef = true; proconfig contains 'search_path=public'.

-- 3. Defensive guard fires when form has no division.
--    Replace <ORG_UUID> + <FORM_UUID> + <PROFILE_UUID> with real values, run
--    once with form.division_id = NULL — should error with the friendly message.
--
--    SET LOCAL ROLE authenticated;
--    SET LOCAL "request.jwt.claims" = '{"sub": "<PROFILE_UUID>"}';
--    SELECT public.submit_registration(
--      '<ORG_UUID>'::uuid,
--      '<FORM_UUID>'::uuid,    -- a form whose division_id IS NULL
--      '<PROFILE_UUID>'::uuid,
--      '{}'::jsonb,
--      NULL,
--      'Smoke', 'User'
--    );
--    -- Expected: ERROR — 'Cannot register a new player: form ... is not bound to a division. ...'
--
-- 4. Happy path: set form.division_id to a real division, re-run, expect a
--    UUID returned (registration_id) + a new players row created with that
--    division_id.
