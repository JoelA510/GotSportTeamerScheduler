# SquadLogic Security Hardening — Phase 4 Execution Plan

**Date:** March 24, 2026
**Status:** Ready for implementation
**Prerequisites:** Phases 1–3 complete + refinement commit `c0fc38f`. Push all commits before starting: `git push origin master:main`

---

## Context

Phases 1–3 resolved all Critical (3), High (4), and Medium (6) findings from the security audit. Phase 4 addresses the remaining Low-priority findings plus two new hardening items (CSP headers and audit logging). One original item (L-2: `coach_team_map` view) was found to already be compliant during the Phase 1–3 review and is skipped.

**Recommended execution order:** 4.4 → 4.3 → 4.5 → 4.1 → 4.6 (quick wins first, audit log last since it benefits from all other hardening being in place).

---

## 4.1 — Gate Console Logging Behind `import.meta.env.DEV`

**Finding:** L-1
**Effort:** Medium (67 statements across 27 files)
**Usability impact:** Invisible

### What to do

Create a thin logger utility at `frontend/src/lib/logger.js`:

```js
const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args) => { if (isDev) console.log(...args); },
  warn: (...args) => { if (isDev) console.warn(...args); },
  // console.error stays active in prod but strips verbose payloads
  error: (...args) => { console.error(...args); },
};
```

Then replace all `console.log` and `console.warn` calls with `logger.log` / `logger.warn`. Keep `console.error` calls as `logger.error` (which still fires in prod — genuine errors should surface in monitoring).

### Files to modify (by priority)

**High priority (verbose data exposure):**

| File | Count | Notes |
|------|-------|-------|
| `frontend/src/lib/supabaseClient.js` | 12 | Mock client startup logs, hardcoded emails visible |
| `frontend/src/contexts/ImportContext.jsx` | 7 | Logs import data flow |
| `frontend/src/pages/RegistrationFlow.jsx` | 4 | Debug logs with data |
| `frontend/src/pages/FieldManagementPage.jsx` | 4 | Debug logging |
| `frontend/src/hooks/useTeamPortal.js` | 4 | Multiple error/debug logs |

**Medium priority:**

| File | Count |
|------|-------|
| `frontend/src/components/OutputGenerationPanel.jsx` | 3 |
| `frontend/src/pages/AdminComplianceDashboard.jsx` | 3 |
| `frontend/src/pages/AdminReportingDashboard.jsx` | 2 |
| `frontend/src/contexts/OrganizationContext.jsx` | 2 |
| `frontend/src/hooks/usePracticeAssignments.js` | 2 |
| `frontend/src/hooks/useTeamPersistence.js` | 2 |
| `frontend/src/pages/LeagueStandings.jsx` | 2 |
| `frontend/src/pages/TeamAnalysisPage.jsx` | 2 |
| `frontend/src/components/teaming/RosterManager.jsx` | 2 |
| `frontend/src/components/EvaluationPanel.jsx` | 2 |

**Low priority (single calls):**

| File |
|------|
| `frontend/src/components/DashboardWorkflow.jsx` |
| `frontend/src/components/ErrorBoundary.jsx` |
| `frontend/src/components/GamePersistencePanel.jsx` |
| `frontend/src/components/PracticePersistencePanel.jsx` |
| `frontend/src/contexts/ThemeContext.jsx` |
| `frontend/src/hooks/useFields.js` |
| `frontend/src/hooks/useGameAssignments.js` |
| `frontend/src/hooks/useSchedulerRun.js` |
| `frontend/src/hooks/useTeamAnalysis.js` |
| `frontend/src/lib/apiClient.js` |
| `frontend/src/pages/ImportPage.jsx` |
| `frontend/src/pages/RegistrationForms.jsx` |
| `frontend/src/pages/SettingsPage.jsx` |

### Verification

After replacing all calls, run:
```bash
# Should return 0 matches in frontend/src/ (excluding logger.js itself)
grep -rn "console\.\(log\|warn\)" frontend/src/ --include="*.js" --include="*.jsx" | grep -v logger.js
```

---

## 4.2 — SKIP (`coach_team_map` View Already Compliant)

