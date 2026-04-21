-- Wave 2 Task 3 (Audit F-2-03): pin search_path = 'public' on the 6 definer
-- functions flagged by `mcp__supabase__get_advisors --type=security`.
--
-- Background: SECURITY DEFINER functions inherit the CALLER's search_path by
-- default. An attacker can prepend a schema (e.g., via SET search_path = malicious,
-- public; SELECT my_func();) to redirect operations against attacker-controlled
-- objects (function shadowing, table shadowing). Pinning search_path at function
-- definition closes that vector.
--
-- Functions covered (6 names; persist_evaluation_run has 2 overloads → 7 ALTERs):
--   1. get_reserved_keys()
--   2. log_schema_change()                    [trigger function, no args]
--   3. validate_custom_attributes()           [trigger function, args via TG_ARGV]
--   4. check_password_length_on_auth_users()  [trigger function, no args]
--   5. persist_evaluation_run(UUID, TEXT, JSONB, INTEGER)
--   6. persist_evaluation_run(JSONB, JSONB, JSONB)
--   7. prune_old_evaluation_runs()
--
-- Reversal: docs/sql/reverts/20260421001209_revert.sql.

ALTER FUNCTION public.get_reserved_keys()
  SET search_path = public;

ALTER FUNCTION public.log_schema_change()
  SET search_path = public;

ALTER FUNCTION public.validate_custom_attributes()
  SET search_path = public;

ALTER FUNCTION public.check_password_length_on_auth_users()
  SET search_path = public;

ALTER FUNCTION public.persist_evaluation_run(UUID, TEXT, JSONB, INTEGER)
  SET search_path = public;

ALTER FUNCTION public.persist_evaluation_run(JSONB, JSONB, JSONB)
  SET search_path = public;

ALTER FUNCTION public.prune_old_evaluation_runs()
  SET search_path = public;
