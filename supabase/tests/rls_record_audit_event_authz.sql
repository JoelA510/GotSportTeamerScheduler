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

-- 6. service_role (Edge Function fire-and-forget path) bypasses the org
--    membership check.
--
--    The assertion expects 23502 (not-null violation on audit_log.user_id),
--    NOT success, and the distinction is the whole point: reaching a
--    not-null violation proves the authz guard was skipped, because a
--    non-exempt caller would have been rejected with 42501 long before the
--    INSERT was attempted. Asserting 23502 therefore pins the exemption's
--    behavior precisely.
--
--    The 23502 itself is a PRE-EXISTING defect this PR does not introduce
--    and deliberately does not fix: audit_log.user_id is
--    `NOT NULL REFERENCES auth.users(id)`
--    (20260324000004_audit_log.sql:12), but a service-role JWT carries no
--    `sub` claim, so auth.uid() is NULL. Every Edge Function
--    recordAudit(serviceClient, ...) call site therefore fails today and has
--    always failed -- silently, because the fire-and-forget wrapper in
--    _shared/auth.ts:149-159 swallows the error into a console.error. Fixing
--    it (nullable user_id, or a system-actor sentinel) is out of scope here;
--    when it lands, flip this assertion to lives_ok.
RESET ROLE;
SET LOCAL role = 'service_role';
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT throws_ok(
    $$ SELECT public.record_audit_event(
        'b2222222-2222-2222-2222-222222222222', 'scheduler.auto_completed', NULL, NULL, '{}'::jsonb
    ) $$,
    '23502',
    NULL,
    'service_role bypasses the org-membership guard (fails on NOT NULL user_id, not 42501)'
);
RESET role;

SELECT * FROM finish();
ROLLBACK;
