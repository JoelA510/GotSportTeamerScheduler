-- Tests for the initialize_new_tenant RPC
BEGIN;

-- Setup the test database
SELECT plan(3);

-- 1. Successfully execute the RPC
SELECT results_eq(
    $$ SELECT public.initialize_new_tenant('Test Org', 'test-org', 'UTC') $$,
    $$ SELECT id FROM organizations WHERE url_slug = 'test-org' $$,
    'RPC should create an organization and return its ID'
);

-- 2. Verify admin membership
SELECT results_eq(
    $$ SELECT role FROM organization_members WHERE organization_id = (SELECT id FROM organizations WHERE url_slug = 'test-org') $$,
    $$ SELECT 'admin'::text $$,
    'Executing user should be granted the admin role'
);

-- 3. Reject duplicate slugs
SELECT throws_ok(
    $$ SELECT public.initialize_new_tenant('Duplicate Org', 'test-org', 'UTC') $$,
    'unique_url_slug',
    'Should throw unique constraint violation for duplicate slug'
);

SELECT * FROM finish();
ROLLBACK;
