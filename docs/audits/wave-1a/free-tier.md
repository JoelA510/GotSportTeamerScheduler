# Wave 1a Task 4 — Free-Tier Usage Audit

**Date**: 2026-04-20
**Scope**: bundle sizes, Edge Function frequency/caching, storage retention, DB usage, CI minute consumption.
**Operating mandate**: every change must be compatible with free Supabase + free Vercel (Hobby). Treat monthly invocation limits, storage caps (1 GB), DB caps (500 MB), bandwidth budgets (100 GB/mo Vercel), and 7-day auto-pause as first-class constraints.

---

## Baselines

### Bundle (post-`npm run frontend:build`, gzipped)

| Chunk | Raw | Gzip |
| --- | --- | --- |
| `index.js` (main) | 373.07 KB | **115.67 KB** |
| `chart-vendor` | 417.60 KB | **119.92 KB** |
| `supabase-vendor` | 191.92 KB | 49.93 KB |
| `react-vendor` | 49.65 KB | 17.41 KB |
| `dnd-vendor` | 49.77 KB | 16.53 KB |
| `lucide-vendor` | 31.04 KB | 6.68 KB |
| `index.css` | 117.36 KB | 17.82 KB |
| `logo_draft_modern-u4WitXVO.png` | 452.30 KB | n/a |
| Total first-paint (main + react + supabase + css) | ~683 KB | ~201 KB |

### Edge Functions (`supabase/functions/`)

`auto-scheduler`, `calendar-feed`, `fairness-scoring`, `game-persistence`, `import-validation`, `practice-persistence`, `team-persistence` (7 total).

### Storage / DB

- Existing TTL cache util: `frontend/src/lib/cache.js`.
- `audit_log` retention: 180 days (per `20260408100000_retention_180_days.sql` + `20260409000000_audit_log_retention_180.sql`).
- `pg_cron` cleanup jobs (export_jobs / staging_players / audit_log) shipped 2026-04-16 in `20260416000002_data_retention_cron.sql`.
- `raw-imports` storage bucket: NO retention cleanup (Wave 6b owns).

### CI

- `.github/workflows/ci.yml` runs on every PR (typecheck → lint → test → build → e2e). No path filters; full matrix on all PRs including doc-only.

---

## Findings

### F-4-01: Main bundle exceeds 100 KB gzip first-paint target

- **Severity**: P1
- **Location**: `frontend/dist/assets/index-*.js` (115.67 KB gzip)
- **Observation**: The main entry chunk gzips to 115.67 KB. Vite build also flags `ThemeToggle.jsx` as both dynamically imported (App.jsx) and statically imported (DashboardLayout.jsx) — dynamic import does NOT move it into a separate chunk.
- **Impact**: Slow first paint on mobile / low-bandwidth. Vercel Hobby bandwidth (100 GB/mo) ≈ 870K user-visits at this size; tighter budget is achievable.
- **Recommended fix**: Stop importing `ThemeToggle` from `DashboardLayout.jsx` (move to App-level lazy boundary OR drop the static import). Audit `frontend/src/App.jsx` for any other route NOT wrapped in `React.lazy`. Lazy-load `react-router` route handlers. Target ≤ 100 KB gzip for `index.js`.
- **Proposed wave**: 6a-bundle (Wave 6a's `check-bundle-size.js` will catch future regressions; the fix itself is part of preparing Wave 6a's baseline)
- **Effort**: S

### F-4-02: `chart-vendor` chunk is 120 KB gzip — heaviest chunk

- **Severity**: P1
- **Location**: `frontend/dist/assets/chart-vendor-*.js`
- **Observation**: 417.60 KB raw (119.92 KB gzip). This is the single largest first-paint-eligible chunk and dominates initial load.
- **Impact**: Charts are likely only used on `AnalyticalDashboard`, `EnterpriseDashboard`, `TeamAnalysisPage` — not the main dashboard or login. Loading them on every page wastes bandwidth.
- **Recommended fix**: Verify `chart-vendor` is route-split (only loaded on chart-using pages). If currently loaded eagerly via vendor manifest, switch to dynamic `import()` from the chart-using components only. Consider replacing chart library with a smaller alternative (Chart.js → uPlot or apexcharts-lite) if route splitting alone doesn't get below 50 KB gzip.
- **Proposed wave**: 6a-bundle
- **Effort**: S (route split) or M (library swap)

