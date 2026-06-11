-- Revert for 20260611000400_players_team_id_sync.sql
-- Drops the sync trigger + function. The backfilled players.team_id values
-- are data, not schema — they are NOT reverted (they were correct before the
-- trigger existed and remain correct after).

DROP TRIGGER IF EXISTS team_players_sync_player_team_id ON public.team_players;
DROP FUNCTION IF EXISTS public.sync_player_team_id();
