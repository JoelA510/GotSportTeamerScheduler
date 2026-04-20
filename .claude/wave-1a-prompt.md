# Wave 1a — Repo-Wide Audit (READ-ONLY)

## Session Context

**Prior-wave recap**: First wave of the v1.0.1 hardening loop; no prior wave artifacts exist.

**Current state**: SquadLogic v1.0.0 is feature-complete (`package.json:3`). Phase 10 pre-flight certification closed on `590e391` (2026-04-17). `docs/expansion/NEXT_SESSION_PLAN.md` (2026-04-17) enumerates the immediate security-advisor backlog (1 ERROR + 4 WARNs). CI is green; CSP is enforcing (not report-only).

**Working tree**: Clean. Branch: `main`. Origin: `github.com/JoelA510/SquadLogic`.

**Test + lint baselines** (to be captured in Task 1 Step 3; do NOT assume numbers):
- Vitest files: expected ~50 passing across `tests/**/*.test.{js,jsx}` (excluding `tests/e2e/**`).
- Vitest suite: 100% pass.
- Playwright-BDD: baseline **40/63 passing** per `TEST_CHECKLIST.md:112` and `docs/expansion/98_PROGRESS_LOG.md`. Twenty-three known failures are pre-existing (selector drift, text expectations, calendar subscription modal, twins-RSVP, realtime chat). Wave 5 addresses them.
- ESLint: 0 errors, ≤7 pre-existing warnings tolerated (per wave-execution-protocol §4).
- Typecheck: 0 errors.
- `frontend:build`: clean.

**Operating mandate for v1.0.1**: every change must be compatible with a **free Supabase + free Vercel (Hobby)** setup. Treat monthly invocation limits, storage caps, bandwidth budgets, and the 7-day auto-pause as first-class constraints.

**Wave purpose**: This wave is **READ-ONLY**. No source code, no migrations, no config changes, no test edits. The output is a single consolidated findings artifact (`docs/audits/wave-1a/index.md`) plus four per-domain sub-reports. Wave 1b acts on those findings.

---

## Pre-flight Verification

Verify each fact assertion below. **HALT** on any false or ambiguous claim — do NOT auto-fix.

1. `package.json:3` declares `"version": "1.0.0"`.
2. `package.json` has the scripts `lint`, `typecheck`, `test`, `test:e2e`, `frontend:build`.
3. `vitest.config.js` coverage `include` contains `packages/core/src/**` and `frontend/src/hooks/**`.
4. `playwright.config.ts` sets `testDir` to the `.features-gen-local/` output directory and sources features from `tests/e2e/features/**/*.feature`.
5. `.github/workflows/ci.yml` exists and runs `typecheck → lint → test → frontend:build → test:e2e -- --workers=1` (in that order).
6. `vercel.json` exists.
7. `supabase/migrations/` exists and contains migration files.
8. `supabase/functions/` exists and contains at least: `calendar-feed`, `game-persistence`, `auto-scheduler`, `fairness-scoring`.
9. `docs/expansion/98_PROGRESS_LOG.md` exists; most recent entry is `2026-04-17`.
10. `docs/expansion/NEXT_SESSION_PLAN.md` exists and lists items §1.1, §2.1, §2.2, §2.3, §3.1.
11. `claude.md` (lowercase) exists at repo root. `git ls-files` shows it as `claude.md`. (Case-sensitive systems will see the lowercase form only; all references in this wave use the lowercase form.) <!-- wave-0 2026-04-20: drift — `CLAUDE.md` was added in commit 3e7888d before Wave 8 ran; both files currently coexist. Wave 1a is read-only so this does not block; Wave 8 still owns the cleanup. Re-verify at Wave 8 pre-flight. -->
12. `tests/setup.js` exists and imports `@testing-library/jest-dom`.
13. `docs/audits/` directory does NOT yet exist. (Task 1 creates it.)

If a migration file, Edge Function, or script has been renamed since this plan was written, **HALT** and surface — the audit targets must match reality.

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-1a-code-quality` → Task 1
  - `claude/wave-1a-security` → Task 2
  - `claude/wave-1a-supabase-performance` → Task 3
  - `claude/wave-1a-free-tier-usage` → Task 4
  - `claude/wave-1a-accessibility` → Task 4.5
  - `claude/wave-1a-consolidate` → Task 5 (lands LAST — depends on 1–4.5)

- Open a PR to `main` after each task's verification gate passes.
- **Do not push directly to `main`.** Task 5 lands after 1–4.5 are merged.

---

## Wave Scope

Audit the repo across five orthogonal domains and produce a consolidated severity-tagged findings index. Each of Tasks 1–4.5 contributes one sub-report under `docs/audits/wave-1a/`. Task 5 assembles the index and assigns each non-trivial finding to a target wave (2–9).

**No code changes. No migration changes. No test additions or modifications.** Wave 1b is the acting wave.

### Finding format (shared across all tasks)

Every finding in every sub-report must use this structure:

```markdown
### F-<task>-<NN>: <short title>