Migration `20260309000000_rls_remediation.sql` line 13 already recreates the view with `security_invoker = true`. No action needed.

---

## 4.3 — Replace Fuzzy `.includes()` Header Matching in ImportContext

**Finding:** L-3
**Effort:** Low
**Usability impact:** Improved (prevents silent column mismatches)

### What to do

The server-side `import-validation` Edge Function (`supabase/functions/import-validation/index.ts` lines 57–90) already has a strict `HEADER_ALIASES` map. Port that same map to the frontend.

**File:** `frontend/src/contexts/ImportContext.jsx`

**Lines to rewrite:**

1. **Line 139** — Replace `h.includes(req) || req.includes(h)` with exact alias map lookup for required header validation.

2. **Lines 155–161** — Replace the fuzzy `.includes()` field mapping block:
   ```js
   // BEFORE (fuzzy)
   if (normalizedKey.includes('coach') && normalizedKey.includes('willing')) {
     newRow['willing_to_coach'] = row[key];
   } else if (normalizedKey.includes('buddy') || normalizedKey.includes('friend')) {
     newRow['buddy_request'] = row[key];
   } else if (normalizedKey.includes('medical') || normalizedKey.includes('allergy')) {
     newRow['medical_info'] = row[key];
   } else if (normalizedKey.includes('skill') || normalizedKey.includes('level')) {
     newRow['skill_tier'] = row[key];
   }
   ```

   ```js
   // AFTER (strict alias map — matches server-side import-validation)
   const HEADER_ALIASES = {
     'first name': 'first_name', 'first_name': 'first_name', 'firstname': 'first_name',
     'last name': 'last_name', 'last_name': 'last_name', 'lastname': 'last_name',
     'date of birth': 'date_of_birth', 'date_of_birth': 'date_of_birth',
     'dob': 'date_of_birth', 'birthdate': 'date_of_birth',
     'full name': 'full_name', 'full_name': 'full_name', 'coach name': 'full_name',
     'email': 'email', 'email address': 'email',
     'name': 'name', 'field name': 'name', 'field_name': 'name',
     'coach willing': 'willing_to_coach', 'willing to coach': 'willing_to_coach',
     'buddy': 'buddy_request', 'buddy request': 'buddy_request',
     'friend': 'buddy_request', 'friend request': 'buddy_request',
     'medical': 'medical_info', 'medical info': 'medical_info',
     'allergy': 'medical_info', 'allergies': 'medical_info',
     'skill': 'skill_tier', 'skill level': 'skill_tier',
     'skill tier': 'skill_tier', 'level': 'skill_tier',
   };
   const normalizedKey = HEADER_ALIASES[key.toLowerCase().trim()] ?? key;
   newRow[normalizedKey] = row[key];
   ```

3. **Lines 170–171** — Replace fuzzy first/last name detection with alias map lookups for row validation.

### Verification

Manually test with a CSV that has headers like "reading_level" or "skill_assessment" — these should NOT map to `skill_tier` after the fix. Only exact aliases should match.

---

## 4.4 — Move Test Credentials to `.env.test`

**Finding:** L-4
**Effort:** Low
**Usability impact:** None

### Current state

**`.env`** contains:
```
TEST_ADMIN_EMAIL=admin@squadlogic.app
TEST_COACH_EMAIL=coach@squadlogic.app
TEST_PASSWORD=password123
```

**`frontend/src/lib/supabaseClient.js`** has hardcoded matches:
- Line 40: `email: 'admin@squadlogic.app'`
- Line 41: `email: 'coach@squadlogic.app'`
- Line 503: `if (password === 'password123' || password === 'test-password-123')`

### What to do

1. Create `.env.test` with the three test credential variables. Remove them from `.env`.

2. Create `.env.test.example` (committed to repo) with placeholder values:
   ```
   TEST_ADMIN_EMAIL=admin@example.com
   TEST_COACH_EMAIL=coach@example.com
   TEST_PASSWORD=your-test-password-here
   ```

3. Add `.env.test` to `.gitignore`.

