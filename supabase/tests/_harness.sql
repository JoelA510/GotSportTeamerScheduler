-- Harness self-test. Runs before every other test to prove pgTAP itself is
-- wired correctly. If this file fails, every other test in `supabase/tests/`
-- is untrustworthy — fix the harness first.
--
-- Keep this file MINIMAL — the goal is fast, fixture-free sanity.

BEGIN;

SELECT plan(1);

SELECT is(1 + 1, 2, 'pgTAP harness is wired — arithmetic works');

SELECT * FROM finish();
ROLLBACK;
