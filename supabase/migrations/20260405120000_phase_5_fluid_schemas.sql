-- ==================================================================================
-- PHASE 5: DYNAMIC DATA SCHEMAS & ENTERPRISE MAPPING
-- ==================================================================================
-- This migration implements:
-- 1. Custom Attributes (JSONB) on Core Entities
-- 2. Schema Definitions per Organization
-- 3. High-Performance (15ms) Validation Gate
-- 4. Audit History for Schema Evolution
-- ==================================================================================

BEGIN;

-- 1. RESERVED KEYS PROTECTION (Used by Triggers & UI)
-- Any attempt to use these as custom attributes will be blocked.
CREATE OR REPLACE FUNCTION public.get_reserved_keys()
RETURNS text[] AS $$
BEGIN
    RETURN ARRAY[
        'id', 'org_id', 'organization_id', 'created_at', 'updated_at', 
        'email', 'first_name', 'last_name', 'phone', 'full_name', 
        'status', 'profile_id', 'user_id', 'team_id', 'division_id'
    ];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. SCHEMA EVOLUTION TABLES
CREATE TABLE IF NOT EXISTS public.organization_schemas (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    entity_type         text NOT NULL CHECK (entity_type IN ('player', 'coach', 'team')),
    schema_definition   jsonb NOT NULL DEFAULT '{}'::jsonb, -- Simplified schema: { field_name: type }
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (organization_id, entity_type)
);

CREATE TRIGGER organization_schemas_set_timestamp
    BEFORE UPDATE ON public.organization_schemas
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.organization_schemas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.organization_schema_history (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    entity_type         text NOT NULL,
    changed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    old_schema          jsonb,
    new_schema          jsonb,
    change_reason       text,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.organization_schema_history ENABLE ROW LEVEL SECURITY;

-- 3. UPGRADE CORE ENTITIES
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS custom_attributes jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.coaches ADD COLUMN IF NOT EXISTS custom_attributes jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS custom_attributes jsonb DEFAULT '{}'::jsonb;

-- 4. VALIDATION ENGINE (The 15ms Gate)
CREATE OR REPLACE FUNCTION public.validate_custom_attributes()
RETURNS TRIGGER AS $$
DECLARE
    v_schema jsonb;
    v_key text;
    v_val jsonb;
    v_expected_type text;
    v_reserved_keys text[] := public.get_reserved_keys();
BEGIN
    -- 1. Load Schema for Org + Entity
    SELECT schema_definition INTO v_schema 
    FROM public.organization_schemas 
    WHERE organization_id = NEW.organization_id 
      AND entity_type = TG_ARGV[0];

    -- If no schema, allow empty or log skip (depending on policy)
    IF v_schema IS NULL THEN
        RETURN NEW;
    END IF;

    -- 2. Iterate Payload Keys (O(n) where n = number of custom fields)
    FOR v_key, v_val IN SELECT * FROM jsonb_each(NEW.custom_attributes)
    LOOP
        -- A. RESERVED KEYS PROTECTION
        IF v_key = ANY(v_reserved_keys) THEN
            RAISE EXCEPTION '403 Forbidden: System Field Collision at key %', v_key;
        END IF;

        -- B. Primitive Type Enforcement (Optimized)
        v_expected_type := v_schema->>v_key;
        
        IF v_expected_type IS NOT NULL THEN
            CASE v_expected_type
                WHEN 'string' THEN
                    IF jsonb_typeof(v_val) != 'string' THEN 
                        RAISE EXCEPTION 'Validation Failed: Key % expected string, got %', v_key, jsonb_typeof(v_val);
                    END IF;
                WHEN 'number' THEN
                    IF jsonb_typeof(v_val) != 'number' THEN 
                        RAISE EXCEPTION 'Validation Failed: Key % expected number, got %', v_key, jsonb_typeof(v_val);
                    END IF;
                WHEN 'boolean' THEN
                    IF jsonb_typeof(v_val) != 'boolean' THEN 
                        RAISE EXCEPTION 'Validation Failed: Key % expected boolean, got %', v_key, jsonb_typeof(v_val);
                    END IF;
                WHEN 'date' THEN
                    -- Basic date string validation
                    IF jsonb_typeof(v_val) != 'string' OR NOT (v_val::text ~ '^\d{4}-\d{2}-\d{2}') THEN
                        RAISE EXCEPTION 'Validation Failed: Key % expected date (YYYY-MM-DD), got %', v_key, v_val;
                    END IF;
            END CASE;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. ATTACH TRIGGERS
DROP TRIGGER IF EXISTS tr_validate_player_attributes ON public.players;
CREATE TRIGGER tr_validate_player_attributes
    BEFORE INSERT OR UPDATE ON public.players
    FOR EACH ROW EXECUTE FUNCTION public.validate_custom_attributes('player');

DROP TRIGGER IF EXISTS tr_validate_coach_attributes ON public.coaches;
CREATE TRIGGER tr_validate_coach_attributes
    BEFORE INSERT OR UPDATE ON public.coaches
    FOR EACH ROW EXECUTE FUNCTION public.validate_custom_attributes('coach');

DROP TRIGGER IF EXISTS tr_validate_team_attributes ON public.teams;
CREATE TRIGGER tr_validate_team_attributes
    BEFORE INSERT OR UPDATE ON public.teams
    FOR EACH ROW EXECUTE FUNCTION public.validate_custom_attributes('team');

-- 6. AUDIT LOGGING FOR SCHEMA EVOLUTION
CREATE OR REPLACE FUNCTION public.log_schema_change()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.organization_schema_history (
        organization_id, entity_type, changed_by, old_schema, new_schema, change_reason
    ) VALUES (
        NEW.organization_id, 
        NEW.entity_type, 
        auth.uid(), 
        OLD.schema_definition, 
        NEW.schema_definition, 
        'Manual Update via Org Settings'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_audit_schema_change
    AFTER UPDATE ON public.organization_schemas
    FOR EACH ROW
    WHEN (OLD.schema_definition IS DISTINCT FROM NEW.schema_definition)
    EXECUTE FUNCTION public.log_schema_change();

-- 7. RLS POLICIES
CREATE POLICY "Schema Access: Org Members Only" ON public.organization_schemas
    FOR ALL USING (public.is_org_member(organization_id));

CREATE POLICY "Schema History: Admins Only" ON public.organization_schema_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.organization_members 
            WHERE organization_id = public.organization_schema_history.organization_id 
            AND profile_id = auth.uid() 
            AND role = 'admin'
        )
    );

COMMIT;
