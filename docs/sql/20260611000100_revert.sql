-- Revert for 20260611000100_player_admin_mutation_rpcs.sql
DROP FUNCTION IF EXISTS public.coach_update_player_compliance(uuid, jsonb);
DROP FUNCTION IF EXISTS public.admin_delete_players(uuid[]);
DROP FUNCTION IF EXISTS public.admin_create_player(uuid, jsonb);
DROP FUNCTION IF EXISTS public.admin_bulk_update_players(uuid[], jsonb);
DROP FUNCTION IF EXISTS public.admin_update_player(uuid, jsonb);
DROP FUNCTION IF EXISTS public.apply_player_patch(uuid, jsonb);
DROP FUNCTION IF EXISTS public.sanitize_player_patch(jsonb);
