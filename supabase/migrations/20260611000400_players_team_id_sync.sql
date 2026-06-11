-- ---------------------------------------------------------------------------
-- 20260611000400_players_team_id_sync.sql
--
-- players.team_id is a denormalized convenience column; team_players is the
-- relational source of truth for rosters (portals, summaries, scheduler
-- filters and the persistence RPCs read/write it). The teaming persistence
-- path (persist_team_schedule and friends) writes only team_players, so any
-- UI that reads players.team_id (Players grid, Player record, Team Builder,
-- dashboards) saw engine-generated rosters as "unassigned".
--
-- Fix at the schema level so every writer is covered: a trigger on
-- team_players keeps players.team_id in sync on INSERT/UPDATE/DELETE, plus a
-- one-time backfill for rosters persisted before this migration.
--
-- Revert: docs/sql/20260611000400_revert.sql
-- Smoke:  docs/sql/20260611000400_smoke.sql
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_player_team_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.players p
        SET team_id = NEW.team_id, updated_at = timezone('utc', now())
        WHERE p.id = NEW.player_id
          AND p.team_id IS DISTINCT FROM NEW.team_id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.player_id IS DISTINCT FROM NEW.player_id
           OR OLD.team_id IS DISTINCT FROM NEW.team_id THEN
            -- Clear the old player's pointer only if it still references the
            -- row being moved away from, then point the new player at the team.
            UPDATE public.players p
            SET team_id = NULL, updated_at = timezone('utc', now())
            WHERE p.id = OLD.player_id
              AND p.id IS DISTINCT FROM NEW.player_id
              AND p.team_id = OLD.team_id;
            UPDATE public.players p
            SET team_id = NEW.team_id, updated_at = timezone('utc', now())
            WHERE p.id = NEW.player_id
              AND p.team_id IS DISTINCT FROM NEW.team_id;
        END IF;
        RETURN NEW;
    ELSE
        -- Only clear if the player still points at the team being removed;
        -- a reassignment that already moved the pointer must not be undone.
        UPDATE public.players p
        SET team_id = NULL, updated_at = timezone('utc', now())
        WHERE p.id = OLD.player_id
          AND p.team_id = OLD.team_id;
        RETURN OLD;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_player_team_id() FROM anon;

DROP TRIGGER IF EXISTS team_players_sync_player_team_id ON public.team_players;
CREATE TRIGGER team_players_sync_player_team_id
    AFTER INSERT OR UPDATE OR DELETE ON public.team_players
    FOR EACH ROW EXECUTE FUNCTION public.sync_player_team_id();

-- Backfill: point players at their persisted roster row. When a player has
-- multiple team_players rows (shouldn't happen, but the PK allows it across
-- teams), prefer the most recently created assignment.
UPDATE public.players p
SET team_id = tp.team_id, updated_at = timezone('utc', now())
FROM (
    SELECT DISTINCT ON (player_id) player_id, team_id
    FROM public.team_players
    ORDER BY player_id, added_at DESC NULLS LAST
) tp
WHERE tp.player_id = p.id
  AND p.team_id IS DISTINCT FROM tp.team_id;
