-- Milestone 3.5: RLS Remediation & View Security
-- 1. Explicitly check organization_id in RLS policies for core tables
-- 2. Add security_invoker to coach_team_map view

begin;

-- ==========================================
-- 1. SECURE SQL VIEW
-- ==========================================
-- Recreate coach_team_map with security_invoker = true to prevent RLS bypasses
drop view if exists public.coach_team_map cascade;
create or replace view public.coach_team_map
with (security_invoker = true)
as
select
    c.user_id as coach_user_id,
    t.id as team_id
from coaches c
join teams t on t.coach_id = c.id
where c.user_id is not null
union
select
    c.user_id as coach_user_id,
    t.id as team_id
from coaches c
join teams t on c.id = any(t.assistant_coach_ids)
where c.user_id is not null;

-- Grant access to authenticated users
grant select on public.coach_team_map to authenticated;


-- The original policy rewrites in this historical migration assumed direct
-- `organization_id` columns and `profiles.organization_id` already existed.
-- They are actually introduced later. The durable org-scoped replacements
-- live in 20260310000002_unified_rls_schema.sql and
-- 20260324000000_phase1_rls_unification.sql, so this replay-safe migration
-- only repairs the view security mode.

commit;
