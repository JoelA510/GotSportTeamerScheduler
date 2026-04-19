# Wave 7a — pgTAP CI + 5 Canonical RLS Tests

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4, 5, 6a, 6b shipped. Wave 6a added static advisor-pattern CI (Wave 6a's `scripts/advisor-lint.js`); Wave 7a adds its DYNAMIC complement — pgTAP tests that exercise RLS invariants against a live Postgres.

**Wave 7 split**: 7a (pgTAP) + 7b (CSP nonce hardening). Original Wave 7 estimated at 889 lines; splitting keeps each plan under the 700 cap and lets the two orthogonal security layers merge independently.

**Audit backlog**: `docs/audits/wave-1a/index.md` `### Wave 7-db-test` section lists the pgTAP findings.

**Wave 7a purpose**: bootstrap a live-DB test harness in `supabase/tests/` + wire `npm run test:db` + conditional CI + ship 5 canonical RLS invariant tests. Once this lands, future RLS / trigger / function changes can be validated against pg semantics instead of only against static regex patterns.

**Why DYNAMIC alongside Wave 6a's STATIC**:
- Wave 6a catches structural patterns: missing `search_path`, tables without `ENABLE ROW LEVEL SECURITY`, `USING (true)` catch-all.
- Wave 7a catches behavioral violations: a policy that exists but still allows cross-org reads; a definer function that leaks rows; a view whose `security_invoker` doesn't enforce what we expect.

**Free-tier posture**: pgTAP CI workflow runs conditionally (only on `supabase/**` path changes) to cap GitHub Actions minutes at ~40/mo (vs ~300/mo if it ran on every PR).

**Wave 7a is**:
- `supabase/migrations/*_enable_pgtap.sql` + revert.
- `supabase/tests/` with template + harness-self-test + 5 RLS tests + shared fixtures.
- `npm run test:db` + `npm run test:db:once` scripts.
- `.github/workflows/pgtap.yml` (conditional trigger).
- `docs/testing/pgtap.md` + `docs/security/rls-policies.md` sync.

**Wave 7a is NOT**:
- CSP hardening (Wave 7b).
- Non-RLS pgTAP tests (triggers, functions, constraints — future waves).
- Rewriting RLS policies (pgTAP EXERCISES them; it doesn't change them).
- Performance tests.
- Testing Edge Functions with pgTAP (Postgres-only).

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. Wave 6a + 6b shipped: `scripts/advisor-lint.js`, `scripts/check-bundle-size.js`, `scripts/cleanup-raw-imports.js`, and their config + docs files all present.
3. `docs/audits/wave-1a/index.md` `### Wave 7-db-test` readable.
4. `supabase/migrations/` naming pattern `YYYYMMDDHHMMSS_*.sql`.
5. `supabase/tests/` does NOT yet exist.
6. `.github/workflows/` has `ci.yml` + `cleanup-raw-imports.yml`. No existing `pgtap.yml`.
7. No existing `npm run test:db` script in `package.json`.
8. Baselines on `main`: `npm run lint` / `typecheck` / `test` / `frontend:build` / `check:bundle` / `check:advisors` all green.
9. Docker available locally for running `supabase start` (optional; CI has Docker by default).
10. `docs/security/rls-policies.md` exists (Task 3 appends to it).

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-7a-pgtap-harness` → Task 1
  - `claude/wave-7a-pgtap-rls-tests` → Task 2 (depends on Task 1)
  - `claude/wave-7a-closure` → Task 3 (depends on 1 + 2)

PR per task; CI + Wave 6a gates stay green.

---

## Task 1 — pgTAP Harness + CI Wiring

**Commit**: `feat(test): bootstrap pgTAP harness for live-db RLS tests`

**Branch**: `claude/wave-7a-pgtap-harness`

### Steps

1. Checkout `claude/wave-7a-pgtap-harness` from latest `main`.

2. **Enable pgTAP extension** — new migration `supabase/migrations/<YYYYMMDDHHMMSS>_enable_pgtap.sql`:
   ```sql
   -- Forward: enable pgTAP. Ships with Supabase; extension-only, no behavior change.
   CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
   ```
   Revert at `docs/sql/reverts/<YYYYMMDDHHMMSS>_disable_pgtap.sql`:
   ```sql
   DROP EXTENSION IF EXISTS pgtap;
   ```

3. **Create `supabase/tests/` directory** with a template + harness self-test:
   - `supabase/tests/_template.sql` — copy-starting-point with `BEGIN + plan(N) + tests + finish + ROLLBACK` structure.
   - `supabase/tests/_harness.sql` — trivial test (`SELECT is(1+1, 2, 'arithmetic works')`) that fails fast if the harness itself is broken.

   Every test file MUST wrap in `BEGIN ... ROLLBACK` so the DB is untouched after each run.

4. **Add npm scripts** to `package.json`:
   ```json
   "scripts": {
     "test:db": "supabase test db",
     "test:db:once": "supabase test db --file"
   }
   ```
   Requires Supabase CLI installed locally (external tool; not an npm dep). Document in `docs/testing/pgtap.md`.

5. **Create `.github/workflows/pgtap.yml`** — conditional CI:
   ```yaml
   name: pgTAP tests
   on:
     pull_request:
       paths:
         - 'supabase/migrations/**'
         - 'supabase/tests/**'
         - '.github/workflows/pgtap.yml'
     workflow_dispatch: {}
   jobs:
     pgtap:
       runs-on: ubuntu-latest
       timeout-minutes: 15
       steps:
         - uses: actions/checkout@v4
         - uses: supabase/setup-cli@v1
           with: { version: latest }
         - run: supabase start
         - run: npm run test:db
         - run: supabase stop
           if: always()
   ```

   **Conditional trigger is load-bearing**: `supabase start` + run costs ~3–5 min of Actions time. At typical PR cadence, running on every PR = ~300 min/mo; conditional trigger caps at ~40 min/mo.

6. **Write `docs/testing/pgtap.md`** (new):
   ```markdown
   # pgTAP Testing

   Live-DB tests exercising RLS invariants, trigger behavior, and other
   DB-state properties that Vitest cannot see.

   ## Why (vs Wave 6a's advisor-lint)
   - advisor-lint is STATIC: grep patterns on migration files.
   - pgTAP is DYNAMIC: runs against a real Postgres with real fixtures.
   Together they cover structural + behavioral regressions.

   ## Running locally
   1. Install Supabase CLI + Docker Desktop.
   2. `supabase start` (~3 min first time; pulls images).
   3. `npm run test:db` runs every `supabase/tests/*.sql`.
   4. `supabase stop` when done.
   5. Single file: `npm run test:db:once supabase/tests/rls_cross_org_isolation.sql`.

   ## CI
   Conditional trigger on PRs that touch `supabase/migrations/**` or
   `supabase/tests/**`. Typical PRs skip. Manual runs via
   `workflow_dispatch`.

   ## Writing a test
   1. Copy `supabase/tests/_template.sql` to a new file with a descriptive name.
   2. Keep `BEGIN ... ROLLBACK` wrapper.
   3. Declare `SELECT plan(N)` with expected test count.
   4. Use `set_config('request.jwt.claims', '{"sub": "<uuid>"}', true)` +
      `SET LOCAL role = 'authenticated'` to simulate a user.
   5. End with `SELECT finish();`.
   ```

7. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   git status
   # Optional local:
   # supabase start && npm run test:db && supabase stop
   ```

8. Commit, push, open PR. PR body documents the conditional-trigger rationale.

### Tests to add (Task 1)

- `supabase/tests/_harness.sql` (harness self-test; 1 assertion).
- No Vitest tests.

### Out of scope (Task 1)

- Writing RLS tests (Task 2).
- Running pgTAP on every PR (minutes budget).
- Branch Supabase project integration (requires credentials).
- Coverage metrics beyond pass/fail.

---

## Task 2 — 5 Canonical RLS Invariant Tests

**Commit**: `test(db): add 5 canonical RLS invariant tests`

**Branch**: `claude/wave-7a-pgtap-rls-tests`

**Depends on**: Task 1 merged.

### Steps

1. Checkout `claude/wave-7a-pgtap-rls-tests` from latest `main` AFTER Task 1 merges.

2. **Write shared fixtures** at `supabase/tests/_fixtures.sql` — org/user/team seed data reused across tests. Deterministic UUIDs (`11111111-...`, `22222222-...`, etc.), no random values. Included by each test via `\i supabase/tests/_fixtures.sql`.

3. **Write 5 canonical tests** covering the multi-tenancy invariants that matter most:

   **(a) `supabase/tests/rls_cross_org_isolation.sql`** — Alice (Org A member) cannot SELECT Org B's rows:
   ```sql
   BEGIN;
   \i supabase/tests/_fixtures.sql
   SELECT plan(3);

   SET LOCAL role = 'authenticated';
   SET LOCAL request.jwt.claims TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

   SELECT is((SELECT COUNT(*) FROM public.teams)::int, 1, 'Alice sees only her org''s team');
   SELECT is((SELECT name FROM public.teams LIMIT 1), 'A-Team', 'A-Team specifically');
   SELECT is(
     (SELECT COUNT(*) FROM public.teams WHERE organization_id = 'b2222222-2222-2222-2222-222222222222')::int,
     0, 'explicit Org B filter returns nothing'
   );

   SELECT finish();
   ROLLBACK;
   ```

   **(b) `supabase/tests/rls_anonymous_gate.sql`** — `anon` role reads zero rows from domain tables:
   ```sql
   BEGIN;
   \i supabase/tests/_fixtures.sql
   SELECT plan(5);
   SET LOCAL role = 'anon';
   SELECT is((SELECT COUNT(*) FROM public.organizations)::int, 0, 'anon: 0 orgs');
   SELECT is((SELECT COUNT(*) FROM public.teams)::int, 0, 'anon: 0 teams');
   SELECT is((SELECT COUNT(*) FROM public.players)::int, 0, 'anon: 0 players');
   SELECT is((SELECT COUNT(*) FROM public.audit_log)::int, 0, 'anon: 0 audit rows');
   SELECT is((SELECT COUNT(*) FROM public.organization_members)::int, 0, 'anon: 0 member rows');
   SELECT finish();
   ROLLBACK;
   ```

   **(c) `supabase/tests/rls_admin_vs_coach.sql`** — admin reads `audit_log`; coach does not:
   ```sql
   BEGIN;
   \i supabase/tests/_fixtures.sql
   -- Fixtures include one admin + one coach in the same org.
   SELECT plan(2);
   SET LOCAL role = 'authenticated';

   SET LOCAL request.jwt.claims TO '{"sub":"<admin-uuid>"}';
   SELECT ok((SELECT COUNT(*) FROM public.audit_log) > 0, 'admin reads audit_log');

   SET LOCAL request.jwt.claims TO '{"sub":"<coach-uuid>"}';
   SELECT is((SELECT COUNT(*) FROM public.audit_log)::int, 0, 'coach cannot read audit_log');

   SELECT finish();
   ROLLBACK;
   ```

   **(d) `supabase/tests/rls_service_role_bypass.sql`** — `service_role` sees all rows (Edge Functions need this):
   ```sql
   BEGIN;
   \i supabase/tests/_fixtures.sql
   SELECT plan(1);
   SET LOCAL role = 'service_role';
   SELECT is((SELECT COUNT(*) FROM public.teams)::int, 2, 'service_role sees all orgs'' teams');
   SELECT finish();
   ROLLBACK;
   ```

   **(e) `supabase/tests/rls_import_efficiency_metrics_view.sql`** — the view Wave 2 set to `security_invoker = on` enforces org-scope for the caller:
   ```sql
   BEGIN;
   \i supabase/tests/_fixtures.sql
   -- Fixtures include import rows in both orgs.
   SELECT plan(1);
   SET LOCAL role = 'authenticated';
   SET LOCAL request.jwt.claims TO '{"sub":"11111111-1111-1111-1111-111111111111"}';
   SELECT is(
     (SELECT COUNT(*) FROM public.import_efficiency_metrics)::int,
     (SELECT COUNT(*) FROM public.imports WHERE organization_id = 'a1111111-1111-1111-1111-111111111111')::int,
     'view is org-scoped for authenticated caller'
   );
   SELECT finish();
   ROLLBACK;
   ```

4. **Run locally** before pushing:
   ```bash
   supabase start
   npm run test:db
   supabase stop
   ```
   Every test should pass against current RLS policies. If a test FAILS because current policies are weaker than expected, that IS the pgTAP value — surface the weakness in the PR body and either:
   - File a separate PR to fix the policy (with its own pgTAP test).
   - Adjust the test + document the deviation in `docs/security/rls-policies.md`.

   Do NOT silently make the test weaker to pass.

5. **Fixture discipline** — `_fixtures.sql` is the ONLY place org/user/team seed SQL lives. Per-test `INSERT`s are forbidden; if a test needs specific data a fixture doesn't provide, ADD to `_fixtures.sql` + justify in PR body.

6. Verification gate (Task 1's + mandatory local pgTAP run):
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   supabase start && npm run test:db && supabase stop
   git status
   ```

7. Commit, push, open PR. PR body lists each test + asserted invariant + any policy weakness surfaced.

### Tests to add (Task 2)

- `supabase/tests/_fixtures.sql`
- `supabase/tests/rls_cross_org_isolation.sql`
- `supabase/tests/rls_anonymous_gate.sql`
- `supabase/tests/rls_admin_vs_coach.sql`
- `supabase/tests/rls_service_role_bypass.sql`
- `supabase/tests/rls_import_efficiency_metrics_view.sql`

### Out of scope (Task 2)

- Non-RLS pgTAP tests.
- Rewriting RLS policies (surface weaknesses; fix in separate PR).
- Performance tests.
- Edge Function testing (Postgres-only).

---

## Task 3 — Closure

**Commit**: `docs(wave-7a): closure — pgtap + rls tests shipped`

**Branch**: `claude/wave-7a-closure`

**Depends on**: Tasks 1 + 2 merged.

### Steps

1. Checkout `claude/wave-7a-closure` from latest `main` AFTER Tasks 1 + 2 merge.

2. **Update `docs/security/rls-policies.md`** — append a short section:
   ```markdown
   ## Live-DB regression guard (pgTAP)

   `supabase/tests/` contains pgTAP tests exercising the RLS invariants
   documented above. Runs:
   - Locally: `supabase start && npm run test:db && supabase stop`.
   - CI: `.github/workflows/pgtap.yml` on PRs that touch `supabase/**`.

   Wave 7a canonical tests:
   - `rls_cross_org_isolation.sql`: Org A ↛ Org B visibility.
   - `rls_anonymous_gate.sql`: anon reads zero domain rows.
   - `rls_admin_vs_coach.sql`: `audit_log` admin-only.
   - `rls_service_role_bypass.sql`: service_role sees all.
   - `rls_import_efficiency_metrics_view.sql`: view is org-scoped.

   Add new tests when shipping new tables / views / policies — see
   `docs/testing/pgtap.md`.
   ```

3. **Update `docs/audits/wave-1a/index.md`** — Wave-7-db-test findings: prepend `✅`, set `Proposed wave` to `7a (shipped)` (leaving CSP findings for Wave 7b). Append a `## Wave 7a closure` section summarizing: harness + conditional CI + 5 canonical tests + GitHub Actions minutes projection (~40/mo).

4. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 7a pgTAP + RLS tests

   Three PRs shipped:
   - Task 1: pgTAP harness (migration + supabase/tests/ + npm run test:db
     + conditional CI workflow). ~40 min/mo Actions budget.
   - Task 2: 5 canonical RLS invariant tests. All passing against current
     policies (or policy weakness surfaced — see PR).
   - Task 3: closure.

   docs/security/rls-policies.md documents the live-DB regression guard.
   docs/testing/pgtap.md documents how to run + extend.
   ```

5. Verification:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   npm run format -- docs/security/rls-policies.md docs/testing/pgtap.md docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
   git status
   ```

6. Commit, push, open PR.

### Tests to add (Task 3)

- None.

### Out of scope (Task 3)

- Editing `.claude/wave-*.md`.
- Archiving docs.
- CSP documentation (Wave 7b).

---

## Documentation Currency Pass

Handled across Tasks 1–3:
1. `docs/testing/pgtap.md` (new — Task 1).
2. `supabase/migrations/<YYYYMMDDHHMMSS>_enable_pgtap.sql` (Task 1).
3. `docs/sql/reverts/<YYYYMMDDHHMMSS>_disable_pgtap.sql` (Task 1).
4. `docs/security/rls-policies.md` — append pgTAP section (Task 3).
5. `docs/audits/wave-1a/index.md` — Wave-7-db-test findings marked shipped (Task 3).
6. `docs/expansion/98_PROGRESS_LOG.md` — dated entry (Task 3).

Do NOT touch: `claude.md`, `docs/architecture/**`, `docs/operations/**`, `docs/testing/e2e_master_plan.md`, any `.claude/wave-*.md`.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 3 tasks merged with CI green (including Wave 6a's `check:bundle` + `check:advisors` gates).
2. `supabase/tests/` contains: `_template.sql`, `_harness.sql`, `_fixtures.sql`, 5 RLS test files.
3. `.github/workflows/pgtap.yml` runs conditionally on `supabase/**` paths.
4. `npm run test:db` + `npm run test:db:once` scripts in `package.json`.
5. `docs/testing/pgtap.md` + updated `docs/security/rls-policies.md` published.
6. `npm run lint`: warning count ≤ baseline.
7. `npm run typecheck`: 0 errors.
8. `npm run test`: 100 % pass; Vitest case count unchanged (pgTAP is separate runner).
9. `npm run test:e2e -- --workers=1`: passing count unchanged from post-Wave-5 baseline.
10. `npm run frontend:build`: bundle sizes unchanged (pgTAP is DB-layer; no bundle impact).
11. No new npm dep (Supabase CLI is external).
12. No `pg_cron` job added.
13. No production code change in `frontend/src/**` or `packages/core/src/**`.
14. **Test-impact reconciled**: only new tests are the 6 SQL files in `supabase/tests/` + the harness self-test. Vitest + E2E counts unchanged.

---

## Commit & Push to Main

1. Task 1 lands first.
2. Task 2 after Task 1.
3. Task 3 after 1 + 2.
4. Post-merge: operator runs `npm run test:db` locally OR triggers the workflow via `workflow_dispatch` to confirm green.
5. On regression: revert PR within 30 min.

---

## Verification Gate (Per Task, Before Push)

For Tasks 1, 3:
```bash
npm run lint && npm run typecheck && npm run test
npm run check:advisors && npm run check:bundle
npm run frontend:build
git status
```

For Task 2 additionally (mandatory local pgTAP):
```bash
supabase start && npm run test:db && supabase stop
```

Each `FAIL → HALT`.

---

## Key References

- `claude.md` — §7 Supabase, §8 Testing, §11 CI.
- `docs/audits/wave-1a/index.md` § Wave 7-db-test.
- `docs/audits/wave-1a/security.md` — RLS invariant source.
- `docs/security/rls-policies.md` — existing RLS documentation.
- Wave 6a's `scripts/advisor-lint.js` — static complement.
- Wave 2's `20260416000001_initialize_new_tenant.sql` (for fixture reference).

---

## Critical Files

**Will create**:
- `supabase/migrations/<YYYYMMDDHHMMSS>_enable_pgtap.sql` (Task 1)
- `docs/sql/reverts/<YYYYMMDDHHMMSS>_disable_pgtap.sql` (Task 1)
- `supabase/tests/_template.sql` (Task 1)
- `supabase/tests/_harness.sql` (Task 1)
- `supabase/tests/_fixtures.sql` (Task 2)
- `supabase/tests/rls_cross_org_isolation.sql` (Task 2)
- `supabase/tests/rls_anonymous_gate.sql` (Task 2)
- `supabase/tests/rls_admin_vs_coach.sql` (Task 2)
- `supabase/tests/rls_service_role_bypass.sql` (Task 2)
- `supabase/tests/rls_import_efficiency_metrics_view.sql` (Task 2)
- `.github/workflows/pgtap.yml` (Task 1)
- `docs/testing/pgtap.md` (Task 1)

**Will edit**:
- `package.json` — `test:db` + `test:db:once` scripts (no new deps)
- `docs/security/rls-policies.md` (Task 3)
- `docs/audits/wave-1a/index.md` (Task 3 — only Wave-7-db-test findings)
- `docs/expansion/98_PROGRESS_LOG.md` (Task 3)

**Will NOT edit**:
- `claude.md`, any `.claude/wave-*.md`.
- `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `tests/factories/**`, `tests/helpers/**`, `tests/setup.js`.
- `frontend/src/**`, `packages/core/src/**`, `supabase/functions/**`.
- `vercel.json` (Wave 7b).
- `docs/security/csp.md` (Wave 7b creates).
- Any existing migration or RLS policy (pgTAP exercises; doesn't modify).

---

## Out of Scope This Wave (7a)

- CSP hardening (Wave 7b).
- Non-RLS pgTAP tests.
- Rewriting RLS policies.
- Performance tests.
- Edge Function testing.
- CSP `report-uri`.
- HSTS.
- Any production UI change.

---

## Ground Rules

- **Conditional CI trigger is load-bearing**. The `paths` filter keeps GitHub Actions minutes in check.
- **Every pgTAP test isolates**. `BEGIN ... ROLLBACK`; no shared state.
- **Fixtures live in `_fixtures.sql` only**. Per-test INSERTs are forbidden.
- **Surface policy weakness, don't hide it**. If a test fails because current RLS is weaker than expected, file it; don't weaken the test.
- **No production code changes**. Wave 7a is DB-layer only.
- **No new deps, no new Edge Functions, no new `pg_cron` jobs**.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task.
