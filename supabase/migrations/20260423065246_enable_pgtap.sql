-- Wave 7a Task 1: enable pgTAP for live-DB regression tests.
--
-- Background: Wave 6a's `advisor-lint.js` catches STATIC anti-patterns
-- (missing search_path, un-RLS'd tables, etc.) by grepping migration files.
-- It cannot observe runtime behavior — e.g. a policy that exists but still
-- leaks rows across orgs, or a view whose security_invoker isn't enforcing
-- what we expect.
--
-- pgTAP runs inside Postgres and lets us assert behavioral invariants against
-- a real database with real fixtures. Tests live in `supabase/tests/` and
-- run via `npm run test:db` (Supabase CLI's pgTAP runner).
--
-- This migration only enables the extension; no policies or tables are
-- touched. The extension ships with every Supabase instance — installing it
-- is idempotent and has zero effect outside the `extensions` schema.
--
-- Reversal: see docs/sql/reverts/20260423065246_disable_pgtap.sql.

-- Forward: enable pgTAP. Ships with Supabase; extension-only, no behavior change.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
