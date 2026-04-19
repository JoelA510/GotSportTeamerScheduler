# Wave 7b — CSP `script-src` Nonce via Vercel Edge Middleware

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4, 5, 6a, 6b, 7a shipped. Wave 2 flipped the CSP from Report-Only to enforcing (commit `cb720a9`); Wave 7b tightens it by removing `'unsafe-inline'` from `script-src` in favor of a per-request nonce.

**Audit backlog**: `docs/audits/wave-1a/index.md` `### Wave 7-csp` (or similar CSP-tagged findings in the Wave 7 section — confirm in Task 1 pre-flight).

**Scope decision**: `script-src` only. `style-src 'unsafe-inline'` stays in place as a documented waiver — Tailwind 4 runtime + React inline-style props need inline styles, and a style-src nonce is a substantially bigger lift (build-time hash pass OR per-component style extraction) that doesn't fit v1.0.1. The waiver is honest: `docs/security/csp.md` lists a concrete v1.1 follow-up plan.

**Chosen mechanism**: Vercel Edge Middleware generates a nonce per request. The middleware adds the CSP header with `'nonce-<hex>'` on `script-src`; the nonce is consumed by the single bootstrap `<script>` tag in `frontend/index.html`; `'strict-dynamic'` trusts everything the bootstrap dynamically imports.

**Free-tier budget**: Vercel Hobby includes generous middleware invocations (confirm current spec at execution time). Projection at 100-org steady state: ~30 K middleware invocations/mo on HTML responses (static assets bypass the matcher). Well within free tier; documented in `docs/security/csp.md`.

**Wave 7b is**:
- `middleware.js` (or `.ts`) at the Vercel root emitting per-request CSP + nonce.
- `vercel.json` baseline CSP updated — `'unsafe-inline'` removed from `script-src`.
- `frontend/index.html` script tag accepts the nonce (via Vite plugin transform OR build-time placeholder + middleware replace).
- 3 E2E CSP regression scenarios.
- `docs/security/csp.md` (new) documenting directives + style-src waiver + follow-up plan.
- Closure: audit index + progress log update.

**Wave 7b is NOT**:
- `style-src` nonce migration (waived, with follow-up plan).
- CSP `report-uri` / violation reporting telemetry.
- HSTS header (separate concern).
- Subresource integrity (SRI).
- CSP Level 3 features beyond `strict-dynamic`.
- `vercel dev` integration for local middleware testing.
- pgTAP work (Wave 7a).

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. Wave 7a shipped — `supabase/tests/` exists with harness + 5 RLS tests.
3. `vercel.json` has an enforcing `Content-Security-Policy` header (NOT Report-Only). Current `script-src` contains `'unsafe-inline'`. Record the full directive list as the "before" state.
4. `frontend/index.html` has ONE main bootstrap script — likely `<script type="module" src="/src/main.jsx"></script>`. Record the exact element.
5. No `middleware.js` or `middleware.ts` at the repo root. If one exists, Task 1 extends it rather than creates.
6. Vercel project configuration (per `vercel.json`) is the SPA pattern (no Next.js). Middleware conventions follow the Vercel-core docs rather than Next.js-specific ones — confirm at execution time.
7. Baselines: `npm run lint` / `typecheck` / `test` / `frontend:build` / `check:bundle` / `check:advisors` all green. `npm run test:e2e` baseline from post-Wave-5.

---

## Branch Conventions

- One branch per task:
  - `claude/wave-7b-csp-middleware` → Task 1
  - `claude/wave-7b-csp-e2e` → Task 2 (depends on Task 1)
  - `claude/wave-7b-closure` → Task 3 (depends on 1 + 2)

PR per task. Wave 6a + 7a gates stay green.

---

## Task 1 — Vercel Edge Middleware + CSP Nonce

**Commit**: `feat(security): csp script-src nonce via vercel edge middleware`

**Branch**: `claude/wave-7b-csp-middleware`

### Steps

1. Checkout `claude/wave-7b-csp-middleware` from latest `main`.

