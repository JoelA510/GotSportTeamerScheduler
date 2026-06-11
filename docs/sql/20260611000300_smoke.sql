-- Smoke checks for 20260611000300_redesign_audit_actions.sql

-- 1. The constraint exists and includes the redesign actions.
select 'audit_log_action_check includes redesign actions' as check,
       (pg_get_constraintdef(oid) like '%player.updated%')      as has_player_updated,
       (pg_get_constraintdef(oid) like '%teams.auto_balanced%') as has_auto_balanced,
       (pg_get_constraintdef(oid) like '%divisions.coed_merged%') as has_coed_merged,
       (pg_get_constraintdef(oid) like '%impersonation.started%') as has_impersonation
from pg_constraint
where conrelid = 'public.audit_log'::regclass
  and conname = 'audit_log_action_check';

-- 2. record_audit_event accepts a redesign action (rolls back via tx).
-- begin; select public.record_audit_event('<org-uuid>'::uuid, 'player.updated'); rollback;
