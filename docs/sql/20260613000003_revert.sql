-- Revert for 20260613000003_schedule_team_delete_rpcs.sql
DROP FUNCTION IF EXISTS public.admin_cancel_game_assignment(uuid);
DROP FUNCTION IF EXISTS public.admin_cancel_practice_assignment(uuid);
DROP FUNCTION IF EXISTS public.admin_delete_team(uuid);
