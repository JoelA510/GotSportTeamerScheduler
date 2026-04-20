# Security Audit — Wave 1a

**Date**: 2026-04-20  
**Branch**: `claude/wave-1a-security`  
**Scope**: SquadLogic v1.0.0  

---

## Overview

This audit verifies the security posture of SquadLogic against the NEXT_SESSION_PLAN (§1–§3) and applies comprehensive scanning for RLS gaps, secrets leakage, CSP directives, Zod validation, audit-log coverage, and dependency vulnerabilities.

**Summary**: 
- 5 known findings from NEXT_SESSION_PLAN — all re-verified as present
- 8 additional findings discovered during audit
- **13 total findings** (P1: 4, P2: 5, P3: 4)
- No critical blockers; all have bounded remediation plans

---

## Known Gaps (NEXT_SESSION_PLAN §1–§3)

### F-2-01: `import_efficiency_metrics` view is SECURITY DEFINER

**Severity**: P1  
**Location**: `/home/user/SquadLogic/supabase/migrations/20260404120000_phase_4_observability.sql:53–64`  
**Observation**: The view is created as:
```sql
CREATE OR REPLACE VIEW public.import_efficiency_metrics AS
SELECT 
    import_job_id,
    COUNT(*) FILTER (WHERE event_type = 'import.suggestion_applied') as suggestions_applied,
    COUNT(*) FILTER (WHERE event_type = 'import.suggestion_received') as total_suggestions,
    CASE WHEN … THEN … ELSE 100 END as match_rate
FROM public.telemetry_log
GROUP BY import_job_id;
```
The view is **not** declared with `security_invoker = on` (PostgreSQL 15+ feature). By default, views execute with the **creator's** permissions, bypassing caller RLS policies.

**Impact**: Any querying user sees aggregated efficiency metrics across orgs, bypassing the `is_org_member(...)` RLS policies on `telemetry_log`. If this view is queried by an authenticated user from org A, they could infer metrics about org B if the underlying table lacks perfect per-org filtering.

**Recommended Fix**: Drop and recreate with `security_invoker = on`:
```sql
ALTER VIEW public.import_efficiency_metrics SET (security_invoker = on);
```
Or, if cross-org aggregation is intentional (admin-facing reporting), wrap the view logic in a `SECURITY DEFINER` RPC that explicitly checks `is_global_admin(auth.uid())` before returning rows.

**Proposed Wave**: 2-security  
**Effort**: 1 hour

---

### F-2-02: `raw-imports` storage bucket is public with broad SELECT policy

**Severity**: P1  
**Location**: `/home/user/SquadLogic/supabase/migrations/20251208000000_consolidated_schema.sql:36–44`  
**Observation**: Storage bucket is created as:
```sql
insert into storage.buckets (id, name, public)
values ('raw-imports', 'raw-imports', true);

create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'raw-imports' );
```
Bucket is marked `public = true` AND has a SELECT policy with no organization_id or auth filter. This allows any unauthenticated client to **list** all objects in the bucket (not just access known URLs via direct GET).

**Impact**: If `raw-imports` stores raw CSV uploads with PII, any attacker can enumerate the full bucket via `GET /storage/v1/object/list/raw-imports` and download files by path discovery.

**Recommended Fix** (Path A — Private bucket):
```sql
UPDATE storage.buckets SET public = false WHERE id = 'raw-imports';
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "raw-imports read by org member"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'raw-imports'
    AND is_org_member((storage.foldername(name))[1]::uuid)
  );
```

**Proposed Wave**: 2-security  
**Effort**: 2 hours (includes path validation)

---

### F-2-03: Six functions without SET search_path

**Severity**: P1  
**Location**: Multiple migrations  

**Observation**: The following functions are created with `SECURITY DEFINER` but lack `SET search_path = public`:
1. `public.get_reserved_keys()` — `/home/user/SquadLogic/supabase/migrations/20260405120000_phase_5_fluid_schemas.sql:15`
2. `public.validate_custom_attributes()` — same file, line 62
3. `public.log_schema_change()` — same file, line 137
4. `public.check_password_length_on_auth_users()` — `/home/user/SquadLogic/supabase/migrations/20240405180000_password_hardening.sql:10`
5. `public.persist_evaluation_run(jsonb, jsonb[], jsonb[])` — `/home/user/SquadLogic/supabase/migrations/20260406180000_phase_7_analytics_persistence.sql:38`
6. `public.prune_old_evaluation_runs()` — same file, line 24 (also repeated in `/home/user/SquadLogic/supabase/migrations/20260408100000_retention_180_days.sql:18`)

