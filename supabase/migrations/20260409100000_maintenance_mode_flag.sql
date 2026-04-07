-- Migration: Add maintenance_mode toggle to organizations.settings
-- Phase 9 — Production Hardening
-- Created: 2026-04-09
--
-- Adds a `maintenance_mode` boolean flag (default: false) to the
-- organizations.settings JSONB column. When set to true, the frontend
-- OfflineGuard overlay will display a "Scheduled Maintenance" banner
-- to all users in that organization, detected via Supabase Realtime.
--
-- Admins can toggle this via:
--   UPDATE organizations SET settings = jsonb_set(settings, '{maintenance_mode}', 'true')
--   WHERE id = '<org-id>';

-- 1. Backfill existing orgs that don't have the flag
UPDATE public.organizations
SET settings = settings || '{"maintenance_mode": false}'::jsonb
WHERE NOT (settings ? 'maintenance_mode');

-- 2. Update the column default so new orgs get it automatically
ALTER TABLE public.organizations
  ALTER COLUMN settings SET DEFAULT '{ "retention_days": 180, "maintenance_mode": false }'::jsonb;

-- 3. Enable Realtime on organizations table for live maintenance detection
--    (publication may already include this table; ALTER is idempotent)
ALTER PUBLICATION supabase_realtime ADD TABLE public.organizations;
