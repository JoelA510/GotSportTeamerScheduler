[← Back to Documentation Index](docs/README.md)
---

# SquadLogic v1.0 — Production Cutover Runbook

**Date written:** 2026-04-01
**Last refreshed:** 2026-04-17
**Status at writing:** All systems green — 37 migrations applied, 7 Edge Functions ACTIVE, Vercel live
**Supabase project:** `mmwupqsjkikqzvmdvuzm` (us-west-2)
**Production URL:** https://squadlogic.vercel.app

> **2026-04-17 reconciliation note:** Smoke checks on 2026-04-17 surfaced that prod was ~10 days behind disk — the three 2026-04-16 migrations (`security_hardening`, `initialize_new_tenant`, `data_retention_cron`) were pending, `rotate_calendar_token(uuid)` was missing (prod had a stale `refresh_calendar_token` body against a non-existent `integrations` table), and the `auto-scheduler` + `fairness-scoring` Edge Functions were undeployed. All five gaps were closed during that session via MCP (see `docs/expansion/98_PROGRESS_LOG.md` row `PROD-RECONCILE`). Open advisor items at that time: 1 ERROR (`public.import_efficiency_metrics` as `SECURITY DEFINER` view) + 4 WARN categories; see `docs/expansion/NEXT_SESSION_PLAN.md` for the cleanup plan. `VITE_SENTRY_DSN` is still not set in Vercel prod — production errors are not flowing to Sentry until that's wired and a redeploy is triggered.

---

## System State Checklist (confirm before launch)

| System              | Expected state                                                                      | How to verify                                                    |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Vercel deployment   | `READY` on `main`                                                                   | https://vercel.com/secureyourtech/squadlogic                     |
| Vercel env vars     | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set, `VITE_USE_MOCK_SUPABASE` absent | Vercel dashboard → Settings → Environment Variables              |
| Supabase project    | `ACTIVE_HEALTHY`                                                                    | Supabase dashboard or MCP `get_project`                          |
| Database migrations | 37 applied, no pending                                                              | Supabase dashboard → Database → Migrations                       |

Roles and their permissions are defined in `frontend/src/constants/permissions.js`.

---

## Monitoring

**Daily (first two weeks):**

- Supabase dashboard → Reports → API requests. Look for spikes in 4xx/5xx.
- Supabase dashboard → Database → Connection pooling. Free tier limit is 60 direct connections.

**Free-tier keep-alive:**
Supabase pauses free-tier projects after 7 days of inactivity. Add a scheduled keep-alive ping to prevent this. In the GitHub Actions CI workflow (`.github/workflows/ci.yml`), add a cron trigger:

```yaml
on:
  schedule:
    - cron: '0 12 * * 1' # Every Monday at noon UTC
```

With a job that simply hits the Supabase health endpoint:

```yaml
jobs:
  keepalive:
    runs-on: ubuntu-latest
    steps:
      - run: curl -sf https://mmwupqsjkikqzvmdvuzm.supabase.co/rest/v1/ \
               -H "apikey: ${{ secrets.VITE_SUPABASE_ANON_KEY }}" || true
```

---

## Operational Policies (Data Retention & Rate Limiting)

**Data Retention (`pg_cron`)**
As part of the final production cutover, automated `pg_cron` jobs run nightly natively inside the Supabase Postgres instance to prune outdated records and conserve database space:
- `export_jobs` older than 7 days are deleted at 2:00 AM.
- `staging_players` older than 30 days are deleted at 3:00 AM.
- `audit_log` records older than 180 days are deleted at 4:00 AM.

*Verification Steps:*
1. Ensure the `pg_cron` extension is enabled in the Supabase Dashboard (Database → Extensions).
2. Run `SELECT * FROM cron.job;` in the Supabase SQL Editor to verify the jobs are actively scheduled.

**Rate Limiting**
Intensive Edge Functions like the `auto-scheduler` are guarded by a sliding-window rate limiter. This restricts individual users (default 60 requests / minute) using highly accurate rolling timestamp arrays. Hitting this limit yields a `429 Too Many Requests` response along with a `retry_after_ms` field based on the oldest request in the current sliding window.

*Verification Steps:*
1. Navigate to the Vercel dashboard → Settings → Environment Variables.
2. Verify that the rate-limiting configuration variables required by the Edge Functions are present and correctly mapped to the `Production` branch.
3. Verify there are no connection errors to the rate-limiting store in the logs.

---

## Rollback procedure

If a critical issue is discovered post-launch, the app can be rolled back to mock mode in under 5 minutes — no database changes required.

**To roll back to mock mode:**

1. Go to Vercel dashboard → squadlogic project → Settings → Environment Variables.
2. Add: `VITE_USE_MOCK_SUPABASE` = `true` (Production environment only).
3. Go to Deployments → click the last known-good deployment → "Promote to Production" (instant, no rebuild).

Users will see the mock client with seed data. No real data is lost. The Supabase project remains untouched.

**To re-enable the live backend:**

1. Remove the `VITE_USE_MOCK_SUPABASE` env var from Vercel.
2. Trigger a new deployment (push any trivial commit, or use Vercel's "Redeploy" button).

---

## What does NOT need a runbook step

- **Migrations** — all 37 are already applied to the production database (including the three 2026-04-16 entries: `20260416000000_security_hardening`, `20260416000001_initialize_new_tenant`, `20260416000002_data_retention_cron`).
- **Edge Functions** — all 7 are already deployed and ACTIVE (`auto-scheduler`, `calendar-feed`, `fairness-scoring`, `game-persistence`, `import-validation`, `practice-persistence`, `team-persistence`).
- **Vercel connection** — already connected to GitHub; auto-deploys on every push to `main`.
- **SSL/TLS** — handled by Vercel and Supabase automatically.
- **CORS** — the Supabase project's allowed origins are managed in the Supabase dashboard → Settings → API → CORS. Add `https://squadlogic.vercel.app` if not already present.
