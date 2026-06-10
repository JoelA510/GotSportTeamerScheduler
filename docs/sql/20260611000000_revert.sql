-- Revert for 20260611000000_player_roster_fields.sql
--
-- Step 1 — restore the original status CHECK (drops 'waitlist'; any
-- waitlisted players must be re-statused first or this will fail).
UPDATE public.players SET status = 'pending' WHERE status = 'waitlist';
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_status_check;
ALTER TABLE public.players
    ADD CONSTRAINT players_status_check
    CHECK (status IN ('active', 'inactive', 'pending'));

-- Step 2 — drop the grid filter index.
DROP INDEX IF EXISTS public.idx_players_org_status;

-- Step 3 — drop the roster columns (destroys ratings entered after the
-- skill_tier backfill; skill_tier itself was never modified).
ALTER TABLE public.players
    DROP COLUMN IF EXISTS years_played,
    DROP COLUMN IF EXISTS rating,
    DROP COLUMN IF EXISTS jersey_number,
    DROP COLUMN IF EXISTS paid,
    DROP COLUMN IF EXISTS waiver_received,
    DROP COLUMN IF EXISTS medical_form_received;