4. In `supabaseClient.js`, replace hardcoded credential strings with `import.meta.env.VITE_TEST_ADMIN_EMAIL` etc., gated behind `import.meta.env.DEV`:
   ```js
   // Mock profiles should only be available in dev/test mode
   if (!import.meta.env.DEV) {
     throw new Error('Mock Supabase client should not be used in production');
   }
   ```

5. Update `vite.config.js` to load `.env.test` in test mode (Vite does this automatically if the file is named `.env.test`).

6. Update any CI/CD config to source `.env.test` for the test runner.

### Verification

```bash
# Should find no hardcoded test passwords in source
grep -rn "password123\|test-password-123" frontend/src/ --include="*.js" --include="*.jsx"
# Should find no test emails in source
grep -rn "admin@squadlogic.app\|coach@squadlogic.app" frontend/src/ --include="*.js" --include="*.jsx"
```

---

## 4.5 — Add Content-Security-Policy Headers

**Finding:** New hardening item
**Effort:** Medium
**Usability impact:** Invisible (report-only mode initially)

### Current state

No CSP configuration exists anywhere. No `vercel.json`, `netlify.toml`, or `_headers` file.

### What to do

Create `vercel.json` in the project root:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy-Report-Only",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://mmwupqsjkikqzvmdvuzm.supabase.co wss://mmwupqsjkikqzvmdvuzm.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=()"
        }
      ]
    }
  ]
}
```

**Important notes:**

- Start with `Content-Security-Policy-Report-Only` (not enforcing). Monitor for violations in the browser console. Once clean for a sprint, switch to enforcing `Content-Security-Policy`.
- `'unsafe-inline'` for `style-src` is needed because Tailwind CSS injects inline styles. If/when Tailwind is configured with a nonce-based strategy, this can be tightened.
- The `connect-src` must include the Supabase project URL for API calls and WebSocket connections (realtime subscriptions).
- Also adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` as standard security headers.

### If NOT using Vercel

For Netlify, create `netlify.toml` or `public/_headers` with equivalent rules. For self-hosted, add headers in the reverse proxy (nginx/Caddy) config.

### Verification

After deploying, open browser DevTools → Console. CSP violations will appear as warnings (report-only mode). There should be zero violations for normal app usage.

---

## 4.6 — Create Audit Logging Infrastructure

**Finding:** New hardening item
**Effort:** High (new table + RPC + Edge Function wiring + optional UI)
**Usability impact:** Invisible backend; optional admin "Activity Log" panel

### What to do

#### Step 1: Migration — `20260324000004_audit_log.sql`

```sql
BEGIN;

-- Audit log table — append-only, no UPDATE/DELETE policies
CREATE TABLE IF NOT EXISTS public.audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id         UUID NOT NULL REFERENCES auth.users(id),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    action          TEXT NOT NULL CHECK (action IN (
        'import.started', 'import.completed', 'import.failed',
        'team.saved', 'team.deleted',
        'game.saved', 'game.deleted',
        'practice.saved', 'practice.deleted',
        'registration.submitted', 'registration.approved', 'registration.rejected',
        'calendar.token_rotated',
        'member.invited', 'member.removed', 'member.role_changed',
        'settings.updated',
        'export.started', 'export.completed'
    )),
    resource_type   TEXT,          -- e.g., 'team', 'game', 'player', 'import_job'
    resource_id     UUID,          -- ID of the affected resource
    metadata        JSONB DEFAULT '{}'::jsonb,  -- before/after diffs, extra context
    ip_address      INET           -- optional, from request headers
);

-- Index for org-scoped queries (admin dashboard)
CREATE INDEX idx_audit_log_org_created
    ON public.audit_log (organization_id, created_at DESC);

-- Index for user activity queries
CREATE INDEX idx_audit_log_user_created
    ON public.audit_log (user_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT only: org admins can read their org's logs
CREATE POLICY "Admins can view org audit logs"
    ON public.audit_log FOR SELECT TO authenticated
    USING (
        is_org_member(organization_id)
        AND EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE organization_members.profile_id = auth.uid()
              AND organization_members.organization_id = audit_log.organization_id
              AND organization_members.role = 'admin'
        )
    );

-- No INSERT/UPDATE/DELETE policies for authenticated role.
-- All writes go through the SECURITY DEFINER RPC below.

-- Helper RPC for recording audit events (called by Edge Functions and other RPCs)
CREATE OR REPLACE FUNCTION public.record_audit_event(
    p_organization_id UUID,
    p_action TEXT,
    p_resource_type TEXT DEFAULT NULL,
    p_resource_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_ip_address INET DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO public.audit_log (
        user_id, organization_id, action,
        resource_type, resource_id, metadata, ip_address
    )
    VALUES (
        auth.uid(), p_organization_id, p_action,
        p_resource_type, p_resource_id, p_metadata, p_ip_address
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_audit_event(UUID, TEXT, TEXT, UUID, JSONB, INET)
    TO authenticated;

COMMIT;
```

