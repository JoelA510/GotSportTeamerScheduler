-- Revert for 20260906000000_field_effective_dating.sql
--
-- Drops the retirement RPCs and the effective-dating columns on fields.
--
-- **This is destructive of retirement state, and for FUTURE-DATED retirements
-- it is destructive silently.** Two cases, and the first draft of this header
-- described only one of them:
--
--   * A retirement whose date has PASSED left fields.active = false. Dropping
--     effective_to loses the date but not the effect: the field stays out of
--     the scheduler, which is why this header used to claim the revert "must
--     not silently un-retire ground".
--
--   * A retirement dated in the FUTURE correctly left fields.active = true --
--     the field plays until it closes. effective_to is the only record that it
--     is closing at all, so dropping the column erases the whole decision and
--     leaves a row that reads as permanently open. That IS a silent un-retire,
--     and the promise above was false for exactly the rows the effective-dating
--     work exists to support.
--
-- It is not made non-destructive here -- a revert that quietly deactivated
-- those fields would substitute a different operator decision for the one it
-- lost. Instead the block below NAMES them before the column goes, so the loss
-- is recorded in the transcript of the run rather than discovered later. Copy
-- that list somewhere before you COMMIT.

BEGIN;

-- What this revert is about to erase, printed while the column still exists.
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fields' AND column_name='effective_to'
  ) THEN
    RAISE NOTICE 'fields.effective_to is already gone; nothing to record';
    RETURN;
  END IF;

  FOR r IN
    SELECT id, organization_id, name, effective_to, active
    FROM public.fields
    WHERE effective_to IS NOT NULL AND effective_to >= current_date
    ORDER BY effective_to, name
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE 'LOSING future retirement: field % (%) org % closes % active=%',
      r.name, r.id, r.organization_id, r.effective_to, r.active;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE 'no future-dated retirements; this revert loses dates but no pending closure';
  ELSE
    RAISE WARNING '% future-dated retirement(s) are being erased and will read as permanently open', v_n;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.admin_unretire_field(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_retire_field(uuid, uuid, date, boolean);

DROP TRIGGER IF EXISTS fields_retirement_deactivates ON public.fields;
DROP FUNCTION IF EXISTS public.enforce_field_retirement_deactivates();
DROP FUNCTION IF EXISTS public.field_is_live_on(date, date);

DROP INDEX IF EXISTS public.idx_fields_effective_to;

ALTER TABLE public.fields DROP COLUMN IF EXISTS effective_to;

COMMENT ON COLUMN public.fields.active IS NULL;

COMMIT;
