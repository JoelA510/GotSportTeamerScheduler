# SquadLogic Security Audit & Remediation Plan

**Date:** March 24, 2026
**Auditor:** Joel A. (with Claude Opus 4.6 automated review)
**Scope:** React/Vite frontend, Supabase backend (Auth, RLS, Storage, Edge Functions), agentic architecture (Ingestion, Formation, Scheduling)
**Codebase Revision:** Current `main` as of 2026-03-24

---

## Executive Summary

SquadLogic has a **solid architectural foundation** for security. RLS is enabled on every table, the multi-tenancy migration pipeline has progressively tightened access from role-only checks to organization-scoped `is_org_member()` enforcement, and the Edge Functions validate JWTs and use Zod schema parsing for payloads.

However, the audit identified **3 Critical, 4 High, 6 Medium, and 4 Low** findings that together create a layered risk surface. The most urgent issues are: (1) Edge Functions using the service role key to bypass the very RLS policies they depend on, (2) several tables with stale admin-only policies that were never upgraded to organization-scoped checks, and (3) a CSV ingestion pipeline that performs all validation client-side with no server-side enforcement.

Importantly, no real PII (birth certificates, government IDs, payment data) is stored, per project guardrails. The PII at risk is limited to names, emails, phone numbers, and guardian contact info—standard contact data for youth sports. The threat model centers on **cross-tenant data leakage (IDOR)**, **schedule integrity**, and **account impersonation**, not financial fraud or identity theft.

### Tool Execution Summary

