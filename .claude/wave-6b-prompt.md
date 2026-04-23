# Wave 6b — Free-Tier Guards: Edge Functions, DB Indexes, Storage Retention

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4, 5, 6a shipped. Wave 6a stood up the client/CI guardrails (bundle budget + advisor lint). Wave 6b is the backend counterpart: reduce actual free-tier consumption on Supabase.

**Wave 6b purpose**: three backend-side reductions aligned to specific free-tier caps:
1. **Edge Function invocation audit + caching** — shave monthly invocation count on hot paths identified by Wave 1a Task 4 projections. Free-tier budget: 500 K invocations/mo.
2. **DB index additions** — add indexes on org-scoped hot-path queries identified in Wave 1a Task 3's RPC / query-pattern audit. Free-tier DB budget: 500 MB; indexes cost space but reduce scan time (and keep us further from the 500 MB line than a scan-forcing query pattern would).
3. **Storage retention cron** — add `pg_cron` job to expire `raw-imports` objects after N days. Free-tier storage budget: 1 GB.

**Audit backlog**: `docs/audits/wave-1a/` — Wave 1a Task 3 (`supabase-performance.md`) + Task 4 (`free-tier-usage.md`). Read both before Task 1.

**Wave 6b is**:
- Task 1: Edge Function invocation audit + TTL caching for top 3 hottest functions.
- Task 2: DB index migration (one migration; one per-task-branch; adds indexes per audit findings).
- Task 3: Storage retention cron (`raw-imports` cleanup via `pg_cron`).
- Task 4: Closure.

