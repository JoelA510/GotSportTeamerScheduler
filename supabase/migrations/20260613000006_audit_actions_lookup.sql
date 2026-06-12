-- Replace the audit_log_action_check CHECK constraint with a lookup table.
--
-- The CHECK whitelist had to be dropped and fully re-stated by every
-- migration that introduced a new audit action — 15 migrations carry a copy,
-- and a missed re-statement aborts RPCs with a constraint violation at
-- runtime (docs/LESSONS_LEARNED.md #5). A foreign key to audit_actions
-- enforces the same invariant, but registering a new action becomes a
-- one-line INSERT:
--
--     INSERT INTO public.audit_actions (action)
--     VALUES ('thing.happened') ON CONFLICT (action) DO NOTHING;

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_actions (
    action     text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.audit_actions ENABLE ROW LEVEL SECURITY;

-- Read-only reference data; writes happen only via migrations (table owner).
CREATE POLICY audit_actions_read_authenticated ON public.audit_actions
    -- advisor-lint-allow: audit_actions is tenant-agnostic reference data (no org column; SELECT-only policy)
    FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.audit_actions TO authenticated, service_role;

-- Seed with the full whitelist from the latest CHECK constraint
-- (20260613000004_team_update_rpc.sql).
INSERT INTO public.audit_actions (action) VALUES
    ('import.started'),
    ('import.validated'),
    ('import.canceled'),
    ('import.completed'),
    ('import.failed'),
    ('import.rolled_back'),
    ('team.saved'),
    ('team.deleted'),
    ('team.updated'),
    ('team.rsvp_updated'),
    ('team.message_created'),
    ('game.saved'),
    ('game.deleted'),
    ('game.cancelled'),
    ('competition.score_updated'),
    ('practice.saved'),
    ('practice.deleted'),
    ('practice.cancelled'),
    ('registration.form_created'),
    ('registration.form_updated'),
    ('registration.form_deleted'),
    ('registration.submitted'),
    ('registration.approved'),
    ('registration.rejected'),
    ('compliance.medical_update'),
    ('calendar.token_rotated'),
    ('member.invited'),
    ('member.removed'),
    ('member.role_changed'),
    ('settings.updated'),
    ('feature_flags.updated'),
    ('export.started'),
    ('export.completed'),
    ('organization.onboarded'),
    ('evaluation.run'),
    ('scheduler.auto_started'),
    ('scheduler.auto_progress'),
    ('scheduler.auto_completed'),
    ('scheduler.auto_failed'),
    ('coach.status_updated'),
    ('coach.promoted'),
    ('coach.deleted'),
    ('team.coach_assigned'),
    ('team.coach_swapped'),
    ('team.coach_unassigned'),
    ('player.updated'),
    ('player.bulk_updated'),
    ('player.created'),
    ('player.deleted'),
    ('player.compliance_updated'),
    ('teams.auto_balanced'),
    ('divisions.coed_merged'),
    ('divisions.gender_split'),
    ('settings.flags_updated'),
    ('settings.gender_model_updated'),
    ('impersonation.started'),
    ('impersonation.ended'),
    ('auth.password_updated'),
    ('settings.season_format_updated'),
    ('settings.season_updated'),
    ('settings.timezone_updated')
ON CONFLICT (action) DO NOTHING;

-- Historical audit_log rows may carry actions that later whitelists dropped;
-- register them too so the FK validates against existing data.
INSERT INTO public.audit_actions (action)
SELECT DISTINCT action FROM public.audit_log
ON CONFLICT (action) DO NOTHING;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE public.audit_log
    ADD CONSTRAINT audit_log_action_fkey
    FOREIGN KEY (action) REFERENCES public.audit_actions(action);

COMMENT ON TABLE public.audit_actions IS
  'Registry of valid audit_log.action values. Replaces the audit_log_action_check CHECK constraint; new actions are registered with a one-line INSERT instead of re-stating the full whitelist.';

COMMIT;