### F-4-03: Logo asset is 452 KB unoptimized PNG

- **Severity**: P1
- **Location**: `frontend/dist/assets/logo_draft_modern-*.png` (452.30 KB)
- **Observation**: A single brand asset is larger than the entire main JS bundle. PNG is not optimized; no WebP fallback, no `<picture>` element with size variants.
- **Impact**: First-paint cost; bandwidth waste; mobile slow on cold cache. 452 KB × every cold-cache visit = ~226 GB/mo bandwidth at 500K visits.
- **Recommended fix**: Convert to WebP + provide `srcset` variants (256w, 512w, 1024w). Replace usages with a `<picture>` block. Aim for ≤ 50 KB total per logo render.
- **Proposed wave**: 6a-bundle
- **Effort**: S

### F-4-04: No TTL cache on Edge Functions

- **Severity**: P1
- **Location**: `supabase/functions/calendar-feed/**`, `supabase/functions/fairness-scoring/**`, `supabase/functions/auto-scheduler/**`
- **Observation**: `grep -rn "Cache\|cache"` against the calendar-feed and fairness-scoring functions returns NO matches. Each invocation re-runs cold. `frontend/src/lib/cache.js` exists for the client-side but no edge-side cache wrapper is present.
- **Impact**: `calendar-feed` is called by every iCal subscriber's client (hourly per Apple/Google calendar default) — no cache means N invocations per hour where N = # subscribed devices. Free-tier Supabase Edge Functions cap is 500 K invocations/mo (~16K/day). At 100 orgs × 10 coaches × hourly poll = 24K/day → over budget within a week.
- **Recommended fix**: Add a `Deno.openKv()` or memory-LRU TTL wrapper on the top-3 hottest functions (`calendar-feed`, `fairness-scoring`, one TBD). 5-minute TTL on calendar-feed; 1-minute TTL on fairness-scoring. Wave 6b owns this.
- **Proposed wave**: 6b-edge
- **Effort**: M

### F-4-05: `raw-imports` storage bucket has no retention

- **Severity**: P2
- **Location**: `supabase/storage`, `raw-imports` bucket
- **Observation**: `grep -rn "raw-imports\|cleanup"` against `.github/workflows/` and `scripts/` returns no scheduled cleanup. Raw CSV uploads accumulate indefinitely.
- **Impact**: Free-tier storage cap is 1 GB. At ~1 MB per CSV × 100 orgs × monthly imports × 12 months = ~1.2 GB/yr — caps within first year.
- **Recommended fix**: Add a `.github/workflows/cleanup-raw-imports.yml` daily scheduled job that deletes files > 30 days old via the Storage API. Document the policy in `docs/operations/storage-retention.md`.
- **Proposed wave**: 6b-storage
- **Effort**: S

### F-4-06: CI runs full matrix on every PR (incl. doc-only)

- **Severity**: P2
- **Location**: `.github/workflows/ci.yml`
- **Observation**: No `paths:` / `paths-ignore:` filters on the workflow's `pull_request` trigger. Doc-only PRs (`.claude/`, `docs/`) trigger the full typecheck + lint + test + build + e2e suite.
- **Impact**: GitHub Actions free-tier cap is 2000 min/mo. E2E alone runs ~5 min × 21 features. A 50-PR/month cadence with 30% being doc-only = 15 wasted runs × ~10 min = 150 min wasted/mo (7.5% of cap).
- **Recommended fix**: Add `paths-ignore: ['.claude/**', 'docs/**', '*.md']` to the `pull_request` trigger. Keep a separate doc-only sanity job (markdown lint) on those paths.
- **Proposed wave**: 6a-bundle (or its own infra task)
- **Effort**: XS

### F-4-07: No bundle-size check in CI

- **Severity**: P2
- **Location**: `.github/workflows/ci.yml`, no `scripts/check-bundle-size.js`
- **Observation**: The build step runs but the resulting bundle sizes are not asserted against any budget. Future PRs can silently grow the bundle.
- **Impact**: Allows regression of F-4-01/F-4-02 fixes; bundle bloat drift over time.
- **Recommended fix**: Wave 6a's `scripts/check-bundle-size.js` + `config/bundle-budget.json` script. Run after `npm run frontend:build`. Fail CI if any chunk exceeds budget.
- **Proposed wave**: 6a-bundle
- **Effort**: S (this is exactly what Wave 6a Task 1 ships)