- **Severity**: P0-trivial | P1 | P2 | P3
- **Location**: `path/to/file.ext:LINE` (or directory pattern, or external system)
- **Observation**: what is observed (facts only, no speculation)
- **Impact**: what breaks, degrades, or costs money if left
- **Recommended fix**: concise action, ≤3 sentences
- **Proposed wave**: 1b-trivial | 2-security | 3-test-infra | 4-onboarding | 5-e2e | 6-free-tier | 7-db-test | 8-docs | 9-release
- **Effort**: XS (≤15 min) | S (≤1 h) | M (≤4 h) | L (≤1 day)
```

Severity guide:
- **P0-trivial**: safe, ≤15-minute fix with zero behavioral risk (typo, unused import, doc link, lint warning). Handled inline in Wave 1b.
- **P1**: user-facing correctness bug, security exposure, or free-tier cost overrun risk. Must ship in v1.0.1.
- **P2**: code smell, duplication, stale doc, test-fragility. Should ship in v1.0.1 if cheap.
- **P3**: nice-to-have. Defer to backlog unless it costs nothing.

---

## Task 1 — Code-Quality Audit

**Commit**: `chore(audit): wave-1a code-quality findings (task 1)`

**Branch**: `claude/wave-1a-code-quality`

**Output**: `docs/audits/wave-1a/code-quality.md` (new file)

### Steps

1. Checkout `claude/wave-1a-code-quality` from latest `main`. Confirm clean working tree.

2. **Capture baselines** — record actual numbers in the report:
   - `npm run lint 2>&1 | tail -5` → warning + error counts.
   - `npm run typecheck 2>&1 | tail -5` → error count.
   - `npm run test 2>&1 | tail -10` → suite/test counts, pass/fail.
   - `npm run test:coverage 2>&1 | tail -20` → statements/branches/functions/lines %.
   - `find tests -name "*.test.*" -not -path "*/e2e/*" | wc -l` → unit/integration test file count.
   - `find tests/e2e/features -name "*.feature" | wc -l` → E2E feature file count.
   - `npm run frontend:build 2>&1 | tail -20` → bundle sizes + build warnings.

3. **Scan `packages/core/src/**`** for:
   - Dead exports (exported but never imported outside their own file). Use `grep -rn "^export" packages/core/src/ | head -200` then spot-check consumers.
   - Duplicate helpers (e.g., date math, array dedup, slug generation) that predate a shared util.
   - Functions >60 lines without sub-helpers.
   - Files that import from `frontend/` (violates the pure-domain rule — should be zero).
   - TODO / FIXME / HACK comments.

4. **Scan `frontend/src/**`** for:
   - Components that import `@supabase/supabase-js` or `../lib/mockSupabaseClient.js` directly (should always route through `frontend/src/lib/supabaseClient.js`).
   - Pages NOT lazy-loaded in `App.jsx` (grep for `React.lazy` and cross-reference against `pages/` inventory).
   - Inline `style={...}` overrides that duplicate existing design tokens in `frontend/src/index.css`.
   - Hardcoded color hex values outside `index.css`.
   - `console.log` / `console.warn` that should route through `frontend/src/lib/logger.js`.
   - Components with >250 lines (split candidates).
   - Missing `data-testid` on interactive elements that E2E selectors would benefit from (cross-reference Wave 5 stabilization needs).

5. **Scan all `*.jsx` / `*.ts` / `*.js` files** for:
   - Unused imports / unused variables (should be 0 per ESLint warning baseline).
   - Functions without JSDoc types in `packages/core/src/**` (type coverage gap).
   - `any`-typed props or JSDoc `@param {*}` (type precision gap).

6. **Scan `supabase/functions/**`** for:
   - Shared utilities that could move to `_shared/`.
   - Functions without proper CORS headers (cross-reference `_shared/cors.ts` if present).
   - Synchronous loops over arrays that could be parallelized with `Promise.all`.

7. **Inventory ESLint warnings** — list every warning at the line-level (up to ~40 most impactful). Group by rule.

8. **Inventory TypeScript `strict: false` escape hatches** — note how many JSDoc `@ts-ignore` / `@ts-expect-error` comments exist and where.

9. **Draft `docs/audits/wave-1a/code-quality.md`** using the Finding format. Aim for 20–40 findings. Order by severity then by location. Include a `## Baselines` section at top with the captured numbers from Step 2.

10. Self-review: every finding has all eight required fields. Every `Proposed wave` is a valid wave number.

### Verification (Task 1)

- `npm run lint` — unchanged output from baseline.
- `npm run typecheck` — unchanged output from baseline.
- `npm run test` — unchanged output from baseline.
- `git status` — only `docs/audits/wave-1a/code-quality.md` added, nothing else.

Commit with the exact `Commit:` line above. Push branch. Open PR titled `chore(audit): wave-1a code-quality findings` with a one-paragraph summary + findings count by severity.

### Out of scope (Task 1)

- Fixing any finding inline. (Wave 1b acts.)
- Security findings (Task 2 owns these).
- DB schema findings (Task 3 owns these).
- Bundle-size or invocation-rate findings (Task 4 owns these).
- Adding new tests or modifying existing tests.

---

## Task 2 — Security Audit

**Commit**: `chore(audit): wave-1a security findings (task 2)`

**Branch**: `claude/wave-1a-security`

**Output**: `docs/audits/wave-1a/security.md` (new file)

### Steps

1. Checkout `claude/wave-1a-security` from latest `main`.

2. **Re-verify NEXT_SESSION_PLAN §1–3 items** against current state:
   - §1.1: `import_efficiency_metrics` view — query `pg_views` or `pg_proc` equivalent. Run `supabase db remote --db-url "$PROD_DB_URL" "SELECT schemaname, viewname, security_invoker FROM pg_views WHERE viewname = 'import_efficiency_metrics';"` if access available. Otherwise cite the plan doc verbatim and note "unverified against live DB — re-check in Wave 2 pre-flight".
   - §2.1: `raw-imports` storage bucket — check `supabase/migrations/` for the bucket creation DDL; cite the policy lines.
   - §2.2: Six functions missing `search_path` — list them. Confirm the names against `supabase/migrations/**/*.sql` (`get_reserved_keys`, `log_schema_change`, `validate_custom_attributes`, `check_password_length_on_auth_users`, `persist_evaluation_run`, `prune_old_evaluation_runs`).
   - §2.3: Leaked-password protection — dashboard toggle; record as "unverified without dashboard access; re-check in Wave 2 pre-flight."
   - §3.1: `VITE_SENTRY_DSN` — grep `frontend/src/` for Sentry init; confirm the SDK is installed (`@sentry/react` in `package.json:35`) but verify no env-var fallback hides a silent no-init path.

3. **RLS audit** — scan `supabase/migrations/**/*.sql` for:
   - Tables created without `ENABLE ROW LEVEL SECURITY`.
   - Policies that use `USING (true)` or `WITH CHECK (true)` (potential over-permissive grants).
   - Policies that reference `auth.uid()` without an `organization_id` join (potential cross-org read risk).
   - Any `CREATE OR REPLACE FUNCTION` with `SECURITY DEFINER` — list them; each needs `SET search_path=public` to avoid search-path injection.

4. **Secrets audit** — grep for patterns:
   - `SUPABASE_SERVICE_ROLE_KEY` / `service_role` in any file outside `.env.example`, `.env.test.example`, `.env.local.example`, `supabase/functions/**`, `docs/operations/ENVIRONMENT.md`.
   - `VITE_*` prefix on any secret-ish name (anything with `SECRET`, `PRIVATE`, `TOKEN`, `KEY` that isn't `SUPABASE_ANON_KEY`).
   - Hardcoded API keys, passwords, tokens in any committed file. Spot-check `.env.example` for accidental real values.

5. **CSP audit** — read `vercel.json`:
   - Confirm `Content-Security-Policy` is set (not Report-Only), verify directives.
   - Identify `'unsafe-inline'` occurrences. Note which directive.
   - Check `object-src`, `frame-ancestors`, `upgrade-insecure-requests`.

6. **Zod validation audit** — grep `frontend/src/**/*.jsx` and `packages/core/src/**` for state-persistence paths that skip Zod validation:
   - `.from('<table>').upsert(` → every occurrence should go through a Zod-validated path.
   - Supabase RPC calls that don't validate the payload before invocation.

7. **Audit log coverage** — search for `supabase.rpc('record_audit_event'` or `audit_log` writes. Cross-reference the list of state-altering operations (team save, import start, CSV ingestion, admin overrides, calendar token rotation, etc.) to flag any that DON'T append an audit entry.

8. **Session handling** — verify `mockSupabaseClient.js` session-storage design cannot leak across tests (check sessionStorage key namespacing).

9. **Dependency vuln audit** — `npm audit --production --json | head -100`. List high/critical findings. Do not run `npm audit fix` (Wave 1b may act).

10. **Draft `docs/audits/wave-1a/security.md`** using the Finding format. Structure:
    - `## Known gaps (NEXT_SESSION_PLAN.md §1–3)` — re-verified status of each item.
    - `## New findings` — everything else, grouped by category (RLS / Secrets / CSP / Zod / Audit log / Dependencies).
    - Aim for 10–25 findings.

11. Self-review: no finding proposes a fix that itself creates a security regression. Every proposed wave is 2-security, 7-db-test, or 1b-trivial (trivial only if the fix is a doc edit, not a code change).

### Verification (Task 2)

- `npm run lint`, `npm run typecheck`, `npm run test` — unchanged.
- `git status` — only `docs/audits/wave-1a/security.md` added.

### Out of scope (Task 2)

- Penetration testing.
- HSTS / CSP-Report-URI tuning beyond "what's there today".
- 2FA / TOTP design.
- Third-party audit.
- Fixing anything inline.

---

## Task 3 — Supabase Performance Audit

**Commit**: `chore(audit): wave-1a supabase performance findings (task 3)`

**Branch**: `claude/wave-1a-supabase-performance`

**Output**: `docs/audits/wave-1a/supabase-performance.md` (new file)

### Steps

1. Checkout `claude/wave-1a-supabase-performance` from latest `main`.

2. **Schema inventory** — list every migration file under `supabase/migrations/` with its purpose (1 line each). Note the total count; cite date prefixes.

3. **Index audit** — for each table created in `supabase/migrations/**/*.sql`:
   - List primary keys + unique constraints.
   - List explicit `CREATE INDEX` statements.
   - Cross-reference hot-path queries in `frontend/src/hooks/**` and `packages/core/src/**/persistence.js` (grep `.from(` and `.eq(` chains).
   - Flag any `.eq('organization_id', ...)` filter against a table without an index on `(organization_id)` or `(organization_id, …)` composite.
   - Flag any `.order('created_at')` without an index on `(created_at)` or `(<partition>, created_at)`.
   - Flag any `.eq('team_id', ...)` join against a table without an index on `team_id`.

4. **RPC inventory** — list every function in `supabase/migrations/**/*.sql` with:
   - Name, signature, return type, `SECURITY DEFINER` status, `SET search_path` presence.
   - Frontend callers (`grep -rn "supabase.rpc('<name>')" frontend/`).
   - Edge-Function callers (`grep -rn "<name>" supabase/functions/`).
   - Flag orphans (declared but never called).
   - Flag callers that don't check `.error` on the return value.

5. **Edge Function inventory** — list every directory under `supabase/functions/` with:
   - Entry file (`index.ts`).
   - External dependencies (imports).
   - Approximate LOC.
   - Expected monthly invocation volume (rough estimate based on feature usage — e.g., `calendar-feed` is per-subscriber-poll; `game-persistence` is per-admin-save; `auto-scheduler` is per-admin-run).
   - Memory footprint if documented; otherwise flag as "unmeasured".

6. **Query patterns** — scan for:
   - N+1 query patterns: a hook that runs a `.from(...)` inside a `useEffect` map/forEach loop.
   - Fetching full rows when only a few columns are needed (i.e. `.select('*')` when the caller uses 3 fields).
   - Unbounded queries: `.from(...).select()` without `.limit(...)` or pagination, against tables that grow with org count.
   - Realtime subscriptions (`supabase.channel(...)`): list them; note whether each unsubscribes on cleanup.

7. **Caching + TTL audit** — check `frontend/src/lib/` for any TTL cache (Phase 9 added one per `docs/expansion/98_PROGRESS_LOG.md`). Record the default TTL, what paths use it, what invalidation hooks fire. Note any cache that could serve stale data across an org-switch.

8. **Migration shape audit** — in `supabase/migrations/`:
   - Flag any migration that drops a column, drops a table, or renames without a compatibility shim.
   - Flag any migration named with placeholders (`XX_XX_*` or `TODO_*`).
   - Flag any migration whose filename date is in the future.

9. **`pg_cron` audit** — list all scheduled jobs (from migration DDL); note schedule + function it calls + retention semantics. Flag any job without an explicit `IF NOT EXISTS` guard on the job creation.

10. **Draft `docs/audits/wave-1a/supabase-performance.md`**. Structure:
    - `## Schema inventory` table (table name | row-growth driver | indexes | RLS on).
    - `## RPC inventory` table.
    - `## Edge Function inventory` table.
    - `## Findings` (Finding format).
    - Aim for 15–30 findings.

11. Self-review: every index recommendation cites the query pattern it accelerates. Every RPC orphan is verified (no caller found via `grep`).

### Verification (Task 3)

- `npm run lint`, `npm run typecheck`, `npm run test` — unchanged.
- `git status` — only `docs/audits/wave-1a/supabase-performance.md` added.

### Out of scope (Task 3)

- Running `EXPLAIN ANALYZE` against the live DB (requires access; defer to Wave 6).
- Migrating anything.
- Creating indexes. (Wave 6 acts.)
- Changing RPC signatures.

---

## Task 4 — Free-Tier Usage Audit

**Commit**: `chore(audit): wave-1a free-tier usage findings (task 4)`

**Branch**: `claude/wave-1a-free-tier-usage`

**Output**: `docs/audits/wave-1a/free-tier-usage.md` (new file)

### Steps

1. Checkout `claude/wave-1a-free-tier-usage` from latest `main`.

2. **Record free-tier caps** at the top of the report:
   - **Supabase Free**: 500 MB database, 1 GB file storage, 50 K MAU, 2 GB egress, 500 K Edge Function invocations/mo, 7-day auto-pause, 500 realtime msg/s, 200 concurrent connections.
   - **Vercel Hobby**: 100 GB bandwidth/mo, 10 s serverless-function timeout, 100 deployments/day.
   - **GitHub Actions Free**: 2,000 minutes/mo for private repos; unlimited for public.

3. **Bundle-size audit** — run `npm run frontend:build` and parse the `dist/` output:
   - `du -sh dist/` → total size.
   - `ls -lah dist/assets/ | head -30` → per-chunk sizes.
   - Compare against suggested budgets (main ≤300 KB gzipped, per-route lazy chunks ≤80 KB each).
   - Identify non-lazy-loaded pages (cross-reference with `App.jsx`).
   - Identify heavyweight dependencies in `package.json` (recharts, @sentry/react, @dnd-kit, etc.) — note gzipped sizes from bundle output.
   - Flag any dependency that ships >100 KB gzipped without being behind a dynamic import.

4. **Edge Function invocation estimate** — for each function in `supabase/functions/`:
   - Estimate monthly invocation floor per active org (e.g., `calendar-feed`: 1 ICS poll every 15 min × 4 subscribers × 30 days = ~11.5 K / org / month).
   - Sum across a 10-org projection and a 100-org projection.
   - Flag functions whose projected 100-org usage exceeds 50 K/mo (10% of the free-tier budget).

5. **Storage usage projection** — for each Supabase Storage bucket (`raw-imports`, plus any others in `supabase/migrations/` setup):
   - Ingress rate (bytes per import × imports per org per season).
   - Retention (if a cleanup cron exists; otherwise note "unbounded").
   - 100-org steady-state size.
   - Flag buckets whose 100-org projection exceeds 500 MB (50% of free-tier).

6. **DB size projection** — per high-growth table (`audit_log`, `scheduler_runs`, `team_players`, `players`, `evaluation_runs`, `game_slots`, `practice_assignments`, `calendar_subscriptions`, `team_chat_messages`, etc.):
   - Row size estimate (sum column sizes).
   - Rows per org per season.
   - 100-org steady-state.
   - Flag tables without a retention policy whose 100-org projection exceeds 100 MB.

7. **Bandwidth estimate** — per core page load:
   - Initial route (HTML + CSS + JS + fonts): use `npm run frontend:build` output.
   - Dashboard load (initial + API calls).
   - Schedule generation (RPC call + result size).
   - Project per-org monthly bandwidth at 30 sessions/user × 10 users/org; flag if 100-org projection > 50 GB (50% of Vercel free).

8. **Sentry quota** — note the free Sentry tier if `@sentry/react` is in use (5 K errors/mo). Flag any logging pattern that could flood Sentry (unfiltered `console.error` routes, catch-all handlers).

9. **Scheduled-job cost audit** — list every GitHub Actions workflow + every `pg_cron` job with its run frequency. Sum monthly minutes for private-repo cost awareness.

10. **Keepalive audit** — confirm `.github/workflows/` has the weekly Supabase keepalive cron (Mon 12:00 UTC). Verify it's minimal (single REST ping, not a full test suite run).

11. **Draft `docs/audits/wave-1a/free-tier-usage.md`**. Structure:
    - `## Caps & targets` table.
    - `## Bundle-size inventory` table.
    - `## Edge Function invocation projection` table.
    - `## Storage projection` table.
    - `## DB growth projection` table.
    - `## Bandwidth projection` table.
    - `## Findings` (Finding format).
    - Aim for 10–20 findings.

12. Self-review: every projection shows the arithmetic (not just the result). Every "Flag" item has a `Proposed wave` of `6-free-tier` or `1b-trivial`.

### Verification (Task 4)

- `npm run lint`, `npm run typecheck`, `npm run test` — unchanged.
- `git status` — only `docs/audits/wave-1a/free-tier-usage.md` added.

### Out of scope (Task 4)

- Fixing bundle sizes inline. (Wave 6.)
- Adding indexes, retention policies, or cleanup crons. (Wave 6.)
- Benchmarking against real production traffic (requires prod access).
- Paying for tier upgrades.

---

## Task 4.5 — Accessibility Audit (WCAG 2.2 AA)

**Commit**: `chore(audit): wave-1a accessibility findings (task 4.5)`

**Branch**: `claude/wave-1a-accessibility`

**Output**: `docs/audits/wave-1a/accessibility.md` (new file)

### Steps

1. Checkout `claude/wave-1a-accessibility` from latest `main`.

2. **Baseline review** — read these existing docs to avoid re-filing closed work:
   - `docs/ui/agent-ui-ux-guidelines.md` (canonical rules)
   - `docs/ui/ui-ux-pass.md` (P0/P1 checklist)
   - `docs/ui/ui-ux-pass-summary.md` (historical closure summary)
   - `docs/ui/ui-ux-polish.md` (P2 visual polish)
   - `docs/ui/ui-ux-rules.json` (rule IDs + severities)

   Record each rule ID's current baseline status at the top of the sub-report. Findings in this task flag **regressions against the baseline** or **gaps not previously surfaced** — not items the historical pass already closed.

3. **Static a11y scan of `frontend/src/**/*.jsx`** — flag:
   - `<img>` tags missing `alt`.
   - Icon-only `<button>` / `<Link>` wrapping a lucide-react `<Icon />` without `aria-label`, `title`, or `sr-only` text.
   - `<input>` / `<select>` / `<textarea>` without an associated `<label>` (wrapped or `htmlFor`).
   - Click handlers on non-interactive elements (`<div onClick>`, `<span onClick>`) lacking `role="button"` + `tabIndex` + keyboard handlers.
   - Custom interactive widgets missing `role` / `aria-expanded` / `aria-selected` / `aria-pressed` attributes.
   - Page components missing semantic landmarks (`<header>`, `<main>`, `<nav>`, `<footer>`).
   - Heading-level skips (`<h1>` then `<h3>` with no `<h2>`).
   - Error text not linked via `aria-describedby` on the offending field.
   - Missing `aria-live` region (`role="status"` / `role="alert"`) for async result announcements (toasts, loading states).
   - `<button>` elements without explicit `type=` (defaults to `submit` inside forms; footgun).

4. **Drag-and-drop keyboard fallback audit** — per `claude.md` §9.3:
   - Grep `useDraggable`, `useSortable`, `DndContext` in `frontend/src/`.
   - For every drop target, cite whether a non-drag alternative exists (context menu, "move to" selector, button, keyboard command palette). Missing fallback = P1.
   - @dnd-kit provides `screenReaderInstructions` + `announcements` props. For every `<DndContext>`, note whether these are configured. Missing announcements = P1.

5. **Focus management audit**:
   - Modals / dialogs without a focus trap (search for `<Dialog>`, `<Modal>`, custom overlay wrappers).
   - Focus-return on modal close (focus should return to the triggering element).
   - `tabIndex="-1"` on focusable content (trap risk).
   - Skip-to-content link on `DashboardLayout` or app-root.
   - Static focus-order audit of the import wizard and team-save flow (read the JSX in `frontend/src/pages/`/`components/` and trace the tab-order from source — runtime keyboard walks are out of scope).

6. **Color contrast audit** — read `frontend/src/index.css`:
   - For each theme (`[data-theme=dark]`, `[data-theme=light]`, `[data-theme=party]`, `[data-theme=club]`):
     - Resolve `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-text-accent`.
     - Resolve `--color-bg-app`, `--color-bg-surface`, `--color-bg-glass`.
     - Compute text-over-bg contrast ratios.
   - Flag any ratio below **4.5:1** for body text or **3:1** for large text / UI component boundaries (WCAG 2.2 AA).
   - `.glass-panel` / `.glass-panel-premium`: measure against the panel's **base background color** only. (The actual rendered contrast depends on `backdrop-filter` compositing against whatever sits under the panel, which can't be computed statically — call that out as a known static-audit limitation in the finding and defer runtime measurement to Wave 5's `@axe-core/playwright` integration.)

7. **Motion + reduced-motion audit**:
   - Grep `@media (prefers-reduced-motion)` across `frontend/src/`.
   - For each `@keyframes` / `animation:` / `transition:` rule, verify it respects `prefers-reduced-motion: reduce` OR is <5s AND non-essential.
   - Explicitly flag `.animate-pulseGlow`, `.animate-fadeIn`, `.animate-slideUp` if they lack a reduced-motion override.

8. **Document structure**:
   - Confirm `frontend/index.html` sets `<html lang="en">`.
   - Confirm route-specific `<title>` is set (grep `document.title =` or `useEffect` title setters — per-route titles improve screen-reader orientation).

9. **Form validation a11y** — for the top 3 forms (CSV upload, team save, admin override):
   - Validation errors render with `role="alert"` or `aria-live="polite"`.
   - Error text is programmatically linked to the field (`aria-describedby`).
   - Success states announce via `role="status"` (toast) or inline text.

10. **Cross-reference with `docs/ui/ui-ux-rules.json`** — for each rule where the current code drifts from the baseline status captured in Step 2, file a finding that cites the rule ID.

11. **Draft `docs/audits/wave-1a/accessibility.md`** using the Finding format. Structure:
    - `## Baseline (from docs/ui/)` — short summary of closed UI/UX work.
    - `## Scan results by category` — sub-headings for Semantic HTML / ARIA, DnD fallbacks, Focus management, Color contrast (per-theme table), Motion, Forms, Document structure.
    - `## Findings` — Finding format entries, grouped by category.
    - Aim for 10–25 findings.

12. Self-review: every contrast finding shows computed ratios; every DnD finding cites its fallback (or lack thereof); every `Proposed wave` is valid (most will be `5-e2e` for axe-core integration, `6-free-tier` if an asset optimization fixes it, `8-docs` for rule-doc refreshes, or `1b-trivial` for a comment/attribute add).

### Verification (Task 4.5)

- `npm run lint`, `npm run typecheck`, `npm run test` — unchanged.
- `git status` — only `docs/audits/wave-1a/accessibility.md` added.

### Out of scope (Task 4.5)

- Running `@axe-core/playwright` dynamically (Wave 5 integrates axe-core).
- Running a browser-driven keyboard walk (requires running the app).
- Running Lighthouse a11y scores (Wave 6 or 9).
- Fixing any a11y issue inline.
- Re-litigating items already closed in `docs/ui/ui-ux-pass-summary.md` — those are baseline.

---

## Task 5 — Consolidate + Prioritize Findings

**Commit**: `chore(audit): wave-1a consolidated findings index (task 5)`

**Branch**: `claude/wave-1a-consolidate`

**Output**: `docs/audits/wave-1a/index.md` (new file) + `docs/audits/wave-1a/README.md` (new file; points readers at the index)

**Depends on**: Tasks 1–4.5 merged to `main`.

### Steps

1. Checkout `claude/wave-1a-consolidate` from latest `main` AFTER Tasks 1–4.5 have merged. Verify all five sub-reports exist under `docs/audits/wave-1a/`: `code-quality.md`, `security.md`, `supabase-performance.md`, `free-tier-usage.md`, `accessibility.md`.

2. **Re-read each sub-report.** For every finding:
   - Assign a stable finding ID: `F-<task>-<NN>` (e.g., `F-1-03`, `F-2-07`). Preserve the IDs from the sub-reports where set.
   - Validate that `Proposed wave` maps to a wave in the current plan (`1b-trivial`, `2-security`, `3-test-infra`, `4-onboarding`, `5-e2e`, `6-free-tier`, `7-db-test`, `8-docs`, `9-release`).

3. **Build the distribution table** in `index.md`:

   ```markdown
   ## Distribution table

   | Finding | Severity | Title | Proposed wave | Effort |
   | --- | --- | --- | --- | --- |
   | F-1-01 | P1 | <title> | 3-test-infra | M |
   | …       |    |         |               |    |
   ```

   Sort by `Proposed wave`, then Severity, then Effort. Group visually by wave with `### Wave 1b-trivial` / `### Wave 2-security` / etc. sub-headings.

4. **Priority summary** — for each target wave (1b through 9), count findings by severity and include a one-paragraph "what this wave inherits from the audit" summary. This becomes the canonical reference each wave's pre-flight consults.

5. **Contradiction reconciliation** — if Tasks 1–4 surfaced overlapping findings (same file, same issue), merge them into a single canonical finding. Note the merge in an `## Audit log` section.

6. **Risk register** — the top 10 findings by severity×effort (P1 + XS/S first) surface in a `## Top-10 register` table at the top of `index.md`.

7. **Write `docs/audits/wave-1a/README.md`** (short, ~20 lines): explains the audit's scope, points at `index.md`, notes Wave 1b is the acting wave.

8. **Update `docs/README.md`** — add a single link to `docs/audits/wave-1a/` under a new `### Audits` sub-heading. Do NOT restructure `docs/README.md` beyond adding this one heading + link.

9. Self-review:
   - Every finding from every sub-report appears in the distribution table, exactly once.
   - No `Proposed wave` value is invalid.
   - The top-10 register is sorted sensibly.
   - `docs/README.md` rebuilds cleanly (prettier passes).

### Verification (Task 5)

- `npm run lint`, `npm run typecheck`, `npm run test` — unchanged.
- `git status` — only `docs/audits/wave-1a/index.md`, `docs/audits/wave-1a/README.md`, and `docs/README.md` changed.
- `npm run format -- docs/**/*.md` — prettier is happy.

### Out of scope (Task 5)

- Editing the sub-reports (if Task 1–4 reports need correction, open a follow-up PR against THAT task's owner; don't patch in this PR).
- Fixing any finding.
- Editing any wave plan (`.claude/wave-*.md`) to add inline "audit-driven" notes — Wave 1b handles plan edits if needed.

---

## Documentation Currency Pass

No architecture docs change in this wave — the audit is itself the documentation output.

Required edits at wave close (Task 5 or a standalone finalize PR):

1. `docs/README.md` — add `### Audits` sub-heading with link to `docs/audits/wave-1a/`.
2. `docs/expansion/98_PROGRESS_LOG.md` — append a `## 2026-04-<DD> — Wave 1a audit` entry that lists the 5 task PRs and the top-10 risk register.
3. `.claude/wave-1a-prompt.md` — leave unchanged (it's the spec).
4. **Do NOT** touch `claude.md`, architecture docs, or `NEXT_SESSION_PLAN.md` — Wave 1b and subsequent waves act on them.

---

## Wave Review (Mandatory Before Merge to Main)

Walk the checklist. Any "no" blocks push.

1. All 6 tasks merged with verification gates green (Tasks 1, 2, 3, 4, 4.5, 5).
2. `docs/audits/wave-1a/` contains exactly 5 sub-reports (`code-quality.md`, `security.md`, `supabase-performance.md`, `free-tier-usage.md`, `accessibility.md`), plus `index.md` (consolidated) and `README.md` (= 7 files total). No stray files.
3. Every finding in every sub-report uses the Finding format with all 8 fields.
4. Every `Proposed wave` value is a valid wave in the current plan.
5. `index.md` distribution table includes every finding from every sub-report exactly once.
6. Top-10 risk register is populated and sensibly ordered.
7. `docs/README.md` + `docs/expansion/98_PROGRESS_LOG.md` updated per Documentation Currency Pass.
8. No source-code file (`frontend/src/**`, `packages/core/src/**`, `supabase/functions/**`, `supabase/migrations/**`) was modified in this wave.
9. No test file was modified in this wave.
10. No dependency was added or removed.
11. **Test-impact reconciled**: baseline test/lint/typecheck/build numbers in Task 1's `## Baselines` section match the current main's numbers when Task 5 merges. If not, re-run and update — the baselines feed Wave 1b's "has anything regressed" check.
12. A "Wave 1b kickoff cheat sheet" appears at the bottom of `index.md` — lists every P0-trivial finding in a single fenced block so Wave 1b's operator can copy-paste into its pre-flight.

---

## Commit & Push to Main

1. Tasks 1–4.5 PRs can merge in any order (each is a single new file).
2. Task 5 PR merges last.
3. After all 6 merge:
   - `git checkout main && git pull`
   - `npm install`
   - `npm run lint && npm run typecheck && npm run test && npm run frontend:build` — all green.
   - `ls docs/audits/wave-1a/` — exactly 7 files.
   - If CI is green, wave is shipped.

---

## Verification Gate (Per Task, Before Push)

Run each command. **FAIL → HALT** per command.

```bash
npm run lint         # 0 errors; warning count unchanged from baseline
npm run typecheck    # 0 errors
npm run test         # 100% pass; count unchanged from baseline
npm run frontend:build   # clean
git status           # exactly the expected new file(s); no stray changes
```

For Task 5 also:
```bash
npm run format -- docs/**/*.md   # prettier passes
```

Do NOT run `npm run test:e2e` — it's expensive and not gated on for audit-only PRs. The CI pipeline runs it on merge.

---

## Key References

- `claude.md` — project conventions (§2 scope guardrails, §3 workflow, §4 architecture, §8 testing).
- `docs/expansion/03_ROADMAP.md` — completed milestone inventory.
- `docs/expansion/98_PROGRESS_LOG.md` — session log; append-only.
- `docs/expansion/NEXT_SESSION_PLAN.md` — immediate security backlog (Task 2 re-verifies).
- `docs/architecture/*.md` — SSoT per domain; Task 3 cross-references.
- `vercel.json` — CSP audit (Task 2).
- `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json` — baselines (Task 1).
- `.claude/wave-execution-protocol.md` — halt conditions (written after this wave; follow its spirit inline here).

---

## Critical Files

**Will edit**:
- `docs/README.md` (Task 5; adds one sub-heading + link)
- `docs/expansion/98_PROGRESS_LOG.md` (wave-close append)

**Will create**:
- `docs/audits/wave-1a/code-quality.md` (Task 1)
- `docs/audits/wave-1a/security.md` (Task 2)
- `docs/audits/wave-1a/supabase-performance.md` (Task 3)
- `docs/audits/wave-1a/free-tier-usage.md` (Task 4)
- `docs/audits/wave-1a/accessibility.md` (Task 4.5)
- `docs/audits/wave-1a/index.md` (Task 5)
- `docs/audits/wave-1a/README.md` (Task 5)

**Will NOT edit**:
- Any file under `frontend/src/`, `packages/core/src/`, `supabase/`, `scripts/`, `tests/`.
- `package.json`, `package-lock.json`, `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`.
- `.env.*`, `vercel.json`, `claude.md`, `README.md`, any `docs/architecture/*.md`.

---

## Out of Scope This Wave

- Any code change, including "trivial" fixes (those land in Wave 1b).
- Any migration.
- Any test addition, modification, or deletion.
- Any dependency update.
- Rewriting `claude.md` or rerouting the `CLAUDE.md`-vs-`claude.md` question (Wave 8).
- Running `npm audit fix`.
- Running `supabase db push` / `supabase functions deploy`.
- Wave 1b's action items.
- Any finding's actual remediation.
- External pen-test / vulnerability scanner runs against production.
- Lighthouse runs (Wave 6 or 9).
- OWASP Top 10 full audit doc (Wave 9).

---

## Ground Rules

- **Read-only discipline**: if the agent catches itself typing an `Edit` to a source file, it has drifted — `git checkout -- <file>` and re-center.
- **Cite every claim**: every finding cites a file path + line number OR an external system name. No hand-wavy "feels slow" or "should be better".
- **No speculation**: Observation is facts; Impact is the consequence of the fact. If a claim requires running a command the agent doesn't have access to (e.g., `EXPLAIN ANALYZE` against prod), say so explicitly and defer to the acting wave's pre-flight.
- **No proactive cleanup**: even if the agent sees a typo in a comment unrelated to the audit finding, it files a P0-trivial finding and keeps moving. Wave 1b sweeps.
- **Free-tier first**: every finding in Task 4 ends with a dollar-cost (or invocation-cost) estimate.
- **Conventional commits**: `chore(audit): ...` exactly, per the Commit line in each task.
- **Branch per task**; PR per task; merge task 5 last.
- **No `--no-verify` / `--force-push`** under any circumstance.
- **5-attempt debugging cap** on any single tool/command failure. If still stuck, surface findings in the PR body and STOP.
