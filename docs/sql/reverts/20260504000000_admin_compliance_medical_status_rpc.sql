-- Emergency rollback for 20260504000000_admin_compliance_medical_status_rpc.sql.
--
-- This removes the admin compliance medical-status mutation RPC. Pair with an
-- application rollback that removes calls to
-- public.admin_update_registration_medical_status(uuid, uuid, boolean, jsonb).
--
-- The migration also allowed the compliance.medical_update audit action. This
-- rollback leaves that action value allowed so historical audit rows remain
-- valid and the rollback does not delete audit evidence.

\set ON_ERROR_STOP on

BEGIN;

DROP FUNCTION IF EXISTS public.admin_update_registration_medical_status(
    uuid,
    uuid,
    boolean,
    jsonb
);

COMMIT;