### F-4-08: `audit_log` retention not yet verified in prod

- **Severity**: P2
- **Location**: `supabase/migrations/20260408100000_retention_180_days.sql`, `20260416000002_data_retention_cron.sql`
- **Observation**: Migrations enable a 180-day retention policy and a `pg_cron` cleanup job. `OPS-CUTOVER` progress-log entry confirms the cron is scheduled in prod. But no observability — no Supabase dashboard alert if the job stops running, no test that verifies row count drops nightly.
- **Impact**: Silent failure leads to `audit_log` table growing unbounded → DB cap breach.
- **Recommended fix**: Add a daily `cron.job_run_details` query to a Supabase advisor doc that operator checks during weekly smoke. Long-term: an Edge Function that emails on miss. (Not blocking but worth documenting.)
- **Proposed wave**: 6b-storage (paired with the cleanup-raw-imports cron observability)
- **Effort**: XS (doc) or M (Edge Function)

### F-4-09: `pg_cron` jobs added without `IF NOT EXISTS` guard

- **Severity**: P2
- **Location**: `supabase/migrations/20260416000002_data_retention_cron.sql:8-26` (cross-ref: supabase-performance.md F-3-10)
- **Observation**: Cross-cutting with the Supabase performance audit. The three cleanup jobs do not use `IF NOT EXISTS` or `cron.unschedule(...)` first; re-running the migration would duplicate them and silently double-delete each night.
- **Impact**: Free-tier risk only if the migration re-runs (unlikely on prod but possible during local dev / branch reset). Not a current cost issue but a stability risk.
- **Recommended fix**: Wrap each `cron.schedule(...)` call in a `DO $$ BEGIN IF NOT EXISTS ...` block, or add a corrective follow-up migration that deduplicates. Wave 2 if treated as security hardening; Wave 6b otherwise.
- **Proposed wave**: 6b-storage
- **Effort**: XS

### F-4-10: `staging_players` rows not cleaned per import

- **Severity**: P3
- **Location**: `supabase/migrations/**` (search for `staging_players`)
- **Observation**: `staging_players` is a write buffer for CSV imports. The 2026-04-16 retention cron cleans rows > 30 days old, but does NOT clean rows immediately after the import succeeds. Stale staging rows accumulate within the 30-day window.
- **Impact**: Minor — bounded growth, not unbounded. No immediate cost issue.
- **Recommended fix**: Add a post-import RPC that deletes staging rows for the completed import. Defer to v1.1 unless storage usage trends up.
- **Proposed wave**: 6b-storage (or skip)
- **Effort**: S

### F-4-11: Vercel preview deployments on every PR

- **Severity**: P3
- **Location**: `vercel.json`, Vercel project settings (not in repo)
- **Observation**: Vercel auto-deploys preview environments on every PR push. Bandwidth + build minutes are billable on Hobby for excess.
- **Impact**: Minor — Hobby includes generous preview budget. Watch for trip if PR cadence increases significantly.
- **Recommended fix**: Configure preview deploys only for PRs labeled `preview` (Vercel project setting, not a code change). Defer until budget pressure surfaces.
- **Proposed wave**: 6a-bundle (operator action; tracked as doc note)
- **Effort**: XS (operator action only)

---

## Summary

| Severity | Count |
| --- | --- |
| P1 | 4 |
| P2 | 5 |
| P3 | 2 |
| **Total** | **11** |

| Proposed wave | Count |
| --- | --- |
| 6a-bundle | 5 |
| 6b-edge | 1 |
| 6b-storage | 5 |

No `1b-trivial` findings: every free-tier finding requires either a config change, a migration, or a script — all above the trivial bar.

Top 3 priorities for Wave 6a/6b execution:

1. **F-4-04** — Edge Function TTL cache (cost-blocking at scale).
2. **F-4-01 + F-4-02** — Bundle budget enforcement + chart-vendor route split.
3. **F-4-05** — `raw-imports` retention cron (storage cap risk).
