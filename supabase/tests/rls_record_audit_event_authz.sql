-- Behavioral verification for 20260726000200_record_audit_event_authz.sql

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(6);

-- 1. Alice (admin, Org A) can write a normal audit event for her own org.
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';
SELECT lives_ok(
    $$ SELECT public.record_audit_event(
        'a1111111-1111-1111-1111-111111111111', 'settings.updated', NULL, NULL, '{}'::jsonb
    ) $$,
    'org member can write a normal audit event for their own org'
);
RESET role;

-- 2. Alice cannot fabricate an audit event for Org B (cross-org).
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';
SELECT throws_ok(
    $$ SELECT public.record_audit_event(
        'b2222222-2222-2222-2222-222222222222', 'settings.updated', NULL, NULL, '{}'::jsonb
    ) $$,
    '42501',
    NULL,
    'org A admin cannot fabricate an audit event for org B'
);
RESET role;

-- 3. Charlie (coach, non-admin, Org A) can write a normal audit event for
--    his own org -- membership, not admin status, is the bar for ordinary
--    actions.
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';
SELECT lives_ok(
    $$ SELECT public.record_audit_event(
        'a1111111-1111-1111-1111-111111111111', 'settings.updated', NULL, NULL, '{}'::jsonb
    ) $$,
    'non-admin org member can write a normal audit event for their own org'
);
RESET role;

-- 4. Charlie (non-admin) cannot write an impersonation.started audit event.
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';
SELECT throws_ok(
    $$ SELECT public.record_audit_event(
        'a1111111-1111-1111-1111-111111111111', 'impersonation.started', NULL, NULL, '{}'::jsonb
    ) $$,
    '42501',
    NULL,
    'non-admin org member cannot record an impersonation.started event'
);
RESET role;

-- 5. Alice (admin, Org A) CAN write an impersonation.started audit event.
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';
SELECT lives_ok(
    $$ SELECT public.record_audit_event(
        'a1111111-1111-1111-1111-111111111111', 'impersonation.started', NULL, NULL, '{}'::jsonb
    ) $$,
    'org admin can record an impersonation.started event for their own org'
);
RESET role;

-- 6. service_role (Edge Function fire-and-forget path, no end-user JWT) can
--    still write an audit event for any org -- the exemption that keeps
--    supabase/functions/_shared/auth.ts's recordAudit() working.
RESET ROLE;
SET LOCAL role = 'service_role';
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT lives_ok(
    $$ SELECT public.record_audit_event(
        'b2222222-2222-2222-2222-222222222222', 'scheduler.auto_completed', NULL, NULL, '{}'::jsonb
    ) $$,
    'service_role can write an audit event for any org (Edge Function fire-and-forget path)'
);
RESET role;

SELECT * FROM finish();
ROLLBACK;