2. **Snapshot current CSP** — read `vercel.json`'s `headers` section. Record every directive. This becomes the "before" state in the PR body.

3. **Create `middleware.js`** at the Vercel-expected path (likely `middleware.js` at repo root; Vercel docs authoritative at execution time):
   ```js
   // Vercel Edge Middleware — runs at the edge on every matched request.
   // Generates a per-request nonce, injects it into the CSP header,
   // and exposes it for frontend/index.html to consume.
   //
   // Runs in Edge Runtime (Web APIs only; no Node).
   // Free-tier invocation budget documented in docs/security/csp.md.

   export const config = {
     // HTML responses only; static assets bypass.
     matcher: ['/', '/:path((?!_next|_vercel|.*\\..*).*)'],
   };

   export default function middleware(request) {
     const nonce = crypto.randomUUID().replace(/-/g, '');

     const csp = [
       "default-src 'self'",
       `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
       "style-src 'self' 'unsafe-inline'",  // WAIVED — see docs/security/csp.md
       "img-src 'self' data: https:",
       "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io",
       "font-src 'self' data:",
       "object-src 'none'",
       "frame-ancestors 'none'",
       'upgrade-insecure-requests',
     ].join('; ');

     // Pass nonce through a response header; Vite transform consumes at
     // build time OR a serverless transform consumes per request.
     return new Response(null, {
       headers: {
         'Content-Security-Policy': csp,
         'x-nonce': nonce,
       },
     });
   }
   ```
   The EXACT Edge-middleware API shape varies by Vercel runtime version. Agent verifies at execution time via Vercel docs and adjusts (may need `NextResponse.next()` + header passthrough OR a different matcher). The pattern is: generate nonce, set CSP header with `'nonce-<value>'`, expose nonce for `index.html` to consume.

4. **Consume the nonce in `frontend/index.html`** — Option C (simplest + modern):
   - Add a build-time placeholder to the single bootstrap script tag: `<script type="module" src="/src/main.jsx" nonce="__CSP_NONCE__"></script>`.
   - The middleware replaces `__CSP_NONCE__` with the actual nonce in the HTML response body before sending. (Vercel Edge middleware can transform response bodies; confirm API at execution time.)
   - `'strict-dynamic'` in `script-src` trusts anything the bootstrap dynamically imports — no per-script nonce needed on Vite's code-split chunks.

   Alternatives if Option C isn't feasible on the Vercel runtime:
   - **Option A**: Vite `transformIndexHtml` plugin reads nonce from a request header and injects at render. Requires a Vite plugin; more code; similar outcome.
   - **Option B**: build with `__CSP_NONCE__` placeholder; hand-roll a middleware body-replace step.

   Agent picks the option that works against the current Vercel version. Document the choice in PR body.

5. **Update `vercel.json` baseline CSP** — remove `'unsafe-inline'` from `script-src`. This baseline is the fallback for paths the middleware doesn't match. For those paths, `script-src 'none'` is safest (they're static assets, not HTML).

6. **Write `docs/security/csp.md`** (new):
   ```markdown
   # Content Security Policy

   ## Directives (as of Wave 7b)

   | Directive | Value | Rationale |
   | --- | --- | --- |
   | default-src | 'self' | Deny-by-default baseline. |
   | script-src | 'self' 'nonce-<per-req>' 'strict-dynamic' | Per-request nonce via Vercel Edge Middleware; strict-dynamic trusts dynamically-imported chunks. |
   | style-src | 'self' 'unsafe-inline' | **WAIVED** — Tailwind 4 runtime + React inline styles. v1.1 follow-up: build-time hash pass OR component-level style extraction. |
   | img-src | 'self' data: https: | data: for generated avatars; https: for Supabase storage. |
   | connect-src | 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io | Supabase REST + realtime; Sentry ingest. |
   | font-src | 'self' data: | Bundled fonts only. |
   | object-src | 'none' | No plugins. |
   | frame-ancestors | 'none' | Anti-clickjacking. |
   | upgrade-insecure-requests | — | Force HTTPS for mixed content. |

   ## Middleware

   `middleware.js` at repo root generates a per-request nonce + injects
   into the CSP header. The nonce is consumed by `frontend/index.html`'s
   single bootstrap `<script>` tag; `'strict-dynamic'` trusts everything
   it dynamically imports.

   ## Free-tier budget

   Vercel Hobby middleware invocation allowance applies. Projection at
   100-org steady state: ~30 K invocations/month (1 per unique HTML page
   view; cached assets bypass the matcher). Monitor via Vercel dashboard.

   ## style-src waiver

   `'unsafe-inline'` on `style-src` is currently WAIVED. Rationale:
   - Tailwind 4 runtime emits some inline styles for CSS-variable overrides.
   - React's `style={{...}}` prop renders inline `style=""` attributes.
   - A nonce-based style-src would require either a build-time hash pass
     OR refactoring every React inline-style usage — a v1.1-scale effort.

   Follow-up plan (v1.1+):
   - Audit inline-style usage across `frontend/src/`.
   - Extract hot paths to Tailwind utilities or CSS modules.
   - Add a build-time hash step for the remaining inline styles.
   - Re-evaluate nonce vs hash CSP once inline-style count drops below a
     manageable bar.

   ## Manual prod smoke (post-deploy)

   - Load prod; DevTools → Network → response `Content-Security-Policy`
     header contains `'nonce-<hex>'`, NOT `'unsafe-inline'` on script-src.
   - DevTools → Console: zero CSP violations during golden-path flows.
   - Reload → nonce value CHANGES each request.
   ```

7. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   git status
   ```
   Middleware behavior can't be fully verified locally (Vercel Edge isn't emulated by `vercel dev` identically). Manual prod smoke follows the Task 1 PR body's checklist post-deploy.

