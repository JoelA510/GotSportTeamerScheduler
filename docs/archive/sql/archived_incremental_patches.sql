-- ============================================================================
-- SquadLogic Archived Incremental Schema Patches
-- Consolidated from phase2 through phase10 schema update files
-- These patches are SUPERSEDED by the definitive schema migration:
--   supabase/migrations/20260331000000_definitive_schema.sql
-- Retained for historical audit traceability only.
-- ============================================================================

-- -----------------------------------------------------------------------
-- Source: phase10_schema_updates.sql
-- -----------------------------------------------------------------------
-- Phase 10: Teaming Logic Schema Updates

-- Players: Add willing_to_coach and buddy_request
ALTER TABLE players ADD COLUMN IF NOT EXISTS willing_to_coach BOOLEAN DEFAULT false;
ALTER TABLE players ADD COLUMN IF NOT EXISTS buddy_request TEXT; -- Name of requested buddy


-- -----------------------------------------------------------------------
-- Source: phase2_schema_updates.sql
-- -----------------------------------------------------------------------
-- Phase 2: Schema Refinement for Real Data

-- Players: Add medical_info and registration_history
ALTER TABLE players ADD COLUMN IF NOT EXISTS medical_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE players ADD COLUMN IF NOT EXISTS registration_history JSONB DEFAULT '[]'::jsonb;

-- Coaches: Change certifications to JSONB
-- Dropping and re-adding to change type from TEXT to JSONB. Data will be re-populated by import script.
ALTER TABLE coaches DROP COLUMN IF EXISTS certifications;
ALTER TABLE coaches ADD COLUMN certifications JSONB DEFAULT '[]'::jsonb;


-- -----------------------------------------------------------------------
-- Source: phase3_schema_updates.sql
-- -----------------------------------------------------------------------
-- Phase 3: Full Fidelity Schema Updates

-- Players: Add contact_info and emergency_contacts
ALTER TABLE players ADD COLUMN IF NOT EXISTS contact_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE players ADD COLUMN IF NOT EXISTS emergency_contacts JSONB DEFAULT '[]'::jsonb;

-- Coaches: Add contact_info
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS contact_info JSONB DEFAULT '{}'::jsonb;

-- Note: medical_info already exists from Phase 2, but we will expand its content in the JSONB.
-- No DDL needed for expanding JSONB content, just data update.


-- -----------------------------------------------------------------------
-- Source: phase4_schema_updates.sql
-- -----------------------------------------------------------------------
-- Phase 4: Robustness & Validation Schema Updates

-- Players: Add status, last_imported_at, import_source
ALTER TABLE players ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending'));
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN IF NOT EXISTS import_source TEXT;

-- Coaches: Add last_imported_at, import_source
-- Note: Coaches already has a 'status' column.
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMPTZ;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS import_source TEXT;


-- -----------------------------------------------------------------------
-- Source: phase5_schema_updates.sql
-- -----------------------------------------------------------------------
-- Phase 5: Advanced Schema Optimizations

-- Players: Add location_lat, location_lng, timezone, flags
ALTER TABLE players ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION;
ALTER TABLE players ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;
ALTER TABLE players ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS flags JSONB DEFAULT '[]'::jsonb;

-- Coaches: Add location_lat, location_lng, timezone, flags
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS flags JSONB DEFAULT '[]'::jsonb;


-- -----------------------------------------------------------------------
-- Source: phase6_schema_updates.sql
-- -----------------------------------------------------------------------
-- Phase 6: Field Schema & Scheduling Updates

-- Fields: Add max_age, priority_rating, active
ALTER TABLE fields ADD COLUMN IF NOT EXISTS max_age TEXT; -- e.g., 'U12'
ALTER TABLE fields ADD COLUMN IF NOT EXISTS priority_rating INTEGER DEFAULT 1; -- Higher = Better priority
ALTER TABLE fields ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Note: Daylight adjustments are handled by creating specific practice_slots with valid_from/valid_until ranges.
-- No schema change needed for practice_slots as it already supports this.


-- -----------------------------------------------------------------------
-- Source: phase7_schema_updates.sql
-- -----------------------------------------------------------------------
-- Phase 7: Field Generator Schema Updates

-- Practice Slots: Add label for easier debugging/UI
ALTER TABLE practice_slots ADD COLUMN IF NOT EXISTS label TEXT;


-- -----------------------------------------------------------------------
-- Source: phase8_schema_updates.sql
-- -----------------------------------------------------------------------
-- Phase 8: Team Size Caps Schema Updates

-- Divisions: Add max_roster_size and format
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS max_roster_size INTEGER;
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS format TEXT; -- e.g., '5v5', '7v7', '9v9', '11v11'



