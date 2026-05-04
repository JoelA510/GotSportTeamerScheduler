-- Route dynamic schema saves through an audited org-admin RPC.
--
-- The schema builder previously upserted organization_schemas directly from
-- the browser, and the table policy allowed every org member to write schema
-- validation rules. Keep reads available to org members while moving writes to
-- a narrow admin RPC with validation and audit evidence.

BEGIN;

DROP POLICY IF EXISTS "Schema Access: Org Members Only"
  ON public.organization_schemas;

CREATE POLICY "Schema Access: Org Members Select"
  ON public.organization_schemas FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.admin_upsert_organization_schema(
    p_organization_id uuid,
    p_entity_type text,
    p_schema_definition jsonb,
    p_change_reason text DEFAULT 'Manual Update via Org Settings'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entity_type text := lower(btrim(COALESCE(p_entity_type, '')));
    v_schema jsonb := COALESCE(p_schema_definition, '{}'::jsonb);
    v_normalized jsonb := '{}'::jsonb;
    v_key text;
    v_value jsonb;
    v_type text;
    v_reserved text[] := public.get_reserved_keys();
    v_existing public.organization_schemas%ROWTYPE;
    v_result public.organization_schemas%ROWTYPE;
    v_changed boolean := true;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authenticated user is required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_entity_type NOT IN ('player', 'coach', 'team') THEN
        RAISE EXCEPTION 'invalid schema entity type: %', p_entity_type
            USING ERRCODE = '23514';
    END IF;

    IF jsonb_typeof(v_schema) <> 'object' THEN
        RAISE EXCEPTION 'p_schema_definition must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(v_schema)
    LOOP
        IF btrim(v_key) = '' THEN
            RAISE EXCEPTION 'schema field names must not be blank'
                USING ERRCODE = '22023';
        END IF;

        IF v_key = ANY(v_reserved) THEN
            RAISE EXCEPTION 'schema field % is reserved', v_key
                USING ERRCODE = '22023';
        END IF;

        IF jsonb_typeof(v_value) <> 'string' THEN
            RAISE EXCEPTION 'schema field % must map to a string type', v_key
                USING ERRCODE = '22023';
        END IF;

        v_type := lower(btrim(v_value #>> '{}'));

        IF v_type NOT IN ('string', 'number', 'boolean', 'date') THEN
            RAISE EXCEPTION 'schema field % has unsupported type %', v_key, v_type
                USING ERRCODE = '22023';
        END IF;

        v_normalized := v_normalized || jsonb_build_object(v_key, v_type);
    END LOOP;

    SELECT os.*
      INTO v_existing
      FROM public.organization_schemas os
     WHERE os.organization_id = p_organization_id
       AND os.entity_type = v_entity_type
     FOR UPDATE;

    WITH upserted AS (
        INSERT INTO public.organization_schemas (
            organization_id,
            entity_type,
            schema_definition
        )
        VALUES (
            p_organization_id,
            v_entity_type,
            v_normalized
        )
        ON CONFLICT (organization_id, entity_type) DO UPDATE
           SET schema_definition = EXCLUDED.schema_definition,
               updated_at = timezone('utc', now())
         WHERE public.organization_schemas.schema_definition IS DISTINCT FROM EXCLUDED.schema_definition
        RETURNING *
    )
    SELECT upserted.*
      INTO v_result
      FROM upserted;

    IF v_result.id IS NULL THEN
        SELECT os.*
          INTO v_result
          FROM public.organization_schemas os
         WHERE os.organization_id = p_organization_id
           AND os.entity_type = v_entity_type;
        v_changed := false;
    END IF;

    IF v_changed THEN
        PERFORM public.record_audit_event(
            p_organization_id,
            'settings.updated',
            'organization_schema',
            v_result.id,
            jsonb_build_object(
                'setting', 'organization_schema',
                'entity_type', v_entity_type,
                'change_reason', NULLIF(btrim(COALESCE(p_change_reason, '')), ''),
                'previous', CASE
                    WHEN v_existing.id IS NULL THEN NULL
                    ELSE v_existing.schema_definition
                END,
                'current', v_result.schema_definition
            )
        );
    END IF;

    RETURN to_jsonb(v_result) || jsonb_build_object('changed', v_changed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_organization_schema(uuid, text, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.admin_upsert_organization_schema(uuid, text, jsonb, text) IS
  'Admin-only org-scoped upsert for dynamic custom-attribute schemas with validation and settings.updated audit logging.';

COMMIT;
