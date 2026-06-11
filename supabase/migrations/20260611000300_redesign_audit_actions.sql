-- Redesign Phase 4 (4/4): extend the audit_log action whitelist with the
-- actions emitted by the redesign's RPCs and UI flows.
--
-- audit_log_action_check (last asserted in
-- 20260504070000_team_portal_communication_rpcs.sql) is a strict whitelist;
-- record_audit_event inserts directly, so an unlisted action aborts the
-- calling RPC's transaction. Without this migration every Players-grid
-- mutation (admin_update_player et al.) would fail with a CHECK violation
-- in production while passing in the constraint-free mock client.

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
        'import.started',
        'import.validated',
        'import.canceled',
        'import.completed',
        'import.failed',
        'import.rolled_back',
        'team.saved', 'team.deleted',
        'team.rsvp_updated',
        'team.message_created',
        'game.saved', 'game.deleted',
        'competition.score_updated',
        'practice.saved', 'practice.deleted',
        'registration.form_created',
        'registration.submitted', 'registration.approved', 'registration.rejected',
        'compliance.medical_update',
        'calendar.token_rotated',
        'member.invited', 'member.removed', 'member.role_changed',
        'settings.updated',
        'feature_flags.updated',
        'export.started', 'export.completed',
        'organization.onboarded',
        'evaluation.run',
        'scheduler.auto_started',
        'scheduler.auto_progress',
        'scheduler.auto_completed',
        'scheduler.auto_failed',
        'coach.status_updated',
        'coach.promoted',
        'team.coach_assigned',
        'team.coach_swapped',
        'team.coach_unassigned',
        -- Redesign: Players grid + record pages (20260611000100 RPCs)
        'player.updated',
        'player.bulk_updated',
        'player.created',
        'player.deleted',
        'player.compliance_updated',
        -- Redesign: Team Builder + co-ed transitions + feature config
        'teams.auto_balanced',
        'divisions.coed_merged',
        'divisions.gender_split',
        'settings.flags_updated',
        'settings.gender_model_updated',
        -- Pre-redesign frontend emitters that predate this whitelist and
        -- were silently failing for the same reason
        'impersonation.started',
        'impersonation.ended',
        'auth.password_updated',
        'settings.season_format_updated',
        'settings.season_updated',
        'settings.timezone_updated'
    ));
