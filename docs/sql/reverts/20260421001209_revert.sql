-- Revert script for migration 20260421001209_lock_search_path_on_definer_functions.sql
--
-- USE WITH CAUTION: this re-opens the search-path injection vector documented
-- in audit F-2-03. Only run if a downstream consumer breaks specifically due
-- to the pinned search_path (very unlikely — public is the SquadLogic schema).

ALTER FUNCTION public.get_reserved_keys() RESET search_path;
ALTER FUNCTION public.log_schema_change() RESET search_path;
ALTER FUNCTION public.validate_custom_attributes() RESET search_path;
ALTER FUNCTION public.check_password_length_on_auth_users() RESET search_path;
ALTER FUNCTION public.persist_evaluation_run(UUID, TEXT, JSONB, INTEGER) RESET search_path;
ALTER FUNCTION public.persist_evaluation_run(JSONB, JSONB, JSONB) RESET search_path;
ALTER FUNCTION public.prune_old_evaluation_runs() RESET search_path;
