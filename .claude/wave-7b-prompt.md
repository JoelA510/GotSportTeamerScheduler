# Wave 7b — CSP Refinement (connect-src + documentation)

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4, 5, 6a, 6b, 7a shipped. Wave 2 flipped the CSP from Report-Only to enforcing (commit `cb720a9`).

**Plan pivot (from review)**: original Wave 7b draft proposed a Vercel Edge Middleware approach to remove `'unsafe-inline'` from `script-src` via per-request nonce. Review surfaced two blockers:
1. Current `vercel.json` already has `script-src 'self'` with NO `'unsafe-inline'` — the stated premise was wrong.
2. The middleware template had a body-modification bug (returned a null-body `Response` that would blank the page) and the body-rewrite pattern on Vercel Edge is non-trivial for a static SPA.

**Revised scope** — tighten what's ACTUALLY loose and document the full policy:
1. **`connect-src` gap**: Wave 2 set `VITE_SENTRY_DSN` but did NOT update CSP. Sentry ingest requests (`https://*.ingest.sentry.io`) are currently blocked by `connect-src`. This is a real bug: production Sentry errors are silently dropped.
2. **`connect-src` hardcoded Supabase host** is fragile — project-specific string. Switch to `*.supabase.co` wildcard for resilience.
3. **`style-src 'unsafe-inline'` waiver** — Tailwind 4 runtime + React inline-style props need it; style-src nonce is v1.1+ work. Document the waiver with a concrete follow-up plan.
4. **`'strict-dynamic'` + script-src hash** — the "modern hardening" path (nonce OR build-time hash on the bootstrap script) is deferred to v1.1. Current `'self'` on script-src is a reasonable SPA baseline.

**Audit backlog**: `docs/audits/wave-1a/index.md` CSP-tagged findings (likely in the Wave-7 section).

**Wave 7b is**:
- Fix `connect-src` in `vercel.json` (Sentry ingest + `*.supabase.co` wildcard).
- New `docs/security/csp.md` documenting directives, waivers, follow-ups.
- 3 E2E CSP regression scenarios.
- Closure.

