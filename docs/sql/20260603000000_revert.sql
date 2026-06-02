-- Revert for 20260603000000_field_availability_scenario_selection_rpc.sql
--
-- The forward migration is purely additive: it creates two SECURITY DEFINER
-- functions and one partial unique index. Dropping them restores the prior
-- state. No data is mutated by the forward migration, so this revert is safe
-- (the imported scenarios and their is_active flags are left untouched).
DROP FUNCTION IF EXISTS public.admin_select_field_availability_scenario(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.get_field_availability_scenarios(uuid, text);
DROP INDEX IF EXISTS public.uq_field_availability_one_active_per_group;
