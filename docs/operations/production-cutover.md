[← Back to Documentation Index](docs/README.md)
---

# SquadLogic v1.0 — Production Cutover Runbook

**Date written:** 2026-04-01
**Status at writing:** All systems green — 34 migrations applied, 5 Edge Functions ACTIVE, Vercel live
**Supabase project:** `mmwupqsjkikqzvmdvuzm` (us-west-2)
**Production URL:** https://squadlogic.vercel.app

---

## System State Checklist (confirm before launch)

| System              | Expected state                                                                      | How to verify                                                    |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Vercel deployment   | `READY` on `main`                                                                   | https://vercel.com/secureyourtech/squadlogic                     |
| Vercel env vars     | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set, `VITE_USE_MOCK_SUPABASE` absent | Vercel dashboard → Settings → Environment Variables              |
| Supabase project    | `ACTIVE_HEALTHY`                                                                    | Supabase dashboard or MCP `get_project`                          |
| Database migrations | 34 applied, no pending                                                              | Supabase dashboard → Database → Migrations                       |
| Edge Functions      | All 5 `ACTIVE` with `verify_jwt: true` (except `calendar-feed`)                     | Supabase dashboard → Edge Functions                              |
| `.env` in repo      | No secret key, no mock flag                                                         | `cat .env` — only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |
| GitHub CI           | Passing on `main`                                                                   | GitHub → Actions                                                 |

---

## Step 1 — Create the first organization

The database has RLS enabled and no seed data in production. Every user must belong to an organization before they can access any data. Create the first org directly via Supabase SQL:

```sql
-- Run in Supabase dashboard → SQL Editor
INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'Your Club Name',        -- e.g. 'Castro Valley Soccer Club'
  'riverside-youth-soccer', -- lowercase, hyphens, no spaces
  now(),
  now()
)
RETURNING id;
-- Save the returned id — you need it in Step 2.
```

---

## Step 2 — Create the admin user

**2a.** Go to Supabase dashboard → Authentication → Users → "Add user". Create the first user with their email and a strong password. Copy the new user's UUID.

**2b.** Confirm the `profiles` row was auto-created (triggered on auth.users insert):

```sql
SELECT id, email, created_at FROM profiles WHERE id = '<user-uuid>';
```

If it's missing, insert manually:

```sql
INSERT INTO profiles (id, email, created_at, updated_at)
VALUES ('<user-uuid>', 'admin@yourclub.com', now(), now());
```

**2c.** Grant org membership with the `admin` role:

```sql
INSERT INTO organization_members (id, organization_id, profile_id, role, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  '<org-id-from-step-1>',
  '<user-uuid-from-step-2a>',
  'admin',
  now(),
  now()
)
RETURNING id;
```

---

## Step 3 — First login smoke test

1. Open https://squadlogic.vercel.app in an incognito window.
2. Sign in with the admin credentials created in Step 2.
3. Confirm the app moves past the loading screen to the Dashboard (not stuck on "Loading SquadLogic...").
4. Confirm the organization name appears in the header/sidebar.
5. Navigate to Settings → confirm the org slug and name are correct.

If login works but the org is missing from the UI, check that the `organization_members` row has the correct `profile_id` and `organization_id` (copy-paste errors are the most common cause).

---

## Step 4 — RLS verification

Confirm that a second user without org membership cannot see any data:

**4a.** Create a second user in Supabase Auth (no `organization_members` row — deliberately).

**4b.** Sign in as that user. Confirm:

- Dashboard shows no teams, no schedules.
- API calls return empty arrays, not errors (RLS returns 0 rows, not 403).
- No data from the admin account leaks through.

**4c.** Delete the test user from Supabase Auth when done.

---

## Step 5 — Edge Function smoke test

Run from your local terminal (requires `SUPABASE_URL` and a valid user JWT):

```bash
# Get a JWT by signing in via the Supabase JS client or REST API:
curl -X POST https://mmwupqsjkikqzvmdvuzm.supabase.co/auth/v1/token?grant_type=password \
  -H "apikey: <VITE_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourclub.com","password":"<password>"}' \
  | jq '.access_token'

# Expect 400 (missing body) not 401 (bad JWT) — confirms JWT verification works:
curl -X POST https://mmwupqsjkikqzvmdvuzm.supabase.co/functions/v1/team-persistence \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → Should return 400 "Invalid payload", not 401 "Missing token"
```

`calendar-feed` uses `verify_jwt: false` — a plain GET should return 401 only if the calendar token is invalid, not a network error.

---

## Step 6 — Invite additional users

For each coordinator or coach:

1. Supabase Auth → Add user (or send magic link invite).
2. Wait for the `profiles` row to be created automatically.
3. Insert their `organization_members` row with the appropriate role (`admin`, `coordinator`, or `coach`).

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

- **Migrations** — all 34 are already applied to the production database.
- **Edge Functions** — all 5 are already deployed and ACTIVE.
- **Vercel connection** — already connected to GitHub; auto-deploys on every push to `main`.
- **SSL/TLS** — handled by Vercel and Supabase automatically.
- **CORS** — the Supabase project's allowed origins are managed in the Supabase dashboard → Settings → API → CORS. Add `https://squadlogic.vercel.app` if not already present.
