-- ==================================================================================
-- PHASE 5.1: PASSWORD HARDENING TRIGGER
-- ==================================================================================
-- This migration implements a database-level check for password length.
-- Since auth.users.encrypted_password is already hashed, we enforce that
-- the application provides a 'password_length' in the raw_user_meta_data.
-- ==================================================================================

-- 1. TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.check_password_length_on_auth_users()
RETURNS TRIGGER AS $$
DECLARE
    pwd_len INT;
BEGIN
    -- Only check if the encrypted_password has changed (implies a new password is being set)
    IF (TG_OP = 'UPDATE' AND NEW.encrypted_password <> OLD.encrypted_password) OR (TG_OP = 'INSERT') THEN
        -- Extract password_length from raw_user_meta_data
        pwd_len := (NEW.raw_user_meta_data->>'password_length')::INT;
        
        -- Enforce minimum length of 12
        IF pwd_len IS NULL OR pwd_len < 12 THEN
            RAISE EXCEPTION 'Security Policy Violation: Password must be at least 12 characters. (Database Enforcement)';
        END IF;

        -- Cleanup: Remove password_length from metadata after check to keep it clean (Optional)
        -- NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'password_length';
    END IF;
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Security Policy Violation: Invalid password metadata or length. Detail: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. APPLY TRIGGER TO auth.users
-- Note: This is an internal Supabase table. If apply_migration fails, 
-- use the Supabase SQL Editor with superuser privileges.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'check_password_length_trigger' 
        AND tgrelid = 'auth.users'::regclass
    ) THEN
        CREATE TRIGGER check_password_length_trigger
            BEFORE INSERT OR UPDATE ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.check_password_length_on_auth_users();
    END IF;
END $$;
