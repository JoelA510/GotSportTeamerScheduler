-- Redesign Phase 4 (1/3): player roster fields for the Players grid +
-- compliance tracking.
--
-- Adds:
--   * years_played  — rec-league experience signal (feature `years_played`).
--   * rating        — numeric 1–5 skill rating (feature `player_rating`),
--                     backfilled from the legacy skill_tier (novice→2,
--                     developing→3, advanced→4). skill_tier is KEPT for
--                     engine/test compatibility; rating is the editable
--                     source of truth going forward.
--   * jersey_number — roster admin field.
--   * paid / waiver_received / medical_form_received — compliance booleans
--                     (CSV-imported players have no registrations row to
--                     hang these off; booleans only, per scope rules).
--   * status CHECK extended with 'waitlist' (feature `waitlist`).
--   * grid filter index on (organization_id, status).

ALTER TABLE public.players
    ADD COLUMN IF NOT EXISTS years_played smallint
        CHECK (years_played IS NULL OR (years_played >= 0 AND years_played <= 30)),
    ADD COLUMN IF NOT EXISTS rating smallint
        CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    ADD COLUMN IF NOT EXISTS jersey_number smallint
        CHECK (jersey_number IS NULL OR (jersey_number >= 0 AND jersey_number <= 999)),
    ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS waiver_received boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS medical_form_received boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.players.years_played IS
  'Seasons of organized play (GotSport long-question header). Surfaced when the years_played org feature is on.';
COMMENT ON COLUMN public.players.rating IS
  '1–5 skill rating (player_rating org feature). Backfilled once from skill_tier: novice→2, developing→3, advanced→4.';
COMMENT ON COLUMN public.players.jersey_number IS
  'Jersey number (0–999); admin-editable in the Players grid.';
COMMENT ON COLUMN public.players.paid IS
  'Registration fee received (boolean compliance signal from GotSport Payment Status; no amounts are stored).';
COMMENT ON COLUMN public.players.waiver_received IS
  'Liability waiver received (boolean toggle; no documents are stored).';
COMMENT ON COLUMN public.players.medical_form_received IS
  'Medical/consent form received (boolean toggle; no documents are stored).';

-- One-time backfill from the legacy tier. Players rated after this point are
-- edited directly in the grid.
UPDATE public.players
SET rating = CASE skill_tier
    WHEN 'novice' THEN 2
    WHEN 'developing' THEN 3
    WHEN 'advanced' THEN 4
END
WHERE rating IS NULL
  AND skill_tier IN ('novice', 'developing', 'advanced');

-- Extend the status CHECK with 'waitlist'. The constraint name differs by
-- environment age (inline column CHECK from the definitive schema vs the
-- earlier refactor), so drop both candidates.
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_status_check;
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_status_check1;
ALTER TABLE public.players
    ADD CONSTRAINT players_status_check
    CHECK (status IN ('active', 'inactive', 'pending', 'waitlist'));

-- Grid filters are (org, status) scoped.
CREATE INDEX IF NOT EXISTS idx_players_org_status
    ON public.players (organization_id, status);

-- Environments built from the 20251208 baseline created division_id and
-- external_registration_id NOT NULL; the definitive schema (20260331) shape
-- is nullable, and admin_create_player inserts manual players without
-- either. Relax the legacy constraints (no-op where already nullable).
ALTER TABLE public.players ALTER COLUMN division_id DROP NOT NULL;
ALTER TABLE public.players ALTER COLUMN external_registration_id DROP NOT NULL;
