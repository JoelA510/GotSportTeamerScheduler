# SquadLogic Production Readiness Plan

> Generated 2026-04-12 | All 63 E2E tests passing | Deployed on Vercel + Supabase

---

## 1. Critical (Must Fix Before Launch)

### 1.1 RLS Security Gaps — 15 Tables Lack Org-Scoped Policies

The following tables use admin-only RLS policies that check role but **not organization membership**. An authenticated admin from Org A could access Org B's data.

**Tables requiring org-scoped RLS:**
`field_subunits`, `practice_slots`, `game_slots`, `team_players`, `practice_assignments`, `games`, `staging_players`, `player_buddies`, `scheduler_runs`, `evaluation_criteria`, `evaluation_scores`, `evaluation_sessions`, `export_jobs`, `email_log`

**Fix:** Add `organization_id` column where missing, then replace each table's policy with:
```sql
CREATE POLICY "org_member_access" ON <table>
  USING (is_org_member(organization_id));
```

### 1.2 Registration Policies Reference Non-Existent Table

`registration_forms` and `registrations` policies check against `organization_roles` (doesn't exist). Should reference `organization_members`.

**Fix:** New migration to `DROP POLICY` and recreate with correct table reference.

### 1.3 Edge Functions Bypass RLS via Service Role Key

All 7 Edge Functions use `SUPABASE_SERVICE_ROLE_KEY`, bypassing RLS entirely. Only `team-persistence` validates org membership before writes. The others do not.

**Functions requiring org membership validation:**
- `game-persistence`
- `practice-persistence`
- `import-validation`
- `auto-scheduler`
- `fairness-scoring`
- `calendar-feed` (uses token auth — verify token belongs to requesting org)

**Fix:** Add org membership check after JWT validation in each function:
```typescript
const { data: membership } = await supabase
  .from('organization_members')
  .select('role')
  .eq('organization_id', orgId)
  .eq('profile_id', user.id)
  .single();
if (!membership) return new Response('Forbidden', { status: 403 });
```

### 1.4 NPM Dependency Vulnerabilities

6 known vulnerabilities (4 high, 2 moderate):
- `react-router` — CSRF/XSS
- `rollup` — path traversal
- `flatted` — prototype pollution
- `ajv`/`minimatch` — ReDoS

**Fix:** `npm audit fix` and upgrade affected packages.

### 1.5 Server-Side CSV Validation

All CSV parsing, normalization, and type checking happens client-side. The `import-validation` Edge Function exists but isn't enforced as a mandatory gate.

**Fix:** Make the frontend call `import-validation` before writing to the `imports` table. Reject writes that haven't passed server-side validation.

---

## 2. High Priority (Before Real Users)

### 2.1 Connect Real Supabase

The app already supports real Supabase — the mock client is only for E2E tests.

**Steps:**
1. Create a Supabase project (or use existing one)
2. Run all 34 migrations: `supabase db push` or apply via Dashboard SQL editor
3. Optionally run `supabase/seed.sql` for demo data
4. Deploy Edge Functions: `supabase functions deploy`
5. Set `SUPABASE_SERVICE_ROLE_KEY` as a secret in Supabase Edge Functions
6. Set environment variables in Vercel:
   - `VITE_SUPABASE_URL` — Project URL from Supabase Dashboard
   - `VITE_SUPABASE_ANON_KEY` — anon key from Supabase Dashboard
   - Remove or unset `VITE_USE_MOCK_SUPABASE`

**Safety guard:** The app already refuses to start in mock mode on production domains.

### 2.2 Rate Limiting on Edge Functions

No rate limiting exists. A single user could overwhelm `auto-scheduler` (CPU-intensive hill climbing) or persistence endpoints.

**Fix:** Add a simple token-bucket or sliding-window check at the start of each Edge Function, keyed by user ID or IP.

### 2.3 Production Logging

Verbose `console.log` statements throughout the frontend. The `logger` module exists but isn't gated on environment.

**Fix:** Gate logger output on `import.meta.env.PROD` — suppress debug/info in production, keep warn/error.

---

## 3. Free Tier Optimization

### 3.1 Supabase Free Tier (500 MB Postgres, 1 GB Storage)

| Constraint | Current Status | Mitigation |
|---|---|---|
| **7-day idle pause** | Weekly keep-alive cron in GitHub Actions (Monday noon UTC) | Already implemented, must stay active |
| **500 MB Postgres** | Schema is lean (~40 KB seed data) | Data retention policies exist (audit logs: 180 days). Add cleanup for `export_jobs` and `staging_players` |
| **1 GB Storage** | CSV exports stored in Supabase Storage | Auto-delete exports after 24-48 hours via scheduled cleanup |
| **Edge Function limits** | 7 functions deployed, invoked on-demand | No cron-based Edge Functions, low risk |
| **Auth email limits** | ~4 emails/hour on free tier | Configure custom SMTP for password resets if user base grows |

### 3.2 Vercel Free Tier

No concerns for typical league sizes (< 500 players):
- Static SPA deployment (no serverless functions on Vercel)
- Code splitting via `React.lazy()` already implemented
- Vite tree-shaking optimizes bundle size

### 3.3 Recommended Cleanup Jobs

Add a weekly GitHub Actions job (or Supabase pg_cron if available):
```sql
-- Delete export jobs older than 7 days
DELETE FROM export_jobs WHERE created_at < NOW() - INTERVAL '7 days';

-- Delete staging players older than 30 days
DELETE FROM staging_players WHERE created_at < NOW() - INTERVAL '30 days';

-- Delete audit logs older than 180 days
DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '180 days';
```

---

## 4. Nice-to-Have Before Launch

| Item | Why | Effort |
|---|---|---|
| Configure Sentry DSN | Error tracking in production (`VITE_SENTRY_DSN` already wired) | Low |
| Enforce CSP header | Currently `Content-Security-Policy-Report-Only` — switch to enforcing | Low |
| Custom SMTP for auth | Supabase free tier has limited email sends | Medium |
| Database backups | Free tier has no automatic backups; schedule `pg_dump` via GitHub Actions | Medium |
| Monitoring dashboard | Set up BetterStack or Supabase Dashboard alerts for error rates | Medium |

---

## 5. Architecture Summary

```
Vercel (Static SPA)
  └── React 19 + Vite 6
       ├── AuthContext (Supabase Auth + JWT)
       ├── OrganizationContext (multi-tenant)
       ├── ImportContext (CSV ingestion)
       └── supabaseClient.js (auto-switches real/mock)

Supabase
  ├── PostgreSQL (34 migrations, RLS enabled)
  ├── Auth (email/password, magic links)
  ├── Storage (CSV exports, backups)
  └── Edge Functions (7)
       ├── auto-scheduler (practice optimization)
       ├── team-persistence (roster saves)
       ├── practice-persistence
       ├── game-persistence
       ├── calendar-feed (public ICS)
       ├── import-validation (CSV validation)
       └── fairness-scoring (metrics)
```

---

## 6. Priority Order Checklist

- [ ] Fix 15 tables' RLS + registration policy table reference (SQL migrations)
- [ ] Add org membership validation to all Edge Functions
- [ ] `npm audit fix` for dependency vulnerabilities
- [ ] Enforce server-side CSV validation
- [ ] Deploy migrations + Edge Functions to real Supabase project
- [ ] Set production env vars in Vercel
- [ ] Add rate limiting to Edge Functions
- [ ] Gate production logging
- [ ] Set up storage/data cleanup jobs
- [ ] Configure Sentry for error tracking
- [ ] Enforce CSP header
- [ ] Configure custom SMTP for auth emails
- [ ] Set up database backup strategy