#### Step 2: Wire into Edge Functions

Add audit logging calls to each persistence Edge Function after the inner handler returns successfully. Example for `team-persistence/index.ts`:

```ts
// After line: const response = await innerHandler(req);
if (response.ok) {
  // Fire-and-forget audit log (don't block the response)
  serviceClient.rpc('record_audit_event', {
    p_organization_id: targetOrgIds[0],  // from the org check above
    p_action: 'team.saved',
    p_resource_type: 'team',
    p_metadata: { team_count: teamRows.length },
  }).then(() => {}).catch((err) => console.error('Audit log failed:', err));
}
```

Similarly for:
- `game-persistence` → action `'game.saved'`
- `practice-persistence` → action `'practice.saved'`
- `import-validation` → action `'import.started'`
- `calendar-feed` → no audit (read-only, public endpoint)
- `rotate_calendar_token` RPC → add `record_audit_event` call inside the RPC body
- `submit_registration` RPC → add `record_audit_event` call inside the RPC body

#### Step 3: Wire into existing RPCs

Add `PERFORM record_audit_event(...)` calls at the end of:
- `rotate_calendar_token()` → action `'calendar.token_rotated'`
- `submit_registration()` → action `'registration.submitted'`

#### Step 4 (Optional): Admin Activity Log UI

Create a lightweight panel on the admin dashboard that queries:
```sql
SELECT * FROM audit_log
WHERE organization_id = :org_id
ORDER BY created_at DESC
LIMIT 50;
```

This can be deferred to a future feature sprint if Phase 4 scope needs to stay tight. The backend infrastructure is the priority — the UI is nice-to-have.

### Verification

After applying the migration:
```sql
-- Verify table exists and RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'audit_log';

-- Verify only admin SELECT policy exists (no INSERT/UPDATE/DELETE for authenticated)
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'audit_log';

-- Test the RPC (as an authenticated user)
SELECT record_audit_event(
    '<org_id>'::uuid,
    'settings.updated',
    'season_settings',
    '<some_id>'::uuid,
    '{"changed": "timezone"}'::jsonb
);

-- Verify the row was inserted
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 1;
```

---

## Summary

| Item | Finding | Effort | Files Touched | Skip? |
|------|---------|--------|---------------|-------|
| 4.1 | L-1: Console logging | Medium | 27 frontend files + new `logger.js` | No |
| 4.2 | L-2: coach_team_map | — | — | **Yes (already compliant)** |
| 4.3 | L-3: Fuzzy headers | Low | `ImportContext.jsx` | No |
| 4.4 | L-4: Test credentials | Low | `.env`, `.env.test`, `supabaseClient.js`, `.gitignore` | No |
| 4.5 | CSP headers | Medium | New `vercel.json` | No |
| 4.6 | Audit logging | High | New migration, 5 Edge Functions, 2 RPCs, optional UI | No |

## Git History for Reference

```
c0fc38f security: fix multi-org IDOR in persistence functions and remove redundant RLS policy
54b514c security: Phase 3 rate limiting, RPC hardening, and org context validation
8a850c8 chore: include linter-reformatted test files
11119b6 security: Phase 2 ingestion hardening, dependency patching, and UX fixes
4c518df security: Phase 1 RLS unification and Edge Function org validation
1ecd2a7 chore: Apply targeted E2E stability fixes and update ingestion validation headers
```

**Remember to push before starting Phase 4:** `git push origin master:main`