**Wave 7b is NOT**:
- Adding Vercel Edge Middleware (original draft; abandoned after review).
- `script-src` nonce or `'strict-dynamic'` migration (v1.1).
- `style-src` nonce migration (v1.1+; waived with plan).
- CSP `report-uri` / violation reporting telemetry.
- HSTS header (separate concern).
- SRI.
- pgTAP (Wave 7a).

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. Wave 7a shipped — `supabase/tests/` exists with harness + 5 RLS tests.
3. `vercel.json` has an enforcing `Content-Security-Policy` header (NOT Report-Only). `script-src` currently has `'self'` ONLY — no `'unsafe-inline'`. (If it DOES have `'unsafe-inline'`, someone regressed Wave 2's work; HALT and reconcile.)
4. `connect-src` currently lists ONE specific Supabase host (`https://<ref>.supabase.co` + `wss://<ref>.supabase.co`) and does NOT list `https://*.ingest.sentry.io`. Confirm by reading the current value.
5. `style-src` currently has `'unsafe-inline'`. Wave 7b preserves this with a documented waiver.
6. `VITE_SENTRY_DSN` is set in Vercel Production (per Wave 2 closure). If the DSN is empty on prod, the connect-src fix is still correct but inert.
7. Baselines: `npm run lint` / `typecheck` / `test` / `frontend:build` / `check:bundle` / `check:advisors` all green. `npm run test:e2e` baseline from post-Wave-5.

---

## Branch Conventions

- One branch per task:
  - `claude/wave-7b-csp-refine` → Task 1
  - `claude/wave-7b-csp-e2e` → Task 2 (depends on Task 1)
  - `claude/wave-7b-closure` → Task 3 (depends on 1 + 2)

PR per task. Wave 6a + 7a gates stay green.

---

## Task 1 — `vercel.json` CSP Refinement + `docs/security/csp.md`

**Commit**: `fix(security): csp connect-src fix (sentry ingest + supabase wildcard)`

**Branch**: `claude/wave-7b-csp-refine`

### Steps

1. Checkout `claude/wave-7b-csp-refine` from latest `main`.

2. **Snapshot current CSP** — read `vercel.json`'s `headers` section. Record every directive as the "before" state in the PR body.

3. **Update `connect-src` in `vercel.json`**:
   - **Add** `https://*.ingest.sentry.io` so Sentry errors reach the ingest endpoint. Without this, `VITE_SENTRY_DSN` is set but all captures are blocked by CSP silently.
   - **Replace** hardcoded Supabase hostname with `https://*.supabase.co` + `wss://*.supabase.co` wildcards. The hardcoded ref becomes stale if the project migrates; wildcard scoped to `supabase.co` is as tight as the original plus resilient.
   - Preserve `'self'`.

   Before:
   ```
   connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co;
   ```
   After:
   ```
   connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io;
   ```

4. **Preserve the rest of the directives verbatim** — `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src`, `font-src`, `frame-ancestors`, `object-src`, `base-uri`, `form-action`, `upgrade-insecure-requests`. Do NOT tighten other directives in this task; scope creep risk.

5. **Write `docs/security/csp.md`** (new):
   ```markdown
   # Content Security Policy

   Policy lives in `vercel.json`. No runtime middleware — CSP is static.

   ## Directives (as of Wave 7b)

   | Directive | Value | Rationale |
   | --- | --- | --- |
   | default-src | 'self' | Deny-by-default baseline. |
   | script-src | 'self' | Same-origin scripts only. No unsafe-inline. |
   | style-src | 'self' 'unsafe-inline' | **WAIVED** — Tailwind 4 runtime + React inline styles. See waiver section. |
   | img-src | 'self' data: blob: | data: for generated avatars; blob: for in-memory images. |
   | font-src | 'self' | Bundled fonts only. |
   | connect-src | 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io | Supabase REST + realtime; Sentry ingest (Wave 7b fix). |
   | frame-ancestors | 'none' | Anti-clickjacking. |
   | object-src | 'none' | No plugins. |
   | base-uri | 'self' | Prevent base-URI injection. |
   | form-action | 'self' | Only same-origin form posts. |
   | upgrade-insecure-requests | — | Force HTTPS for mixed content. |

   ## style-src 'unsafe-inline' waiver

   `'unsafe-inline'` on `style-src` is currently accepted. Rationale:
   - Tailwind 4 runtime emits some inline styles for CSS-variable overrides.
   - React's `style={{...}}` prop renders inline `style=""` attributes.
   - A nonce-based style-src would require either a build-time hash pass
     OR refactoring every React inline-style usage — a v1.1-scale effort.

   Follow-up plan (v1.1+):
   1. Audit `frontend/src/**/*.jsx` for `style={{...}}` prop usage.
   2. Extract hot paths to Tailwind utilities or CSS modules.
   3. Add a build-time hash step for the remaining inline styles.
   4. Re-evaluate nonce vs hash CSP once the inline-style count drops
      below a manageable bar.

   ## script-src hardening plan (v1.1+)

   Current `script-src 'self'` is a reasonable SPA baseline but doesn't
   use `'strict-dynamic'` or hash/nonce. Future hardening options:
   - Add `'strict-dynamic'` + build-time SHA-256 hash of the bootstrap
     script (static CSP; no middleware).
   - Add a Vercel Edge Middleware that generates a per-request nonce.
     (Was explored in Wave 7b's original draft; deferred due to SPA
     body-rewrite complexity.)

   Neither is gating for v1.0.1 — same-origin + no inline-script is a
   solid baseline.

   ## Reporting (not configured)

   No `report-uri` / `report-to` directive. If violation telemetry
   becomes valuable (e.g., to catch accidental inline-script usage),
   wire a Sentry-backed endpoint in a future wave.

   ## Manual prod smoke (post-deploy)

   After Task 1 merges and Vercel redeploys:
   1. Load prod; DevTools → Network → response `Content-Security-Policy`
      header shows the new `connect-src` with `*.ingest.sentry.io`.
   2. DevTools → Console → trigger a test error
      (`throw new Error('wave-7b csp smoke')`). Confirm the error appears
      in the Sentry dashboard with `environment: production`.
   3. DevTools → Console during golden-path flows: ZERO CSP violations.
   ```

6. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   git status
   ```
   CSP behavior can be partially validated locally via `npm run frontend:dev` (Vite applies its own CSP) — primary validation is manual prod smoke post-deploy.

7. Commit, push, open PR. PR body documents: before/after directives table, Sentry-ingest rationale, Supabase-wildcard rationale, style-src waiver pointer, post-deploy smoke checklist.

### Tests to add (Task 1)

- None in Vitest. `vercel.json` is static config; CSP behavior is edge-enforced.
- Task 2 adds E2E coverage.

### Out of scope (Task 1)

- Vercel Edge Middleware (original draft; abandoned).
- `script-src` nonce / hash / `'strict-dynamic'` migration (v1.1).
- `style-src` nonce migration (v1.1; waived).
- CSP reporting / telemetry.
- HSTS header.
- SRI.
- Tightening directives beyond `connect-src` (scope creep).

---

## Task 2 — E2E CSP Regression Scenarios

**Commit**: `test(e2e): add csp regression scenarios`

**Branch**: `claude/wave-7b-csp-e2e`

**Depends on**: Task 1 merged. E2E runs in dev-mode (Vite), not against the Vercel CSP header — tests the developer-time contract ("no CSP-violating patterns introduced"). Prod CSP is validated via Task 1's manual smoke.

### Steps

1. Checkout `claude/wave-7b-csp-e2e` from latest `main` AFTER Task 1 merges.

2. **Write `tests/e2e/features/csp_regression.feature`**:
   ```gherkin
   Feature: Content Security Policy regression
     The app must not emit CSP violations during golden-path flows.
     A violation indicates the vercel.json CSP blocks something the
     app needs — surfaces drift before it reaches production.

     Scenario: Login and dashboard load produces zero CSP violations
       Given I open an instrumented browser that captures CSP violations
       When I navigate to "/login"
       And I log in as admin
       And I navigate to "/"
       Then zero CSP violations should have been captured

     Scenario: Import wizard produces zero CSP violations
       Given I open an instrumented browser that captures CSP violations
       And I am logged in as admin
       When I navigate to "/import"
       And I select a valid CSV file
       Then zero CSP violations should have been captured

     Scenario: Schedule generation produces zero CSP violations
       Given I open an instrumented browser that captures CSP violations
       And I am logged in as admin
       When I navigate to "/schedule/game"
       And I trigger auto-schedule
       Then zero CSP violations should have been captured
   ```

3. **Step defs** at `tests/e2e/steps/csp.ts`:
   ```ts
   import { Given, Then, expect } from 'playwright-bdd';

   Given('I open an instrumented browser that captures CSP violations', async function () {
     await this.context.addInitScript(() => {
       (window as any).__cspViolations = [];
       document.addEventListener('securitypolicyviolation', (e) => {
         (window as any).__cspViolations.push({
           violatedDirective: e.violatedDirective,
           blockedURI: e.blockedURI,
           sourceFile: e.sourceFile,
           lineNumber: e.lineNumber,
         });
       });
     });
     this.page.on('console', (msg) => {
       if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
         (this.cspConsoleErrors ??= []).push(msg.text());
       }
     });
   });

   Then('zero CSP violations should have been captured', async function () {
     const violations = await this.page.evaluate(() => (window as any).__cspViolations || []);
     const consoleErrors = this.cspConsoleErrors || [];
     expect(violations).toEqual([]);
     expect(consoleErrors).toEqual([]);
   });
   ```

4. **Scope caveat**: E2E runs against the Vite dev server in CI, which applies its own CSP; Vite's dev CSP is more permissive than the prod Vercel CSP. The test validates the DEVELOPER-TIME contract (no scripts firing CSP violations in the tested flows). Prod CSP is validated via Task 1's manual smoke. Document in the feature-file comments.

5. **Regenerate `.features-gen-local/`** via `bddgen`. Run locally:
   ```bash
   npm run test:e2e -- --workers=1 --grep "CSP regression"
   ```
   All 3 scenarios pass.

6. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   npm run test:e2e -- --workers=1 --grep "CSP regression"
   git status
   ```

