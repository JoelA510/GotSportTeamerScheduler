-- pgTAP: dynamic organization schemas are saved through an admin RPC.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(13);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.admin_upsert_organization_schema(
        'a1111111-1111-1111-1111-111111111111',
        'player',
        '{"jersey_size":"string","birth_date":"date"}'::jsonb,
        'pgTAP insert'
    )->>'changed'),
    'true',
    'Org A admin can insert player schema through the RPC'
);

SELECT results_eq(
    $$
        SELECT organization_id, entity_type, schema_definition
          FROM public.organization_schemas
         WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
           AND entity_type = 'player'
    $$,
    $$
        VALUES (
            'a1111111-1111-1111-1111-111111111111'::uuid,
            'player'::text,
            '{"jersey_size":"string","birth_date":"date"}'::jsonb
        )
    $$,
    'inserted schema is stored with Org A and normalized entity type'
);

SELECT is(
    (
        SELECT count(*)
          FROM public.audit_log
         WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
           AND action = 'settings.updated'
           AND resource_type = 'organization_schema'
           AND metadata->>'entity_type' = 'player'
    )::integer,
    1,
    'schema insert writes one settings audit row'
);

SELECT is(
    (
        SELECT count(*)
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'organization_schemas'
           AND policyname = 'Schema Access: Org Members Only'
    )::integer,
    0,
    'old broad org-member schema policy is removed'
);

SELECT is(
    (public.admin_upsert_organization_schema(
        'a1111111-1111-1111-1111-111111111111',
        'player',
        '{"birth_date":"date","jersey_size":"string"}'::jsonb,
        'same data'
    )->>'changed'),
    'false',
    'repeating the same schema is idempotent'
);

SELECT is(
    (public.admin_upsert_organization_schema(
        'a1111111-1111-1111-1111-111111111111',
        'player',
        '{"jersey_size":"string","birth_date":"date","ranking":"number"}'::jsonb,
        'pgTAP update'
    )->>'changed'),
    'true',
    'Org A admin can update an existing schema'
);

SELECT is(
    (
        SELECT count(*)
          FROM public.organization_schema_history
         WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
           AND entity_type = 'player'
           AND new_schema ? 'ranking'
    )::integer,
    1,
    'schema updates still write schema history rows'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_organization_schema(
            'a1111111-1111-1111-1111-111111111111',
            'coach',
            '{"certification":"string"}'::jsonb,
            'coach attempt'
        )
    $$,
    '42501',
    NULL,
    'Org A coach cannot upsert schemas'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_organization_schema(
            'a1111111-1111-1111-1111-111111111111',
            'team',
            '{"sponsor":"string"}'::jsonb,
            'cross org'
        )
    $$,
    '42501',
    NULL,
    'Org B admin cannot upsert Org A schemas'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_organization_schema(
            'a1111111-1111-1111-1111-111111111111',
            'division',
            '{}'::jsonb,
            'bad entity'
        )
    $$,
    '23514',
    NULL,
    'invalid entity types are rejected'
);

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_organization_schema(
            'a1111111-1111-1111-1111-111111111111',
            'player',
            '[]'::jsonb,
            'bad shape'
        )
    $$,
    '22023',
    NULL,
    'schema definition must be a JSON object'
);

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_organization_schema(
            'a1111111-1111-1111-1111-111111111111',
            'player',
            '{"id":"string"}'::jsonb,
            'reserved key'
        )
    $$,
    '22023',
    NULL,
    'reserved schema keys are rejected'
);

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_organization_schema(
            'a1111111-1111-1111-1111-111111111111',
            'player',
            '{"skill":"rating"}'::jsonb,
            'bad type'
        )
    $$,
    '22023',
    NULL,
    'unsupported schema value types are rejected'
);

SELECT * FROM finish();
ROLLBACK;
