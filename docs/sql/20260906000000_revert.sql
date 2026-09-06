-- Revert for 20260906000000_field_effective_dating.sql
--
-- Drops the retirement RPCs and the effective-dating columns on fields.
--
-- **This is destructive of retirement state.** Any field retired through
-- admin_retire_field carries its end date in fields.effective_to and nowhere
-- else; dropping the column loses it. fields.active is left as the RPC set it,
-- so retired fields stay out of the scheduler -- reverting the schema must not
-- silently un-retire ground that an operator deliberately closed.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_unretire_field(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_retire_field(uuid, uuid, date, boolean);

DROP TRIGGER IF EXISTS fields_retirement_deactivates ON public.fields;
DROP FUNCTION IF EXISTS public.enforce_field_retirement_deactivates();

DROP INDEX IF EXISTS public.idx_fields_effective_to;

ALTER TABLE public.fields DROP COLUMN IF EXISTS effective_to;

COMMENT ON COLUMN public.fields.active IS NULL;

COMMIT;