| Tool                | Result                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit`         | **6 vulnerabilities** (2 moderate, 4 high) — `react-router` CSRF/XSS (CVE), `rollup` path traversal, `flatted` prototype pollution, `ajv`/`minimatch` ReDoS |
| `semgrep`           | Could not execute (proxy blocked `semgrep.dev` config download from sandbox)                                                                                |
| `gitleaks`          | Not available in sandbox; manual review performed                                                                                                           |
| Manual secrets scan | `.env` contains service role key and test credentials; `.env` is in `.gitignore` and was **never committed** to git history                                 |

---

## Categorized Findings

### CRITICAL (Immediate Action Required)

#### C-1: Edge Functions Bypass RLS via Service Role Key

**Risk:** All four Edge Functions (`team-persistence`, `game-persistence`, `practice-persistence`, `calendar-feed`) initialize the Supabase client with `SUPABASE_SERVICE_ROLE_KEY`. This key bypasses all Row Level Security. While the functions validate the user's JWT and check their role against an allowlist, they **do not verify organization membership**. An authenticated user with an `admin` role in Organization A could theoretically modify data belonging to Organization B.

**Files:**

- `supabase/functions/team-persistence/index.ts` (line 28)
- `supabase/functions/game-persistence/index.ts` (line 76)
- `supabase/functions/practice-persistence/index.ts` (line 80)
- `supabase/functions/calendar-feed/index.ts` (line 34)

**Attack Vector:** Authenticated admin crafts a POST request targeting team/game/practice IDs belonging to a different organization. The service role client executes the write without RLS enforcement.

**Usability Impact of Fix:** Invisible. The fix adds an organization membership check inside the Edge Function before any write. No user-facing behavior changes. Requests that were previously legitimate remain legitimate; only cross-org attacks are blocked.

---

#### C-2: Multiple Tables Lack Organization-Scoped RLS Policies

**Risk:** The unified RLS remediation (migration `20260310000002`) correctly added `is_org_member(organization_id)` policies to `teams`, `players`, `divisions`, `coaches`, and `locations`. However, the following tables still use the original admin-only policies from `20251208000000` that check **only** `app_metadata.role = 'admin'` with **no organization scope**:

| Table                   | Current Policy                         | Risk                          |
| ----------------------- | -------------------------------------- | ----------------------------- |
| `field_subunits`        | Admin role only, no org check          | Cross-org field data leakage  |
| `practice_slots`        | Admin role only, no org check          | Cross-org schedule visibility |
| `game_slots`            | Admin role only, no org check          | Cross-org game data leakage   |
| `team_players`          | Admin role only, no org check          | Cross-org roster leakage      |
| `practice_assignments`  | Admin + coach (own team), no org check | Cross-org practice data       |
| `games`                 | Admin role only, no org check          | Cross-org game results        |
| `staging_players`       | Admin role only, no org check          | Cross-org import data         |
| `player_buddies`        | Admin role only, no org check          | Cross-org social data         |
| `scheduler_runs`        | Admin role only, no org check          | Cross-org scheduler data      |
| `evaluation_runs`       | Admin role only, no org check          | Cross-org evaluation data     |
| `evaluation_findings`   | Admin role only, no org check          | Cross-org evaluation data     |
| `evaluation_metrics`    | Admin role only, no org check          | Cross-org evaluation data     |
| `evaluation_run_events` | Admin role only, no org check          | Cross-org evaluation data     |
| `export_jobs`           | Admin role only, no org check          | Cross-org export data         |
| `email_log`             | Admin role only, no org check          | Cross-org email data          |

**Attack Vector:** Admin of Org A can `SELECT * FROM game_slots` and see every game slot across all organizations. For tables with write access, cross-org data modification is possible.

**Usability Impact of Fix:** Invisible. Adding `organization_id` columns (where missing) and `is_org_member()` checks happens entirely at the database level. Users continue using the app identically.

---

#### C-3: Registration Form Policies Reference Non-Existent Table

**Risk:** The registration schema (`20251219000000`) creates RLS policies on `registration_forms` and `registrations` that reference `public.organization_roles`—a table that does **not exist** in any migration. The actual table is `organization_members`. This means these policies will **silently fail to match any rows**, effectively locking out all admin access to registration data through normal RLS.

**Files:** `supabase/migrations/20251219000000_registration_schema.sql` (lines 47-51, 64-95)

**Current Impact:** If the app works today, it's because the Edge Functions or client-side logic bypass RLS. In a production environment, admins would be unable to read or manage registrations through the Supabase client.

**Usability Impact of Fix:** Invisible—actually a fix for broken functionality. Correcting the table reference restores intended access. No user-facing change.

---

### HIGH

#### H-1: CSV Ingestion Has No Server-Side Validation

**Risk:** The entire CSV import pipeline (file parsing, header validation, row normalization, data type checking) happens exclusively in `ImportContext.jsx` on the client. The backend receives whatever the client sends and inserts it into `import_jobs` without validation.

**Files:**

- `frontend/src/contexts/ImportContext.jsx` (lines 109-236)
- `frontend/src/components/ImportPanel.jsx`

**Attack Vectors:**

1. **Malformed data injection**: Attacker bypasses the frontend and sends a crafted POST directly to Supabase with arbitrary JSON in `error_summary`.
2. **XSS via field values**: If imported player names or notes contain HTML/JS and are rendered unescaped anywhere, stored XSS is possible.
3. **No file size limit enforced**: Documentation mentions 10 MB but no enforcement exists in code. A 500 MB CSV could be uploaded.

**Usability Impact of Fix:** Invisible. Server-side validation in an Edge Function or database trigger runs silently. The frontend import flow remains identical. Invalid data gets caught with the same error messages.

---

#### H-2: Calendar Feed Token Has No Expiry or Rotation

**Risk:** The `calendar-feed` Edge Function authenticates via a `token` query parameter looked up against `teams.calendar_token`. This token:

- Has no expiry mechanism
- Has no rate limiting
- Cannot be rotated without manual DB intervention
- Is passed in the URL (logged by proxies, browser history, referer headers)

**Files:** `supabase/functions/calendar-feed/index.ts` (lines 19-44)

**Attack Vector:** A leaked calendar URL (shared in a group chat, indexed by a search engine) permanently exposes a team's full schedule including field locations and game times.

**Usability Impact of Fix:** Minimal. Token rotation can be triggered by a coach or admin from the Team Portal with a "regenerate link" button. The ICS subscription URL in their calendar app would need re-adding—but this is a one-time action and can be communicated clearly.

---

#### H-3: Frontend Route Guards Are Client-Side Only (with 3-Second Window)

**Risk:** `ProtectedRoute.jsx` checks permissions purely in React state. When an unauthorized user navigates to a protected route (e.g., `/import`, `/admin/compliance`), the component renders the protected page for 3 seconds before redirecting. During this window, any data fetched by the page component is visible.

**Files:** `frontend/src/components/ProtectedRoute.jsx` (lines 14-22)

**Mitigation already in place:** RLS policies enforce data access at the database level, so even if the route renders, the Supabase queries would return empty results for unauthorized users—assuming all tables have correct RLS (see C-2).

**Usability Impact of Fix:** Improved. Reducing the delay to 0ms (immediate redirect) eliminates the "Unauthorized access" flash. Users who accidentally navigate to an admin page get instantly redirected to the dashboard instead of seeing a warning banner.

---

#### H-4: `npm audit` — High-Severity Dependency Vulnerabilities

**Risk:** Four high-severity vulnerabilities in active dependencies:

| Package            | Vulnerability                                                 | Severity |
| ------------------ | ------------------------------------------------------------- | -------- |
| `react-router` 7.x | CSRF in action processing (GHSA-h5cw-625j-3rxh)               | High     |
| `react-router` 7.x | XSS via open redirects (GHSA-2w69-qvjg-hvjx)                  | High     |
| `rollup` 4.x       | Arbitrary file write via path traversal (GHSA-mw96-cpmx-2vgc) | High     |
| `flatted` ≤3.4.1   | Prototype pollution + DoS via parse() (GHSA-rf6f-7fwh-wjgh)   | High     |

**Files:** `package.json`, `package-lock.json`

**Usability Impact of Fix:** Invisible. Running `npm audit fix` updates dependencies. No API or UI changes.

---

### MEDIUM

#### M-1: Organization Context Stored in localStorage (Client-Manipulable)

**Risk:** `OrganizationContext.jsx` reads `squadlogic_active_org` from `localStorage` to determine which organization's data to display. A user could modify this value in DevTools to attempt viewing another organization's data.

**Mitigation already in place:** The `switchOrganization()` function (line 118) only allows switching to orgs found in the user's `organization_members` query. RLS also enforces access at the DB level. The localStorage value is just a preference cache, not an auth token.

**Residual Risk:** Low—the real enforcement is in RLS. But if RLS gaps exist (see C-2), this becomes an amplifier.

**Files:** `frontend/src/contexts/OrganizationContext.jsx` (line 92)

**Usability Impact of Fix:** Invisible. Validating the localStorage value against the user's membership list on load adds ~1 DB query (already being made).

---

#### M-2: Missing `organization_id` on Derived/Scheduling Tables

**Risk:** Tables like `practice_slots`, `game_slots`, `field_subunits`, `team_players`, `practice_assignments`, `games`, `scheduler_runs`, `evaluation_*`, and `export_jobs` lack a direct `organization_id` column. Their org membership must be derived via JOINs (e.g., `game_slots → fields → locations → organization_id`). This makes RLS policies either:

1. Complex and slow (multi-table JOINs in USING clauses)
2. Absent (current state for many tables)

**Usability Impact of Fix:** Invisible. Adding `organization_id` columns and backfilling them is a migration-only change. Queries actually become faster because the JOIN chain is eliminated.

---

#### M-3: Inconsistent RLS Strategy Across Migrations

**Risk:** The migration history shows three different RLS patterns:

1. **Original** (`20251208`): `app_metadata.role = 'admin'` only
2. **Communication** (`20251217`): `profiles.organization_id = org_id` pattern
3. **Unified** (`20260310`): `is_org_member(organization_id)` pattern

Tables from migration `20251217` use `profiles.organization_id` but the `profiles` table (from `20251214000004`) has **no `organization_id` column**. This means the communication schema RLS policies (`profile_players`, `event_rsvps`, `team_messages`) reference a column that doesn't exist on `profiles`.

**Files:**

- `supabase/migrations/20251217000000_communication_schema.sql` (lines 27, 55-56, 66, 88, etc.)
- `supabase/migrations/20251214000004_core_auth.sql` (profiles table definition, no `organization_id`)

**Usability Impact of Fix:** Invisible. Migration adds the column and backfills from `organization_members`, or rewrites policies to use `is_org_member()`.

---

#### M-4: No Rate Limiting on Edge Functions

**Risk:** The persistence Edge Functions have no rate limiting. An attacker could flood the `team-persistence` endpoint with rapid requests to:

1. Cause denial of service (exhaust Supabase Edge Function execution time)
2. Create race conditions in concurrent writes
3. Exhaust free-tier limits

**Usability Impact of Fix:** Invisible. Rate limiting (e.g., 60 requests/minute per user) is well above any legitimate usage pattern for saving team rosters.

---

#### M-5: `submit_registration` RPC Uses SECURITY DEFINER Without Org Scope in Payload

**Risk:** The `submit_registration` RPC (`20260310000003`) correctly checks `is_org_member(p_organization_id)`, but accepts `p_organization_id` as a client-supplied parameter. A user who is a member of Org A could call the function with Org B's ID, and the `is_org_member` check would correctly block it. However, if there's ever a bug in `is_org_member()` or a race condition in membership checks, the function would write to the wrong org.

**Better pattern:** Derive `organization_id` from the authenticated user's active membership server-side rather than accepting it as a parameter.

**Files:** `supabase/migrations/20260310000003_registrations_rpc.sql` (line 7)

**Usability Impact of Fix:** Invisible. The frontend already sends the org ID; the function simply validates it differently.

---

#### M-6: PII Stored in Plaintext (guardian_contacts, date_of_birth)

**Risk:** The `players` table stores `guardian_contacts` (JSONB with names, emails, phones) and `date_of_birth` in plaintext. While SquadLogic correctly avoids storing sensitive documents (birth certificates, IDs), a database breach would expose contact information for parents and children.

**Context:** This is standard for applications at this scale, and encryption at rest is provided by Supabase's infrastructure. Column-level encryption would add significant complexity.

**Usability Impact of Fix:** Invisible if using Supabase Vault for column-level encryption. Slightly increased query latency (~5-10ms) for encrypted columns—imperceptible to users.

---

### LOW

#### L-1: Verbose Console Logging in Production

**Risk:** `supabaseClient.js`, `ImportContext.jsx`, and `AuthContext.jsx` contain extensive `console.log` and `console.warn` statements that output user IDs, session state, and data flow information to the browser console.

**Files:** `frontend/src/lib/supabaseClient.js` (lines 5-9), `frontend/src/contexts/ImportContext.jsx` (line 55)

**Usability Impact of Fix:** Invisible. Removing or gating debug logs behind `import.meta.env.DEV` is a code-only change.

---

#### L-2: `coach_team_map` View Initially Created Without `security_invoker`

**Risk:** The original `coach_team_map` view (migration `20251208`) was created without `security_invoker = true`. Migration `20260309` recreates it correctly. However, if migration order is disrupted or a rollback occurs, the view could revert to the insecure version.

**Usability Impact of Fix:** Invisible. Ensuring the corrected view definition is canonical.

---

#### L-3: Fuzzy CSV Header Matching Could Mismap Columns

**Risk:** The import pipeline uses `.includes()` for header matching (e.g., any column containing "skill" or "level" maps to `skill_tier`). A CSV with a column like "reading_level" would incorrectly map to `skill_tier`.

**Files:** `frontend/src/contexts/ImportContext.jsx` (lines 155-165)

**Usability Impact of Fix:** Improved. Stricter header matching (exact match or a curated alias list) prevents silent data corruption from non-GotSport CSV formats. Users see clearer error messages when columns don't match.

---

#### L-4: Test Credentials in .env

**Risk:** The `.env` file contains `TEST_ADMIN_EMAIL=admin@squadlogic.app` and `TEST_PASSWORD=password123`. While `.env` is gitignored and never committed, these credentials could be used if anyone gains access to a developer's machine.

**Usability Impact of Fix:** N/A. Moving test credentials to `.env.test` or a CI-only secrets vault doesn't affect the application.

---

## Prioritized Remediation Plan

### Phase 1: Critical Path (Estimated: 2-3 sessions)

**Goal:** Eliminate cross-tenant data leakage vectors.

| Step | Finding  | Action                                                                                                                                                                                                                                                                                                                                                                    | Files                                                            |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1.1  | C-2, M-2 | Add `organization_id` columns to all tables missing them (`field_subunits`, `practice_slots`, `game_slots`, `team_players`, `practice_assignments`, `games`, `staging_players`, `player_buddies`, `scheduler_runs`, `evaluation_runs`, `evaluation_findings`, `evaluation_metrics`, `evaluation_run_events`, `export_jobs`, `email_log`). Backfill from parent hierarchy. | New migration file                                               |
| 1.2  | C-2      | Drop all stale admin-only policies and replace with `is_org_member(organization_id)` for every table.                                                                                                                                                                                                                                                                     | New migration file                                               |
| 1.3  | C-3      | Fix `registration_forms` and `registrations` policies to reference `organization_members` instead of `organization_roles`.                                                                                                                                                                                                                                                | New migration file                                               |
| 1.4  | C-1      | Refactor Edge Functions to create a **per-request scoped** Supabase client using the user's JWT instead of the service role key for data queries. Keep the service role client only for the initial `auth.getUser()` call.                                                                                                                                                | `supabase/functions/*/index.ts`                                  |
| 1.5  | C-1      | Add explicit `organization_id` validation in each Edge Function handler: verify the user's org membership matches the data being modified.                                                                                                                                                                                                                                | `supabase/functions/*/index.ts`, `packages/core/src/*Handler.js` |

**Usability Impact:** All fixes are backend-only. Zero changes to the user experience. A coach on the field checking their schedule will notice nothing.

---

### Phase 2: High Priority (Estimated: 1-2 sessions)

**Goal:** Harden the ingestion pipeline and patch dependency vulnerabilities.

| Step | Finding | Action                                                                                                                                                                                                                    | Files                                                                                           |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 2.1  | H-1     | Create a new `import-validation` Edge Function that receives the parsed CSV data, performs server-side schema validation (Zod), sanitizes all string fields (strip HTML tags, limit length), and writes to `import_jobs`. | New Edge Function                                                                               |
| 2.2  | H-1     | Add file size enforcement (10 MB cap) both in the frontend `ImportPanel.jsx` and in a Supabase Storage policy.                                                                                                            | `frontend/src/components/ImportPanel.jsx`, Supabase Storage config                              |
| 2.3  | H-2     | Add `calendar_token_expires_at` column to `teams`. Add token validation logic in the calendar-feed function. Add a "Regenerate Calendar Link" button to Team Portal.                                                      | Migration, `supabase/functions/calendar-feed/index.ts`, `frontend/src/pages/TeamPortalPage.jsx` |
| 2.4  | H-3     | Remove the 3-second delay in `ProtectedRoute.jsx`. Replace with immediate redirect (0ms). The E2E test that depends on this delay should be rewritten to check authorization state, not rendered UI.                      | `frontend/src/components/ProtectedRoute.jsx`, E2E test files                                    |
| 2.5  | H-4     | Run `npm audit fix` to update `react-router`, `rollup`, `flatted`, `ajv`, and `minimatch`. Verify no breaking changes with `npm run test && npm run build`.                                                               | `package.json`, `package-lock.json`                                                             |

**Usability Impact:** Phase 2 fixes are also invisible to end users. The calendar token rotation adds a small new feature (regenerate button) that's clearly labeled and optional. The ProtectedRoute fix actually _improves_ UX by removing the 3-second "Unauthorized" flash.

---

### Phase 3: Medium Priority (Estimated: 2-3 sessions)

**Goal:** Consolidate the RLS strategy and add defense-in-depth.

| Step | Finding | Action                                                                                                                                                                                                       | Files                                           |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 3.1  | M-3     | Audit and rewrite all communication schema policies (`profile_players`, `event_rsvps`, `team_messages`) to use `is_org_member()` instead of `profiles.organization_id`.                                      | New migration                                   |
| 3.2  | M-4     | Add rate limiting to Edge Functions. Use Deno's built-in KV or a simple in-memory counter (per JWT sub, 60 req/min).                                                                                         | `supabase/functions/*/index.ts`                 |
| 3.3  | M-5     | Refactor `submit_registration` RPC to derive `organization_id` from the user's active membership rather than accepting it as a parameter.                                                                    | Migration update                                |
| 3.4  | M-1     | Add a guard in `OrganizationContext.jsx` that validates the localStorage `squadlogic_active_org` value against the fetched membership list before using it. (Defense-in-depth; RLS is the real enforcement.) | `frontend/src/contexts/OrganizationContext.jsx` |
| 3.5  | M-6     | Evaluate Supabase Vault for encrypting `guardian_contacts` and `date_of_birth` columns. If free-tier constraints make this impractical, document the accepted risk.                                          | Investigation + potential migration             |

**Usability Impact:** All invisible. Rate limiting thresholds are set far above any legitimate usage pattern. The org context validation adds one check at login time.

---

### Phase 4: Low Priority & Hardening (Estimated: 1 session)

**Goal:** Clean up and harden for production.

| Step | Finding | Action                                                                                                                                                             | Files                                     |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 4.1  | L-1     | Gate all `console.log`/`console.warn` behind `import.meta.env.DEV`.                                                                                                | Multiple frontend files                   |
| 4.2  | L-2     | Add a migration test that verifies `coach_team_map` has `security_invoker = true`.                                                                                 | Test file                                 |
| 4.3  | L-3     | Replace fuzzy `.includes()` header matching with a strict alias map for GotSport CSV columns.                                                                      | `frontend/src/contexts/ImportContext.jsx` |
| 4.4  | L-4     | Move test credentials to `.env.test` and update CI/CD to source them separately.                                                                                   | `.env`, `.env.test`, CI config            |
| 4.5  | —       | Add `Content-Security-Policy` headers to the Vite production build to mitigate XSS.                                                                                | `vite.config.js` or hosting config        |
| 4.6  | —       | Add audit logging: create an `audit_log` table that records all admin actions (imports, team changes, schedule modifications) with timestamp, user ID, and org ID. | New migration, Edge Function updates      |

**Usability Impact:** All invisible, except audit logging which provides admins with a new "Activity Log" they can optionally view.

---

## Appendix A: Tables Missing Organization-Scoped RLS

| Table                   | Has `organization_id`? | Has `is_org_member()` Policy?             | Status  |
| ----------------------- | ---------------------- | ----------------------------------------- | ------- |
| `season_settings`       | Yes                    | Yes                                       | OK      |
| `divisions`             | Yes (backfilled)       | Yes                                       | OK      |
| `teams`                 | Yes (backfilled)       | Yes                                       | OK      |
| `players`               | Yes (backfilled)       | Yes                                       | OK      |
| `coaches`               | Yes                    | Yes                                       | OK      |
| `locations`             | Yes                    | Yes                                       | OK      |
| `fields`                | Via `locations` JOIN   | Yes (via JOIN)                            | OK      |
| `import_jobs`           | Yes                    | Yes                                       | OK      |
| `profiles`              | N/A (user-scoped)      | Yes (self-only)                           | OK      |
| `organization_members`  | Yes                    | Yes (self-org)                            | OK      |
| `registration_forms`    | Yes                    | **BROKEN** (refs `organization_roles`)    | **FIX** |
| `registrations`         | Yes                    | **BROKEN** (refs `organization_roles`)    | **FIX** |
| `profile_players`       | Yes                    | Partial (refs `profiles.organization_id`) | **FIX** |
| `event_rsvps`           | Yes                    | Partial (refs `profiles.organization_id`) | **FIX** |
| `team_messages`         | Yes                    | Partial (refs `profiles.organization_id`) | **FIX** |
| `field_subunits`        | **No**                 | **No** (admin-only)                       | **FIX** |
| `practice_slots`        | **No**                 | **No** (admin-only)                       | **FIX** |
| `game_slots`            | **No**                 | **No** (admin-only)                       | **FIX** |
| `team_players`          | **No**                 | **No** (admin-only)                       | **FIX** |
| `practice_assignments`  | **No**                 | Partial (coach own-team only)             | **FIX** |
| `games`                 | **No**                 | **No** (admin-only)                       | **FIX** |
| `staging_players`       | **No**                 | **No** (admin-only)                       | **FIX** |
| `player_buddies`        | **No**                 | **No** (admin-only)                       | **FIX** |
| `scheduler_runs`        | **No**                 | **No** (admin-only)                       | **FIX** |
| `evaluation_runs`       | **No**                 | **No** (admin-only)                       | **FIX** |
| `evaluation_findings`   | **No**                 | **No** (admin-only)                       | **FIX** |
| `evaluation_metrics`    | **No**                 | **No** (admin-only)                       | **FIX** |
| `evaluation_run_events` | **No**                 | **No** (admin-only)                       | **FIX** |
| `export_jobs`           | **No**                 | **No** (admin-only)                       | **FIX** |
| `email_log`             | **No**                 | **No** (admin-only)                       | **FIX** |

## Appendix B: npm audit Full Output

```
# npm audit report