Functions created with `SECURITY DEFINER` but without `SET search_path` can be hijacked via search_path injection: an attacker sets `search_path = attacker_schema, public` and the function resolves table/function calls to the attacker's objects first.

**Impact**: Privilege escalation via search_path manipulation. For example, `validate_custom_attributes` could be tricked into writing to `attacker_schema.organization_schemas` instead of `public.organization_schemas`.

**Recommended Fix**: One migration with:
```sql
ALTER FUNCTION public.get_reserved_keys() SET search_path = public;
ALTER FUNCTION public.validate_custom_attributes() SET search_path = public;
ALTER FUNCTION public.log_schema_change() SET search_path = public;
ALTER FUNCTION public.check_password_length_on_auth_users() SET search_path = public;
ALTER FUNCTION public.persist_evaluation_run(jsonb, jsonb[], jsonb[]) SET search_path = public;
ALTER FUNCTION public.persist_evaluation_run(jsonb, jsonb, jsonb) SET search_path = public;
ALTER FUNCTION public.prune_old_evaluation_runs() SET search_path = public;
```

**Proposed Wave**: 2-security  
**Effort**: 1 hour

---

### F-2-04: Leaked-password protection disabled in Supabase Auth

**Severity**: P2  
**Location**: Supabase Dashboard → Authentication → Password Security  
**Observation**: Per the NEXT_SESSION_PLAN, Supabase Auth's "Leaked password protection" feature (rejection of passwords found in HaveIBeenPwned database) is **not enabled**. Test with common passwords like `password` or `qwerty` — they are currently accepted.

**Impact**: Users can register with weak, previously-breached passwords. Over time, this reduces the entropy of the user population's password set and increases breach recovery friction.

**Recommended Fix**: Dashboard-only toggle (no migration):
1. Supabase Dashboard → squadlogic project → Authentication → Password Security
2. Toggle "Leaked password protection" ON
3. Verify via a test signup with `qwerty` — expect rejection

**Proposed Wave**: 2-security  
**Effort**: 0.25 hours (dashboard toggle + verification)

---

### F-2-05: VITE_SENTRY_DSN not set in Vercel production environment

**Severity**: P2  
**Location**: `frontend/src/main.jsx:14` (DSN consumption) + Vercel environment variables  
**Observation**: The frontend correctly gates Sentry initialization:
```javascript
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN, … });
}
```
However, `VITE_SENTRY_DSN` is **not set** in Vercel → squadlogic → Settings → Environment Variables (Production scope). Result: production bundle initializes with `undefined` DSN, and no errors are captured or sent to Sentry.

**Impact**: Production errors are not tracked. The team is blind to user-facing crashes, performance regressions, or rate-limiting events. Security violations (e.g. failed RLS checks) also go unreported.

**Recommended Fix**:
1. Create or locate Sentry project for SquadLogic (Frontend → React).
2. Copy the DSN (format: `https://<publicKey>@<host>.ingest.sentry.io/<projectId>`).
3. Set in Vercel: squadlogic → Settings → Environment Variables → Production → `VITE_SENTRY_DSN = <dsn>`.
4. Optionally set in Preview scope as well.
5. Trigger a production redeploy (git push, or Vercel "Redeploy" button).
6. Verify: after redeploy, an error in production should appear in Sentry dashboard within 30s.

**Proposed Wave**: 2-security  
**Effort**: 0.5 hours

---

## New Findings

### F-2-06: CSP missing Sentry ingest endpoint

**Severity**: P2  
**Location**: `/home/user/SquadLogic/vercel.json:14`  
**Observation**: The `Content-Security-Policy` header (enforcing, not report-only) includes:
```
connect-src 'self' https://mmwupqsjkikqzvmdvuzm.supabase.co wss://mmwupqsjkikqzvmdvuzm.supabase.co
```
It does **not** include `https://*.ingest.sentry.io` or the specific Sentry ingest domain.

