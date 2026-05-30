-- Revert for 20260530000100_upsert_division_for_import_rpc.sql
DROP FUNCTION IF EXISTS public.upsert_division_for_import(
  uuid, uuid, text, text, integer, integer, date, date
);