**Wave 6b is NOT**:
- Adding new Edge Functions.
- Removing existing Edge Functions (that's feature work).
- Changing RPC signatures.
- Schema changes beyond adding indexes (no new tables, no new columns).
- Data migrations (no backfills).
- pgTAP wiring (Wave 7).
- CSP nonce hardening (Wave 7).

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. Wave 6a merged — `scripts/advisor-lint.js` exists; CI runs `npm run check:advisors`.
3. `docs/audits/wave-1a/supabase-performance.md` readable; `## RPC inventory` + `## Edge Function inventory` + `## Findings` sections in hand.
4. `docs/audits/wave-1a/free-tier-usage.md` readable; `## Edge Function invocation projection` + `## Storage projection` tables in hand.
5. `supabase/migrations/` latest migration format: `YYYYMMDDHHMMSS_*.sql` (14-digit concatenated datetime).
6. `supabase/functions/` contains the known functions: `_shared`, `auto-scheduler`, `calendar-feed`, `fairness-scoring`, `game-persistence`, `import-validation`, `practice-persistence`, `team-persistence`.
7. `pg_cron` extension is available (per Wave 2's data-retention cron in `docs/expansion/98_PROGRESS_LOG.md` — migration `20260416000002_data_retention_cron.sql`).
8. No existing `scripts/cleanup-raw-imports*` or similar; Task 3's cron wires via `pg_cron` only, no CI-side script.
9. Frontend cache utility exists (per `logger.js` docstring + Phase 9 work — confirm via `grep -n "cache" frontend/src/lib/`). Task 1 extends it.
10. Baseline: `npm run lint` / `typecheck` / `test` / `check:bundle` / `check:advisors` all green.

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-6b-edge-cache` → Task 1
  - `claude/wave-6b-db-indexes` → Task 2
  - `claude/wave-6b-storage-retention` → Task 3
  - `claude/wave-6b-closure` → Task 4 (lands LAST — depends on 1–3)
- Tasks 1–3 are independent; either order.
- PR per task. CI + advisor-lint + bundle-check all green before merge.

---

## Wave Scope

Three cost-reducing tasks + one closure. Each cost-reducing task quantifies its impact: "projected monthly invocations reduced from N to M" / "query time on 100-org projection reduced from N ms to M ms" / "storage projection capped at N MB".

---

## Task 1 — Edge Function Invocation Audit + TTL Caching

**Commit**: `perf(edge): add TTL caching to top-3 hottest edge functions`

**Branch**: `claude/wave-6b-edge-cache`

### Steps

1. Checkout `claude/wave-6b-edge-cache` from latest `main`.

2. **Identify the top-3 hottest functions** from `docs/audits/wave-1a/free-tier-usage.md` § Edge Function invocation projection:
   - Typically `calendar-feed` (polled every 15 min by subscribers), `fairness-scoring` (re-run on schedule refreshes), and one of the persistence functions — but confirm against the actual projection table.
   - If the audit flagged a DIFFERENT top-3, follow the audit.

3. **For each of the top-3**:
   a. **Confirm invocation pattern** — read the function (`supabase/functions/<name>/index.ts`) + the frontend caller (grep `functions.invoke('<name>')`). Identify whether the RESULT of each call is cacheable:
      - Idempotent reads (e.g., `calendar-feed` for a given team + token): HIGHLY cacheable.
      - Writes / side-effects: NOT cacheable.
      - Per-user reads: cacheable per-user.
   b. **Add a TTL cache** on the frontend side in the caller — NOT in the Edge Function itself (the Edge Function runs once per request; caching the frontend call reduces invocations).
      - Use the existing cache utility at `frontend/src/lib/cache.js` (or wherever Phase 9's cache lives — grep confirms).
      - TTL recommendations:
        - `calendar-feed`: 5 minutes (matches the generation cadence reasonable for subscribers).
        - `fairness-scoring`: 2 minutes (post-schedule-change windows).
        - Per-function: document the TTL rationale in the function's call site comment.
      - **Cache key**: include every input that would change the result (org id, team id, season id, user id, etc.). A cache hit must be safe — no stale org data bleeding across users.
      - **Cache invalidation on writes**: after any mutation that would change the function's output, invalidate the cache key. Most flows already have this via existing patterns — confirm.
   c. **Document the reduction estimate** in the function's README or a new `docs/operations/edge-function-budget.md`:
      - Before: N invocations / active user / month.
      - After: N × (1 - cache-hit-rate-estimate) / active user / month.
      - At 100-org projection: total mo invocations.

4. **Create `docs/operations/edge-function-budget.md`**:
   ```markdown
   # Edge Function Invocation Budget

   Supabase Free tier: 500 K invocations/month. Target: stay below 50 % (250 K)
   at 100-org steady state so spike traffic has headroom.

   ## Per-function projections (100-org steady state)

   | Function | Before Wave 6b | After Wave 6b | Cache TTL | Budget share |
   | --- | --- | --- | --- | --- |
   | calendar-feed | N | M | 5 min | x % |
   | fairness-scoring | N | M | 2 min | x % |
   | ... | ... | ... | ... | ... |

   ## When projection exceeds 50% of free tier
   1. Raise cache TTL if data freshness tolerates.
   2. Add client-side deduplication / coalescing.
   3. Push computation to the frontend where tractable.
   4. File a wave to migrate the function to a non-Edge-Function pathway.
   ```

5. **Free-tier guardrail**: this task ADDS frontend cache code but DOES NOT add any new Edge Function, does not add any new scheduled job, does not add any new dep. Confirm in Wave Review.

6. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test                   # includes any new cache-integration tests
   npm run check:advisors         # from Wave 6a — still green
   npm run check:bundle           # cache additions are tiny; budget stays green
   npm run frontend:build
   git status
   ```

7. Commit, push, open PR. PR body includes the projection table before/after.

### Tests to add (Task 1)

- Unit tests for the cache integration at the 3 call sites — extend existing hook/component tests or add new ones:
  - Cache hit: call twice in TTL window → Edge Function invoked once.
  - Cache miss after TTL expiry: call, wait past TTL, call → invoked twice.
  - Cache invalidation on mutation: mutate → next read invokes fresh.
  - Distinct cache keys: two different orgs/teams → both invoke independently.
  - ≥ 6 test cases across the 3 call sites.

### Out of scope (Task 1)

- Adding a server-side cache (Supabase doesn't offer one at free tier).
- Refactoring the Edge Function code.
- Adding a new Edge Function.
- Retry/backoff logic (separate concern).
- Request coalescing beyond basic TTL cache.
- CDN edge caching.

---

## Task 2 — DB Index Migration

**Commit**: `perf(db): add indexes on org-scoped hot-path queries`

**Branch**: `claude/wave-6b-db-indexes`

### Steps

1. Checkout `claude/wave-6b-db-indexes` from latest `main`.

2. **Read `docs/audits/wave-1a/supabase-performance.md`** § Index audit. Note every flagged missing-index case — typically:
   - `.eq('organization_id', …)` filters on tables without `(organization_id)` index.
   - `.order('created_at')` on tables without `(created_at)` or `(organization_id, created_at)`.
   - `.eq('team_id', …)` joins against tables without `team_id` index.
   - `.eq('user_id', …)` / `.eq('profile_id', …)` similarly.

3. **Filter to high-confidence adds** — only add an index if:
   - The query pattern is called in a hot path (hook consumed by the dashboard or a frequently-rendered component).
   - The table has ≥ 1000 rows at 100-org projection (small tables scan fast; index overhead not worth it).
   - No existing partial / composite index already covers the query.

4. **Write the migration** at `supabase/migrations/<YYYYMMDDHHMMSS>_add_free_tier_indexes.sql` using the current UTC datetime:
   ```sql
   -- Forward: add indexes on org-scoped hot-path queries identified by
   -- Wave 1a Task 3's audit. Each index is justified by a specific
   -- query pattern in frontend/src/hooks/ or packages/core/src/.
   -- Indexes use CREATE INDEX IF NOT EXISTS (idempotent) and
   -- include a comment citing the audit finding + query pattern.

   -- Example (adjust to actual audit findings):
   CREATE INDEX IF NOT EXISTS idx_team_players_organization_id
     ON public.team_players (organization_id);
   COMMENT ON INDEX public.idx_team_players_organization_id IS
     'Wave 6b: frequent filter in useTeamRoster hook (Wave 1a F-3-XX).';

   CREATE INDEX IF NOT EXISTS idx_audit_log_organization_id_created_at
     ON public.audit_log (organization_id, created_at DESC);
   COMMENT ON INDEX public.idx_audit_log_organization_id_created_at IS
     'Wave 6b: admin activity panel query pattern (Wave 1a F-3-YY).';

   -- …one per audit finding…
   ```

5. **Write the revert** at `docs/sql/reverts/<YYYYMMDDHHMMSS>_drop_free_tier_indexes.sql`:
   ```sql
   DROP INDEX IF EXISTS public.idx_team_players_organization_id;
   DROP INDEX IF EXISTS public.idx_audit_log_organization_id_created_at;
   -- …
   ```

6. **Write a pre-flight sanity SQL smoke** at `docs/sql/tests/free_tier_indexes_exist.sql`:
   ```sql
   -- Run after migration applies. Expect N rows (one per added index).
   SELECT schemaname, tablename, indexname
   FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname LIKE 'idx_%'
     AND indexname IN (
       'idx_team_players_organization_id',
       'idx_audit_log_organization_id_created_at'
       -- …
     )
   ORDER BY tablename, indexname;
   ```

7. **Use `CREATE INDEX IF NOT EXISTS`** everywhere. **Do NOT** use `CREATE INDEX CONCURRENTLY` — Supabase migrations wrap in a transaction by default; `CONCURRENTLY` would fail. For a free-tier DB, blocking index creation (a brief lock) is acceptable since the DB isn't under production load during migration. Document this choice in the migration header.

8. **Test**: indexes are observable via `pg_indexes` — no unit test in Vitest covers this. Task 4 closure verifies post-deploy via the SQL smoke script.

9. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test                      # unchanged
   npm run check:advisors            # from Wave 6a
   npm run check:bundle
   npm run frontend:build
   git status                        # only migration + revert + smoke files touched
   ```

10. Commit, push, open PR. PR body includes:
    - Index inventory table (name | table | columns | query pattern cited | projected ms saved on 100-org data).
    - Migration + revert SQL diff.
    - Post-deploy verification steps (run smoke script; confirm indexes present).

### Tests to add (Task 2)

- None in Vitest. Indexes are DB state, not client-observable.
- `docs/sql/tests/free_tier_indexes_exist.sql` is the operator smoke.

### Out of scope (Task 2)

- Adding new tables.
- Adding new columns.
- Dropping existing indexes (even if unused — separate audit).
- Refactoring hook queries.
- Materialized views.
- Partial indexes with complex `WHERE` predicates (keep index definitions simple; complex partials = separate future wave).
- `CREATE INDEX CONCURRENTLY` (Supabase migration transaction model forbids).
- Schema-diff PR checks (Wave 6a's advisor-lint catches different patterns).

---

## Task 3 — Storage Retention via GitHub Actions (`raw-imports`)

**Commit**: `feat(storage): add raw-imports 30-day retention via github actions`

**Branch**: `claude/wave-6b-storage-retention`

**Why GitHub Actions, not `pg_cron`**: a plain `DELETE FROM storage.objects` executed in `pg_cron` removes the metadata row but leaves the physical file in the S3-backed storage tier — orphaned bytes that continue to count against the 1 GB free-tier quota. To actually free storage we must call the Supabase Storage API (`supabase.storage.from('raw-imports').remove(paths)`), which cascades through to the S3 backend AND deletes the metadata row. That API call needs a service-role credential, which is unsafe to stash in the database. GitHub Actions (free ~2,000 min/mo for private repos; this job will use < 20 min/mo) is the simplest free-tier-compatible host.

### Steps

1. Checkout `claude/wave-6b-storage-retention` from latest `main`.

2. **Confirm `raw-imports` bucket state** (Wave 2 Task 2 closed it to private + org-scoped RLS):
   - `grep -rn "raw-imports" supabase/migrations/`.
   - Confirm bucket is NOT public.
   - Confirm RLS policy present.
   - If state differs from Wave 2 close, stop — reconcile first.

3. **Choose the retention window** — Wave 1a Task 4 suggested bounded retention. Recommended: **30 days**. Imports older than 30 days are operational history; users re-upload if needed. Document the choice rationale in `storage-retention.md`.

4. **Write the cleanup script** at `scripts/cleanup-raw-imports.js`:
   - Uses `@supabase/supabase-js` (already a dep; no new install).
   - Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env.
   - Lists objects in `raw-imports` via the Storage API (paginate if > 1000 rows per listing).
   - Filters for `created_at < NOW() - 30 days`.
   - Calls `supabase.storage.from('raw-imports').remove(pathsToDelete)` in batches of ≤ 100.
   - Logs the deleted count + any errors. Exits 0 on success, 1 on API error.
   - **Dry-run mode**: `--dry-run` flag lists what would be deleted without calling `.remove()`.
   - **Safety cap**: if the list of to-delete paths exceeds some sanity threshold (e.g., 10,000) — exit 1 with a clear message. Prevents a runaway deletion if bucket state is unexpected.

5. **Write the GitHub Actions workflow** at `.github/workflows/cleanup-raw-imports.yml`:
   ```yaml
   name: Cleanup raw-imports (30-day retention)

   on:
     schedule:
       - cron: '0 5 * * *'   # Daily 05:00 UTC (staggered from other retention jobs)
     workflow_dispatch:
       inputs:
         dry_run:
           description: 'Dry run (list only, do not delete)'
           required: false
           default: 'false'

   jobs:
     cleanup:
       runs-on: ubuntu-latest
       timeout-minutes: 10
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: '20'
             cache: 'npm'
         - run: npm ci
         - name: Run cleanup
           env:
             SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
             SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
           run: node scripts/cleanup-raw-imports.js ${{ github.event.inputs.dry_run == 'true' && '--dry-run' || '' }}
   ```

6. **Document in `docs/operations/storage-retention.md`** (new):
   ```markdown
   # Storage Retention

   ## raw-imports bucket
   - **Retention**: 30 days.
   - **Enforcement**: `.github/workflows/cleanup-raw-imports.yml` runs
     `scripts/cleanup-raw-imports.js` daily at 05:00 UTC (staggered from
     the existing `cleanup-export-jobs` pg_cron at 02:00 UTC).
   - **Why GitHub Actions, not `pg_cron`**: a plain `DELETE FROM
     storage.objects` only removes the metadata row, leaving orphaned
     physical bytes in the S3 backend. The Storage API call
     (`supabase.storage.from(...).remove([...])`) cascades to the S3
     tier AND the metadata row.
   - **Required secrets** (set in GitHub repo settings):
     - `SUPABASE_URL` (already exists for CI).
     - `SUPABASE_SERVICE_ROLE_KEY` (new — add as a repository secret;
       never commit; never expose via `VITE_*` prefix per CLAUDE.md §2).
   - **Monthly Actions minutes budget**: job runs ~30s × 31 days ≈ 16 min/mo.
     Well inside the 2,000 min/mo free-tier budget for private repos.
   - **User impact**: operational history; users re-upload if data needed.
   - **Recovery**: deleted objects are not restorable at free tier.
   - **Dry-run**: manual `workflow_dispatch` with `dry_run=true` lists
     what would be deleted without calling `.remove()`. Use to validate
     changes to the retention window or filter logic.
   - **Safety cap**: if a run would delete > 10,000 paths, the script
     exits 1 and notifies via the Actions failure channel — investigate
     before bypassing.
   ```

7. **Free-tier guardrail**: this task adds NO `pg_cron` job, NO Edge Function, NO new npm dependency (uses `@supabase/supabase-js` already in deps). The GitHub Actions workflow's cost (~16 min/mo) is the only additional consumption.

8. **Secret onboarding**: document in PR body that the operator must add `SUPABASE_SERVICE_ROLE_KEY` as a repository secret BEFORE the workflow can run. Until then, the scheduled job will fail visibly in the Actions UI. Include a one-line pre-merge checklist for the operator.

9. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test                   # includes new unit tests for cleanup script's filter logic
   npm run check:advisors
   npm run check:bundle
   npm run frontend:build
   git status
   ```
   Note: the workflow itself can't be "run" in a PR (no secrets in fork builds); manual `workflow_dispatch` after merge verifies.

10. Commit, push, open PR. PR body includes:
    - Why GitHub Actions over `pg_cron` (the orphaned-file problem).
    - Secret-onboarding checklist.
    - Dry-run instructions.
    - Safety-cap threshold rationale.

### Tests to add (Task 3)

- `tests/cleanupRawImports.test.js` — unit tests for the script's pure filter + batching logic:
  - Given a list of mock `{ name, created_at }` rows, filter to those older than 30 days.
  - Batches of > 100 paths split into multiple `.remove()` calls.
  - Safety cap triggers above threshold.
  - Dry-run flag suppresses `.remove()` calls.
  - Supabase client factory uses env vars (not hardcoded).
  - ≥ 6 test cases. Mock the Supabase client via `tests/helpers/createChainMock` pattern adapted for `.storage.from(...)`.

### Post-deploy verification (Task 3)

- After merge: operator adds `SUPABASE_SERVICE_ROLE_KEY` secret.
- Trigger workflow manually with `dry_run=true`. Review the list of paths.
- Re-trigger without `dry_run`. Confirm deletion count matches the dry-run list.
- After 24 h: confirm the scheduled run fired successfully in Actions UI.
- Confirm storage dashboard shows stable or declining size over the first 31 days after cutover.

### Out of scope (Task 3)

- Adding retention to OTHER buckets (scope creep).
- Moving cleanup to an Edge Function (uses invocation budget).
- Moving cleanup to `pg_cron` (orphaned-file problem).
- User-facing "download past imports" UI.
- Notifying users of deletions.
- Reducing the current `audit_log` retention (already 180 days per Wave 2).
- Pre-commit secret scanning for the new secret name.

---

## Task 4 — Closure

**Commit**: `docs(wave-6b): closure — backend free-tier guards shipped`

**Branch**: `claude/wave-6b-closure`

**Depends on**: Tasks 1–3 merged.

### Steps

1. Checkout `claude/wave-6b-closure` from latest `main` AFTER Tasks 1–3 merge.

2. **Update `docs/audits/wave-1a/index.md`** — mark every Wave-6-free-tier finding as shipped (should cover all 6a + 6b by this point):
   - Prepend `✅`.
   - Set `Proposed wave` to `6a (shipped)` or `6b (shipped)` per the responsible sub-wave.
   - Append a `## Wave 6 closure` section summarizing: bundle budget + advisor lint from 6a; Edge Function caching + DB indexes + storage retention from 6b; 100-org projection deltas.

3. **Update `docs/architecture/frontend-architecture.md`** (brief — one section): mention the TTL cache's role in the free-tier posture; pointer to `docs/operations/edge-function-budget.md`.

4. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 6b backend free-tier guards

   Four PRs shipped:
   - Task 1: TTL caching on top-3 Edge Functions + edge-function-budget.md.
     Invocation projection (100 orgs): before N/mo → after M/mo (X% reduction).
   - Task 2: DB index migration (N indexes across M tables).
     Query time estimates: before N ms → after M ms on flagged hot paths.
   - Task 3: raw-imports retention cron (30-day daily).
     Storage projection (100 orgs): capped at N MB instead of unbounded.
   - Task 4: closure.

   Combined Wave 6 (6a + 6b) free-tier posture:
   - Bundle: main K KB gzipped / budget 300 KB.
   - Edge Functions: N invocations/mo / free-tier cap 500 K.
   - DB: current M MB / cap 500 MB.
   - Storage: capped at N MB / cap 1 GB.
   - Bandwidth: estimated M GB/mo / cap 100 GB.
   ```

5. Verification:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   npm run check:bundle
   npm run check:advisors
   npm run format -- docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md docs/architecture/frontend-architecture.md
   git status
   ```

6. Commit, push, open PR.

### Tests to add (Task 4)

- None.

### Out of scope (Task 4)

- Editing any `.claude/wave-*.md`.
- Archiving audit docs.

---

## Documentation Currency Pass

Handled across Tasks 1–4:
1. `docs/operations/edge-function-budget.md` (new — Task 1).
2. `docs/operations/storage-retention.md` (new — Task 3).
3. `docs/sql/reverts/*_drop_free_tier_indexes.sql` (Task 2).
4. `docs/sql/tests/free_tier_indexes_exist.sql` (Task 2).
5. `docs/audits/wave-1a/index.md` — Wave-6 findings shipped (Task 4).
6. `docs/expansion/98_PROGRESS_LOG.md` — dated entry (Task 4).
7. `docs/architecture/frontend-architecture.md` — brief cache mention (Task 4).

Task 3 ships no SQL migration, revert, or smoke (the cleanup is now a GitHub Actions + Node-script pairing, not a DB artifact).

Do NOT touch: `CLAUDE.md`, `docs/security/**`, `docs/testing/**`, any `.claude/wave-*.md`.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 4 tasks merged with CI green (including Wave 6a's new `check:bundle` + `check:advisors` steps).
2. `docs/operations/edge-function-budget.md` + `docs/operations/storage-retention.md` exist.
3. `supabase/migrations/` has exactly 1 new migration (indexes only — Task 3 uses GitHub Actions, not `pg_cron`).
4. `docs/sql/reverts/` has exactly 1 new revert script (index drop).
5. `docs/sql/tests/` has exactly 1 new smoke script (index presence).
6. `scripts/cleanup-raw-imports.js` + `.github/workflows/cleanup-raw-imports.yml` exist.
7. `SUPABASE_SERVICE_ROLE_KEY` is added as a GitHub repository secret before Task 3 can run end-to-end (documented in Task 3 PR body).
8. No new dep in `package.json`.
9. No new Edge Function.
10. **No new `pg_cron` job** (Task 3 now uses GitHub Actions). Existing `pg_cron` count unchanged.
11. No change to `playwright.config.ts`, `vitest.config.js`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
12. `npm run check:advisors` (Wave 6a) passes on `main` after Wave 6b merges — the new migration respects the advisor patterns.
13. `npm run check:bundle` (Wave 6a) passes on `main` — the Edge Function cache additions don't blow bundle.
14. `npm run test:e2e -- --workers=1` passing count matches post-Wave-5 baseline.
15. `docs/expansion/98_PROGRESS_LOG.md` entry documents the 100-org projection deltas for bundle / invocations / DB / storage.
16. **Test-impact reconciled**: tests added are Task 1's edge-cache integration tests (~6 cases) + Task 3's `cleanupRawImports.test.js` (~6 cases). Tasks 2 + 4 add 0 tests.

---

## Commit & Push to Main

1. Tasks 1–3 in any order.
2. Task 4 lands LAST.
3. After each merge: operator applies migrations to prod via the documented push flow.
4. After all 4 merge:
   ```bash
   git checkout main && git pull
   npm install
   npm run lint && npm run typecheck && npm run test && npm run frontend:build
   npm run check:bundle && npm run check:advisors
   ```
   All green. CI runs E2E; wait for green.
5. Post-deploy: run each task's smoke SQL in Supabase SQL editor. Confirm indexes, cron, and cache behavior.

---

## Verification Gate (Per Task, Before Push)

For Tasks 1, 2, 3:
```bash
npm run lint
npm run typecheck
npm run test
npm run frontend:build
npm run check:bundle
npm run check:advisors
git status
```
Each `FAIL → HALT`.

For Task 4:
```bash
# Same as above, plus formatters.
npm run format -- docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md docs/architecture/frontend-architecture.md
```

---

## Key References

- `CLAUDE.md` — §7 (Supabase), §11 (CI), §10 (Environment variables).
- `docs/audits/wave-1a/supabase-performance.md` — index audit source.
- `docs/audits/wave-1a/free-tier-usage.md` — budget projections source.
- `docs/operations/bundle-budget.md` (Wave 6a).
- `docs/operations/advisor-lint.md` (Wave 6a).
- `supabase/migrations/20260416000002_data_retention_cron.sql` — prior cron pattern.
- `frontend/src/lib/cache.js` (or wherever Phase 9's cache lives) — extension target for Task 1.
- `frontend/src/lib/supabaseClient.js` — caller integration points.

---

## Critical Files

**Will create**:
- `docs/operations/edge-function-budget.md` (Task 1)
- `docs/operations/storage-retention.md` (Task 3)
- `supabase/migrations/<YYYYMMDDHHMMSS>_add_free_tier_indexes.sql` (Task 2)
- `docs/sql/reverts/<YYYYMMDDHHMMSS>_drop_free_tier_indexes.sql` (Task 2)
- `docs/sql/tests/free_tier_indexes_exist.sql` (Task 2)
- `scripts/cleanup-raw-imports.js` (Task 3)
- `.github/workflows/cleanup-raw-imports.yml` (Task 3)
- `tests/cleanupRawImports.test.js` (Task 3)

**Will edit**:
- `frontend/src/lib/cache.js` (Task 1 — extend if needed; keep minimal)
- Call-site files for the top-3 hottest Edge Functions (Task 1 — 3 files max)
- Existing unit tests for the hooks that wrap those call sites (Task 1 — 3 test files max)
- `docs/audits/wave-1a/index.md` (Task 4)
- `docs/expansion/98_PROGRESS_LOG.md` (Task 4)
- `docs/architecture/frontend-architecture.md` (Task 4 — brief mention)

**Will NOT edit**:
- `CLAUDE.md`, any `.claude/wave-*.md`.
- `package.json`, `package-lock.json` (no new deps).
- `supabase/functions/**` (no Edge Function code changes).
- `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `tests/factories/**`, `tests/helpers/**`, `tests/setup.js` (Wave 3 froze).
- `docs/security/**`, `docs/testing/**`.
- Wave 6a's `scripts/check-bundle-size.js` / `scripts/advisor-lint.js` / `docs/operations/bundle-budget.md` / `docs/operations/advisor-lint.md`.

---

## Out of Scope This Wave (6b)

- Adding new Edge Functions.
- Removing Edge Functions.
- RPC signature changes.
- Schema changes beyond indexes.
- Data migrations / backfills.
- Retention on audit_log beyond current 180 days.
- User-facing "import history" UI.
- Email notifications of deletions.
- pgTAP wiring (Wave 7).
- CSP nonce migration (Wave 7).
- CDN configuration.
- Paid-tier planning.
- Service-role credentials in CI.

---

## Ground Rules

- **Every reduction is quantified**. Task 1 cites invocations before/after; Task 2 cites query-time before/after; Task 3 cites projected storage cap.
- **No new deps, no new Edge Functions, no new scheduled jobs beyond Task 3's single cron**.
- **Revert pairs mandatory**. Each migration ships with its revert script in `docs/sql/reverts/`.
- **Smoke scripts mandatory**. Each migration ships with a verification SQL in `docs/sql/tests/`.
- **Cache invariants**: cache keys include every input that would change the result; invalidation fires on any mutation. Wrong cache = subtle cross-org data leak — treat as a security bug.
- **Minimum-churn philosophy**. Task 1's TTL wrapping is 3 call-site diffs, not a framework refactor. Task 2 adds indexes; no query rewrites. Task 3 adds one cron; no storage structure changes.
- **Guardrails are prerequisites**: Wave 6a's `check:advisors` + `check:bundle` MUST pass on every PR in this wave. If they fail, fix the PR, don't bypass the gate.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task.
