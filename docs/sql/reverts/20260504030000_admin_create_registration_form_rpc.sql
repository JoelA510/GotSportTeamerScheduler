-- Emergency rollback for 20260504030000_admin_create_registration_form_rpc.sql.
--
-- This removes the registration form creation RPC. Pair with an application
-- rollback that removes calls to public.admin_create_registration_form(...).
--
-- The migration also allowed the registration.form_created audit action. This
-- rollback leaves that action value allowed so historical audit rows remain
-- valid and the rollback does not delete audit evidence.

\set ON_ERROR_STOP on

BEGIN;

DROP FUNCTION IF EXISTS public.admin_create_registration_form(
    uuid,
    text,
    text,
    uuid,
    jsonb,
    text,
    jsonb
);

COMMIT;