8. Commit, push, open PR. PR body documents: before/after CSP directives, middleware option chosen (A/B/C), style-src waiver rationale, post-deploy smoke checklist.

### Tests to add (Task 1)

- None in Vitest (middleware runs on Vercel Edge; local unit tests diverge from prod).
- Task 2 adds E2E coverage.

### Out of scope (Task 1)

- `style-src` nonce migration.
- CSP reporting / telemetry.
- HSTS header.
- SRI.
- Non-nonce directive changes (scope creep).
- `vercel dev` local emulation.

---

## Task 2 — E2E CSP Regression Scenarios

**Commit**: `test(e2e): add csp regression scenarios`

**Branch**: `claude/wave-7b-csp-e2e`

**Depends on**: Task 1 merged. E2E runs in dev-mode (Vite), not Vercel Edge — tests the developer-time contract ("no inline-script patterns introduced"), not prod nonce behavior. Manual prod smoke from Task 1 complements this.

### Steps

1. Checkout `claude/wave-7b-csp-e2e` from latest `main` AFTER Task 1 merges.

2. **Write `tests/e2e/features/csp_regression.feature`**:
   ```gherkin
   Feature: Content Security Policy regression
     The app must not emit CSP violations during golden-path flows.
     A violation in the console OR a securitypolicyviolation event
     means the middleware or index.html nonce contract is broken.

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

4. **Scope caveat**: E2E runs against the Vite dev server in CI, NOT the Vercel Edge + middleware. The test validates the DEVELOPER-TIME contract (no inline-script patterns snuck in). Prod-deploy nonce behavior is validated via Task 1's manual smoke. Document in the feature-file comments.

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

2. **Update `docs/audits/wave-1a/index.md`** — Wave-7-csp findings (or whatever CSP-tagged subset in the Wave 7 section): prepend `✅`, set `Proposed wave` to `7b (shipped)`. Append a `## Wave 7b closure` section summarizing:
   - Vercel Edge Middleware generates per-request nonce.
   - `script-src 'unsafe-inline'` removed; `strict-dynamic` + nonce.
   - `style-src 'unsafe-inline'` WAIVED with concrete v1.1 follow-up plan.
   - 3 E2E CSP regression scenarios (baseline +3 passing).
   - Manual prod-smoke checklist documented.

3. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 7b CSP script-src nonce

   Three PRs shipped:
   - Task 1: Vercel Edge Middleware (middleware.js) generates per-request
     nonce; vercel.json baseline tightened; frontend/index.html consumes
     nonce via <option chosen>; docs/security/csp.md published.
   - Task 2: 3 E2E CSP regression scenarios (dev-mode contract; prod
     validated by manual smoke).
   - Task 3: closure.

   Style-src 'unsafe-inline' WAIVED with v1.1 follow-up documented in
   docs/security/csp.md (Tailwind 4 runtime + React inline-style props).

   Free-tier budget: ~30 K Vercel middleware invocations/mo at 100-org
   projection; well inside Hobby limits.
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

Do NOT touch: `claude.md`, `docs/architecture/**`, `docs/operations/**`, `docs/testing/**`, `docs/security/rls-policies.md` (Wave 7a owned), any `.claude/wave-*.md`.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 3 tasks merged with CI green (Wave 6a + 7a gates stay green).
2. `middleware.js` (or `.ts`) exists at the Vercel-expected path.
3. `vercel.json` `script-src` no longer contains `'unsafe-inline'` (baseline fallback tightened).
4. `frontend/index.html` consumes the nonce (via the option Task 1 chose).
5. `docs/security/csp.md` exists with directive table + style-src waiver + follow-up plan.
6. `tests/e2e/features/csp_regression.feature` + `tests/e2e/steps/csp.ts` exist.
7. `npm run lint` ≤ baseline.
8. `npm run typecheck`: 0 errors.
9. `npm run test`: 100 % pass; case count unchanged.
10. `npm run test:e2e -- --workers=1`: passing count = post-Wave-7a baseline + 3.
11. `npm run frontend:build`: bundle sizes unchanged (middleware runs at edge; no bundle impact).
12. `npm run check:advisors` + `npm run check:bundle`: green.
13. No new npm dep.
14. No new Edge Function (Vercel Middleware is NOT a Supabase Edge Function; don't conflate).
15. No new `pg_cron` job.
16. Manual prod-smoke checklist documented in Task 1 PR body — operator performs post-deploy.
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

- `claude.md` — §11 CI.
- `docs/audits/wave-1a/index.md` § Wave 7-csp.
- `vercel.json` — CSP SSoT.
- `frontend/index.html` — script tag consumes nonce.
- Vercel Edge Middleware docs (authoritative at execution time).
- Wave 7a's `docs/security/rls-policies.md` — CSP is the HTTP-layer complement to RLS.

---

## Critical Files

**Will create**:
- `middleware.js` (Task 1 — Vercel root)
- `docs/security/csp.md` (Task 1)
- `tests/e2e/features/csp_regression.feature` (Task 2)
- `tests/e2e/steps/csp.ts` (Task 2)

**Will edit**:
- `vercel.json` (Task 1 — baseline tightened)
- `frontend/index.html` (Task 1 — nonce consumption pattern)
- `docs/audits/wave-1a/index.md` (Task 3 — CSP findings only)
- `docs/expansion/98_PROGRESS_LOG.md` (Task 3)

**Will NOT edit**:
- `claude.md`, any `.claude/wave-*.md`.
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
- `vercel dev` integration for local middleware testing.
- Any production UI change.
- Paid tiers.

---

## Ground Rules

- **Middleware is the chosen path**. Static-hash alternatives are documented but not built.
- **`strict-dynamic` + ONE bootstrap nonce**. Do NOT nonce every Vite code-split chunk; `strict-dynamic` trusts them.
- **Style-src waiver is honest**. Documented in `docs/security/csp.md` with a concrete v1.1 follow-up.
- **Manual prod smoke is mandatory**. E2E in dev-mode validates the developer-time contract; operator validates the prod nonce contract post-deploy.
- **No new deps, no new Edge Functions, no new `pg_cron` jobs**.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task.