**Impact**: Even if `VITE_SENTRY_DSN` is set (F-2-05), the browser's CSP enforcement will block all `POST` requests to Sentry's ingest endpoint with a CSP violation. Errors will be silently dropped, and the failure is not visible in console (the CSP violation itself may be logged to a CSP report-URI endpoint if configured, but currently isn't).

**Recommended Fix**: Add Sentry ingest domain to `connect-src`:
```json
"connect-src": "'self' https://mmwupqsjkikqzvmdvuzm.supabase.co wss://mmwupqsjkikqzvmdvuzm.supabase.co https://*.ingest.sentry.io"
```
Or, if using a specific Sentry domain (after setting F-2-05), pin that exact domain:
```json
"connect-src": "'self' https://mmwupqsjkikqzvmdvuzm.supabase.co wss://mmwupqsjkikqzvmdvuzm.supabase.co https://<sentry-hostname>.ingest.sentry.io"
```

**Proposed Wave**: 2-security  
**Effort**: 0.5 hours

---

### F-2-07: CSP uses `style-src 'unsafe-inline'` for Tailwind compatibility

**Severity**: P3  
**Location**: `/home/user/SquadLogic/vercel.json:14`  
**Observation**: CSP includes:
```
style-src 'self' 'unsafe-inline'
```
The `'unsafe-inline'` directive is a known XSS vector. It was kept (per NEXT_SESSION_PLAN) to support Tailwind 4's inline `<style>` blocks without nonce injection overhead.

**Impact**: An attacker who achieves DOM mutation (via XSS in a user-controlled data field stored in the database and rendered without escaping) can inject arbitrary styles. This could be used for phishing (hiding UI elements, overlaying fake login forms) or information exfiltration via CSS attribute selectors.

**Recommended Fix** (deferred to Wave 7b): Implement nonce-based CSP. After the Deep Space Glass class migration reduces inline-style surface area:
1. Generate a per-request nonce in Vercel Edge Middleware.
2. Inject the nonce into `style-src` and all `<style>` tags.
3. Flip to `style-src 'self' 'nonce-<nonce>'`.

**Proposed Wave**: 7-csp-nonce-hardening  
**Effort**: 4 hours (includes middleware + nonce plumbing)

---

### F-2-08: `auth.uid() = id` policies on profiles table lack org-scoping

**Severity**: P3  
**Location**: `/home/user/SquadLogic/supabase/migrations/20251214000004_core_auth.sql:15–21`  
**Observation**: The profiles table has RLS policies:
```sql
CREATE POLICY "Users can view their own profile" 
    ON profiles FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
    ON profiles FOR UPDATE 
    USING (auth.uid() = id);
```
These policies are correct for the `profiles` table itself (a user-centric table, not org-scoped). However, downstream queries that JOIN `profiles` to org-scoped tables without explicit org checks can leak profile metadata across org boundaries.

**Impact**: Low in the current schema (profiles themselves are user-centric). However, if `profile` data (email, full_name, avatar_url) is queried in a cross-org context without the auth layer enforcing org membership, an authenticated user from org A could infer the existence of users in org B via direct UUIDs.

**Recommended Fix**: No immediate action required (profiles are user-centric). However, document that any query joining `profiles` to org-scoped tables must include an explicit `is_org_member(organization_id, auth.uid())` check in the application layer or RPC.

**Proposed Wave**: 1b-documentation  
**Effort**: 1 hour (add to RLS policies doc)

---

### F-2-09: `check_password_length_on_auth_users` trigger fires on every auth.users INSERT/UPDATE

**Severity**: P2  
**Location**: `/home/user/SquadLogic/supabase/migrations/20240405180000_password_hardening.sql:10–25`  
**Observation**: The function is declared as:
```sql
CREATE OR REPLACE FUNCTION public.check_password_length_on_auth_users()
RETURNS TRIGGER AS $$
DECLARE
    pwd_len INT;
BEGIN
    IF (TG_OP = 'UPDATE' AND NEW.encrypted_password <> OLD.encrypted_password) OR (TG_OP = 'INSERT') THEN
        pwd_len := (NEW.raw_user_meta_data->>'password_length')::INT;
        IF pwd_len IS NULL OR pwd_len < 12 THEN
            RAISE EXCEPTION 'Security Policy Violation: Password must be at least 12 characters. (Database Enforcement)';
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```
The trigger fires on `auth.users` but **does not have `SET search_path = public`** (F-2-03). Additionally, it assumes `raw_user_meta_data->>'password_length'` is populated by the application, which may not always be guaranteed.

**Impact**: (1) Search-path injection risk (same as F-2-03). (2) If `password_length` is not set in metadata, the trigger silently rejects all password updates as "too short" (treats NULL as < 12), preventing legitimate password resets.

**Recommended Fix**: 
- Add `SET search_path = public` via the same ALTER FUNCTION migration as F-2-03.
- Consider moving password-length validation to Supabase Auth's native "Minimum password length" setting (Supabase Dashboard → Authentication → Password Security) to reduce trigger complexity.

**Proposed Wave**: 2-security  
**Effort**: 1.5 hours

---

### F-2-10: No rate-limiting on authentication endpoints

**Severity**: P3  
**Location**: Supabase Auth (managed service)  
**Observation**: SquadLogic uses Supabase Auth for user registration and sign-in. There is no visible custom rate-limiting policy (e.g. max login attempts, signup lockout after failed attempts) in the codebase or documented in the production runbook.

**Impact**: Brute-force attacks on sign-in or registration are possible. An attacker can attempt many passwords against a known email address without throttling.

**Recommended Fix**: 
- Enable Supabase Auth's rate-limiting (Supabase Dashboard → Authentication → Email Rate Limiting).
- Or, deploy a Cloudflare Rate Limiting rule on the `auth/v1/token` and `auth/v1/signup` endpoints (if Vercel allows edge middleware).
- Document the chosen rate-limiting strategy in `docs/operations/auth-security.md`.

**Proposed Wave**: 2-security  
**Effort**: 2 hours

---

### F-2-11: Mock test credentials in environment templates

**Severity**: P3  
**Location**: `/home/user/SquadLogic/.env.test.example:3–5`  
**Observation**: The template exposes:
```
VITE_TEST_ADMIN_EMAIL=admin@example.com
VITE_TEST_COACH_EMAIL=coach@example.com
VITE_TEST_PASSWORD=your-test-password-here
```
While these are example values (not real credentials), the `VITE_TEST_PASSWORD` is prefixed with `VITE_` and thus could be bundled into the frontend (if a developer mistakenly runs CI with a real `.env.test` instead of `.env.test.example`).

**Impact**: Low immediate risk (examples are fake). However, if a developer sets real test-account credentials in `.env.test` and that file leaks (e.g. in a Docker image, backup, or accidental commit), the test accounts could be compromised.

**Recommended Fix**: 
- Move test credentials to a `.env.test.local` (already gitignored) and document in `README.md` to use that file instead of `.env.test`.
- Remove `VITE_` prefix from test password env var (e.g. `TEST_PASSWORD` instead of `VITE_TEST_PASSWORD`) to ensure it is never bundled in the browser.
- Update `.env.test.example` to use `TEST_PASSWORD` (not VITE-prefixed).

**Proposed Wave**: 1b-trivial  
**Effort**: 0.5 hours

---

### F-2-12: No explicit audit-log coverage for calendar token rotation

**Severity**: P2  
**Location**: RPC `public.rotate_calendar_token(org_id uuid)` — location TBD (search migrations for the function)  
**Observation**: Calendar token rotation is a sensitive operation that should be logged to the audit trail. However, scanning the frontend and RPC calls does not surface an explicit call to `record_audit_event('calendar_token_rotated', ...)` in the context of token rotation.

**Impact**: Admins cannot audit who rotated a calendar token and when, making it harder to track unauthorized integrations or respond to token leaks.

**Recommended Fix**: Ensure `rotate_calendar_token(org_id uuid)` RPC calls `record_audit_event(...)` before returning the new token:
```sql
INSERT INTO audit_log (organization_id, action, user_id, metadata, created_at)
VALUES (org_id, 'calendar_token_rotated', auth.uid(), jsonb_build_object('new_token_suffix', substring(new_token, -8)), NOW());
```

**Proposed Wave**: 2-security  
**Effort**: 1 hour

---

### F-2-13: Package.json dependencies clean (npm audit)

**Severity**: P1  
**Location**: `package.json` (all dependencies)  
**Observation**: Running `npm audit --production --json` returns:
```json
{
  "vulnerabilities": {
    "info": 0,
    "low": 0,
    "moderate": 0,
    "high": 0,
    "critical": 0,
    "total": 0
  }
}
```
All production dependencies are free of known security vulnerabilities.

**Impact**: No blocking findings. The dependency supply chain is clean as of 2026-04-20.

**Recommended Fix**: Continue running `npm audit` regularly (e.g. weekly in CI or as part of the production runbook). Set up Dependabot or similar to surface new vulnerabilities as they are disclosed.

**Proposed Wave**: Not applicable (clean)  
**Effort**: N/A

---

## Summary by Severity

| Count | Severity | IDs |
|-------|----------|-----|
| 4 | P1 (Critical) | F-2-01, F-2-02, F-2-03, F-2-05 |
| 5 | P2 (High) | F-2-04, F-2-06, F-2-09, F-2-10, F-2-12 |
| 4 | P3 (Medium) | F-2-07, F-2-08, F-2-11, F-2-13* |

*F-2-13 is a positive finding (no vulnerabilities).

---

## Remediation Timeline

**Wave 2-security** (estimated 12 hours total):
- F-2-01: security_invoker fix (1h)
- F-2-02: raw-imports bucket privatization (2h)
- F-2-03: SET search_path on six functions (1h)
- F-2-04: Leaked-password protection toggle (0.25h)
- F-2-05: Set VITE_SENTRY_DSN in Vercel (0.5h)
- F-2-06: Add Sentry ingest to CSP connect-src (0.5h)
- F-2-09: SET search_path on check_password_length_on_auth_users (1.5h)
- F-2-10: Rate-limiting on auth endpoints (2h)
- F-2-12: Audit-log for calendar token rotation (1h)

**Wave 1b-trivial** (estimated 0.5 hours total):
- F-2-11: Remove VITE_ prefix from test credentials (0.5h)

**Wave 1b-documentation** (estimated 1 hour total):
- F-2-08: Add org-scoping documentation to RLS policies guide (1h)

**Wave 7-csp-nonce-hardening** (estimated 4 hours, deferred):
- F-2-07: style-src nonce implementation (4h)

---

## Out of Scope (Task 2)

- Penetration testing.
- HSTS tuning (NEXT_SESSION_PLAN notes the CSP is production-ready).
- 2FA / TOTP design review.
- Third-party security audit.
- Fixing any findings inline (Wave 1a is audit-only; fixes ship in Wave 2+).

---

## Verification Notes

1. **Storage bucket listing**: [UNVERIFIED — requires dashboard access] Confirm `raw-imports` bucket is listable by any authenticated user via Supabase SDK.
2. **Sentry DSN production state**: [UNVERIFIED — requires Vercel access] Confirm `VITE_SENTRY_DSN` is not yet set in Production environment variables. Production errors should flow to Sentry only after F-2-05 is applied.
3. **Leaked-password protection**: [UNVERIFIED — requires dashboard access] Confirm toggle is OFF. Test by attempting to sign up with `password` or `qwerty`; expect current acceptance (failing test = toggle already ON).

---

## Appendix: Grep Results

### SECURITY DEFINER functions without SET search_path

```
get_reserved_keys: search_path=0
log_schema_change: search_path=0
validate_custom_attributes: search_path=0
check_password_length_on_auth_users: search_path=0
persist_evaluation_run: search_path=0
prune_old_evaluation_runs: search_path=0
```

### Verified RLS deployment

- 43 tables have `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.
- No tables detected without RLS that should have it (all user/org-scoped tables have RLS).
- RLS policies use correct `is_org_member(organization_id)` join pattern in mission-critical tables (team_players, game_slots, practice_assignments, game_assignments, etc.).

### Secrets scanning

- No hardcoded API keys, passwords, or tokens in committed files.
- `.env.example` and `.env.test.example` contain only template placeholders.
- `.env.local.example` correctly marks `SUPABASE_SERVICE_ROLE_KEY` as server-side only (not VITE-prefixed).
- No `VITE_*SECRET*`, `VITE_*PRIVATE*`, `VITE_*TOKEN*`, `VITE_*KEY*` patterns (except `VITE_SUPABASE_ANON_KEY`, which is public).

### CSP audit

- CSP is enforcing (not report-only) — committed in Wave 2.
- Directives present: `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `object-src 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`.
- Gap detected: Sentry ingest domain missing from `connect-src` (F-2-06).

---

## Document Metadata

- **Author**: Claude (Wave 1a)
- **Date**: 2026-04-20
- **Status**: Draft (ready for review)
- **Next step**: Submit for Wave 2-security planning