7. Commit, push, open PR. PR body includes: the dev-mode-vs-prod caveat, manual prod smoke pointer.

### Tests to add (Task 2)

- `tests/e2e/features/csp_regression.feature`
- `tests/e2e/steps/csp.ts`

### Out of scope (Task 2)

- Running E2E against a Vercel preview deploy.
- CSP telemetry.
- Scenarios beyond the 3 golden-path flows.

---

## Task 3 — Closure

**Commit**: `docs(wave-7b): closure — csp script-src nonce shipped`

**Branch**: `claude/wave-7b-closure`

**Depends on**: Tasks 1 + 2 merged.

### Steps

1. Checkout `claude/wave-7b-closure` from latest `main` AFTER Tasks 1 + 2 merge.

2. **Update `docs/audits/wave-1a/index.md`** — Wave-7-csp findings: prepend `✅`, set `Proposed wave` to `7b (shipped)`. Append a `## Wave 7b closure` section summarizing:
   - `connect-src` updated: Sentry ingest (`*.ingest.sentry.io`) added + Supabase host switched to `*.supabase.co` wildcard.
   - `docs/security/csp.md` published: full directive table + style-src waiver with v1.1 plan + script-src hardening plan for v1.1.
   - 3 E2E CSP regression scenarios (baseline +3 passing).
   - Manual prod-smoke checklist documented.
   - Middleware-based nonce approach deferred to v1.1; rationale logged in `csp.md`.

3. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 7b CSP refinement

   Three PRs shipped:
   - Task 1: vercel.json connect-src updated (Sentry ingest + Supabase
     wildcard); docs/security/csp.md published.
   - Task 2: 3 E2E CSP regression scenarios (dev-mode contract; prod
     validated via manual smoke in Task 1).
   - Task 3: closure.

   Bug fix: Sentry error ingestion was silently blocked by CSP
   connect-src (Wave 2 shipped VITE_SENTRY_DSN but didn't update CSP).

   Waivers: style-src 'unsafe-inline' (Tailwind 4 + React inline
   styles); script-src hardening via strict-dynamic/nonce/hash
   (deferred to v1.1). Both documented with concrete follow-ups in
   docs/security/csp.md.
   ```

4. Verification:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   npm run test:e2e -- --workers=1                                           # full suite
   npm run format -- docs/security/csp.md docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
   git status
   ```

5. Commit, push, open PR.

### Tests to add (Task 3)

- None.

### Out of scope (Task 3)

- Editing `.claude/wave-*.md`.
- Archiving docs.
- Wave 7a's pgTAP artifacts (already closed).

---

## Documentation Currency Pass

1. `docs/security/csp.md` (new — Task 1).
2. `docs/audits/wave-1a/index.md` — Wave-7-csp findings shipped (Task 3).
3. `docs/expansion/98_PROGRESS_LOG.md` — dated entry (Task 3).

Do NOT touch: `CLAUDE.md`, `docs/architecture/**`, `docs/operations/**`, `docs/testing/**`, `docs/security/rls-policies.md` (Wave 7a owned), any `.claude/wave-*.md`.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 3 tasks merged with CI green (Wave 6a + 7a gates stay green).
2. `vercel.json` `connect-src` contains `https://*.ingest.sentry.io`, `https://*.supabase.co`, `wss://*.supabase.co`.
3. `vercel.json` `script-src` unchanged (still `'self'`).
4. `vercel.json` `style-src` unchanged (still `'self' 'unsafe-inline'` — intentional waiver).
5. `docs/security/csp.md` exists with full directive table + style-src waiver + script-src v1.1 hardening plan.
6. `tests/e2e/features/csp_regression.feature` + `tests/e2e/steps/csp.ts` exist.
7. `npm run lint` ≤ baseline.
8. `npm run typecheck`: 0 errors.
9. `npm run test`: 100 % pass; case count unchanged (no Vitest additions).
10. `npm run test:e2e -- --workers=1`: passing count = post-Wave-7a baseline + 3.
11. `npm run frontend:build`: bundle sizes unchanged (static CSP; no bundle impact).
12. `npm run check:advisors` + `npm run check:bundle`: green.
13. No new npm dep.
14. No middleware file created (original draft abandoned).
15. No new `pg_cron` job, no new Supabase Edge Function, no new GitHub Actions workflow.
16. Manual prod-smoke checklist documented in Task 1 PR body — operator performs post-deploy; Sentry test-error lands in dashboard.
17. **Test-impact reconciled**: only new tests are the 3 E2E scenarios. Vitest unchanged.

---

## Commit & Push to Main

1. Task 1 lands first.
2. Task 2 after Task 1 (prefer after Task 1 is deployed, so manual smoke can run in parallel with Task 2 development).
3. Task 3 last.
4. Post-deploy (Task 1): operator walks the manual smoke checklist BEFORE Task 3 closes.
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

For Task 2 additionally:
```bash
npm run test:e2e -- --workers=1 --grep "CSP regression"
```

Each `FAIL → HALT`.

---

## Key References

- `CLAUDE.md` — §11 CI.
- `docs/audits/wave-1a/index.md` § Wave 7-csp.
- `vercel.json` — CSP SSoT.
- `frontend/index.html` — script tag consumes nonce.
- Wave 7a's `docs/security/rls-policies.md` — CSP is the HTTP-layer complement to RLS.

---

## Critical Files

**Will create**:
- `docs/security/csp.md` (Task 1)
- `tests/e2e/features/csp_regression.feature` (Task 2)
- `tests/e2e/steps/csp.ts` (Task 2)

**Will edit**:
- `vercel.json` (Task 1 — `connect-src` only)
- `docs/audits/wave-1a/index.md` (Task 3 — CSP findings only)
- `docs/expansion/98_PROGRESS_LOG.md` (Task 3)

**Will NOT edit**:
- `CLAUDE.md`, any `.claude/wave-*.md`.
- `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `tests/factories/**`, `tests/helpers/**`, `tests/setup.js`.
- `frontend/src/**`, `packages/core/src/**`, `supabase/**`.
- `docs/security/rls-policies.md` (Wave 7a).
- `docs/testing/**`.

---

## Out of Scope This Wave (7b)

- `style-src` nonce migration (waived).
- CSP `report-uri` / violation reporting.
- HSTS.
- SRI.
- pgTAP (Wave 7a).
- Any production UI change.
- Paid tiers.
- Adding a `middleware.js` (deferred; original draft abandoned).

---

## Ground Rules

- **Static CSP is the chosen path**. Middleware-based nonce is deferred to v1.1 with a documented follow-up; do NOT build it in this wave.
- **Scope-bounded directive edits**. Only `connect-src` changes. `script-src`, `style-src`, and everything else in `vercel.json` stays verbatim.
- **Style-src waiver is honest**. Documented in `docs/security/csp.md` with a concrete v1.1 follow-up plan.
- **Script-src v1.1 plan is honest too**. Hardening options documented but not built.
- **Manual prod smoke is mandatory**. E2E validates dev-mode contract; operator confirms Sentry errors land in dashboard post-deploy (the connect-src fix is only observable there).
- **No new deps, no new Edge Functions, no new `pg_cron` jobs**.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task.
