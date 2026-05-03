-- Emergency rollback for 20260503070000_field_import_apply_rollback.sql.
--
-- Use only with the paired application rollback. Existing field import ledger
-- rows remain queryable, but the field apply/rollback RPCs are removed. PR #228
-- already allowed the broader non-player target-table set for the shared
-- ledger; this revert removes only the field_subunits target added here.

BEGIN;

DROP FUNCTION IF EXISTS public.rollback_field_import_job(uuid);
DROP FUNCTION IF EXISTS public.finalize_field_import_job(uuid, jsonb);
DROP FUNCTION IF EXISTS public.import_text_to_positive_int(text, integer);
DROP FUNCTION IF EXISTS public.import_text_to_day_of_week(text);
DROP FUNCTION IF EXISTS public.import_text_to_time(text);

ALTER TABLE public.import_application_records
    DROP CONSTRAINT IF EXISTS import_application_records_target_table_check;

ALTER TABLE public.import_application_records
    ADD CONSTRAINT import_application_records_target_table_check
    CHECK (
        target_table IN (
            'coaches',
            'fields',
            'locations',
            'practice_slots',
            'game_slots'
        )
    );

COMMIT;