ajv  <6.14.0
Severity: moderate
ReDoS when using $data option - GHSA-2g4f-4pwh-qvx6

flatted  <=3.4.1
Severity: high
Unbounded recursion DoS in parse() - GHSA-25h7-pfq9-p65f
Prototype Pollution via parse() - GHSA-rf6f-7fwh-wjgh

minimatch  <=3.1.3
Severity: high
ReDoS via repeated wildcards - GHSA-3ppc-4f35-3m26

react-router  7.0.0 - 7.12.0-pre.0
Severity: high
CSRF in Action/Server Action Request Processing - GHSA-h5cw-625j-3rxh
XSS via Open Redirects - GHSA-2w69-qvjg-hvjx
SSR XSS in ScrollRestoration - GHSA-8v8x-cx79-35w7

rollup  4.0.0 - 4.58.0
Severity: high
Arbitrary File Write via Path Traversal - GHSA-mw96-cpmx-2vgc

6 vulnerabilities (2 moderate, 4 high)
Fix available via: npm audit fix
```

---

## Appendix C: Supabase Vault PII Encryption Evaluation (M-6)

**Date evaluated:** March 24, 2026
**Finding:** M-6 — `guardian_contacts` (JSONB) and `date_of_birth` (DATE) stored in plaintext.

### Recommendation: Accept Risk for Now, Revisit at Scale

**Supabase Vault** (`pgsodium`-based Transparent Column Encryption) would allow encrypting these columns at rest with key management handled by Supabase. However, after evaluation, the recommendation is to **document the accepted risk** rather than implement Vault encryption at this stage, for three reasons:

1. **Free-tier constraints.** Vault (TCE) is available on all Supabase tiers, but encrypted columns cannot be indexed, which means any query filtering by `date_of_birth` (used for age-group division assignment) would require a full table scan after decryption. On the free tier with limited compute, this creates unacceptable latency for the scheduling pipeline.

2. **JSONB incompatibility.** `guardian_contacts` is a JSONB column queried with JSON path operators (`->>`, `@>`). Vault encrypts the entire column value as a single blob — JSON operators cannot work on encrypted data. This would require restructuring the column into a normalized table with individual encrypted fields, which is a significant schema change.

3. **Proportional threat model.** SquadLogic stores contact information (names, emails, phone numbers) — the same data found in any youth sports league spreadsheet shared via Google Sheets. It does NOT store SSNs, financial data, medical records, or government IDs (per project guardrails). The risk from a database breach exposing contact info is real but moderate, and is already mitigated by Supabase's infrastructure-level encryption at rest (AES-256) on all Postgres data.

**Accepted risk:** Contact PII (names, emails, phones, DOB) is protected by AES-256 encryption at rest (infrastructure-level) and organization-scoped RLS in transit. Column-level encryption is deferred until the platform scales beyond free-tier constraints or regulatory requirements change.

**Trigger to revisit:** If SquadLogic begins handling data subject to COPPA enforcement actions, expands to store medical information, or migrates to a paid Supabase tier where compute constraints are relaxed.

---

## Remediation Progress Tracker

| Phase      | Status       | Commit           | Findings Addressed                                                   |
| ---------- | ------------ | ---------------- | -------------------------------------------------------------------- |
| Phase 1    | **Complete** | `4c518df`        | C-1, C-2, C-3, M-2, M-3                                              |
| Phase 2    | **Complete** | `11119b6`        | H-1, H-2, H-3, H-4                                                   |
| Phase 3    | **Complete** | `54b514c`        | M-1, M-3, M-4, M-5, M-6                                              |
| Refinement | **Complete** | `c0fc38f`        | Multi-org IDOR fix, redundant policy cleanup                         |
| Phase 4    | **Complete** | _(pending push)_ | L-1, L-2 (already compliant), L-3, L-4 + CSP headers + audit logging |

### Phase 4 Details

| Step | Finding | Action Taken                                                                                                                                                                     |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | L-1     | Created `frontend/src/lib/logger.js`; replaced 67 console.log/warn/error calls across 27 files with dev-gated logger                                                             |
| 4.2  | L-2     | **Skipped** — migration `20260309` already sets `security_invoker = true` on `coach_team_map`                                                                                    |
| 4.3  | L-3     | Replaced fuzzy `.includes()` header matching in `ImportContext.jsx` and `ImportPanel.jsx` with strict `HEADER_ALIASES` map matching server-side `import-validation`              |
| 4.4  | L-4     | Moved test credentials from `.env` to `.env.test` (gitignored); replaced hardcoded passwords in `supabaseClient.js` with `import.meta.env.VITE_TEST_*` vars                      |
| 4.5  | New     | Added `vercel.json` with `Content-Security-Policy-Report-Only`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` headers                     |
| 4.6  | New     | Created `audit_log` table (append-only, admin-read-only RLS), `record_audit_event()` RPC, wired into all 4 Edge Functions + `rotate_calendar_token` + `submit_registration` RPCs |
