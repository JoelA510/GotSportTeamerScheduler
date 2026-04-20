# Wave 9a — Release Prep: Lighthouse CI + OWASP Audit + CHANGELOG / Version / README

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4, 5, 6a, 6b, 7a, 7b, 8 shipped. Wave 9 is the final release cutover, split into 9a (prep) + 9b (verification + tag).

**Wave 9 split**: monolithic Wave 9 estimated at 800 lines; splitting keeps each under the 700 cap and isolates the socially-irreversible tag step into its own reviewable plan.

**Wave 9a purpose**: ship the three infrastructure + documentation artifacts that Wave 9b's cutover needs in place BEFORE tagging:
1. Lighthouse CI + perf / a11y budgets with conditional workflow.
2. `docs/security/owasp-audit.md` — OWASP Top 10 (2021) walk with evidence per category.
3. `CHANGELOG.md` (Keep-a-Changelog) + `package.json` version bump to `1.0.1` + `README.md` status banner refresh.

**Audit backlog**: `docs/audits/wave-1a/index.md` `### Wave 9-release`. By Wave 9b close, every finding in the audit index should be either `✅ shipped` or waived-with-follow-up.

**Wave 9a is**:
- `.lighthouserc.js` + `.github/workflows/lighthouse.yml` + `docs/operations/lighthouse.md`.
- `docs/security/owasp-audit.md`.
- `CHANGELOG.md` at repo root.
- `package.json` `1.0.0 → 1.0.1`.
- `README.md` status banner refresh.

**Wave 9a is NOT**:
- The `v1.0.1` tag (Wave 9b).
- The GitHub Release (Wave 9b).
- The final seven-gate verification walk (Wave 9b).
- Any feature or breaking change.
- New deps beyond `@lhci/cli`.
- CSP, pgTAP, or Edge Function additions.

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. Every prior wave shipped — `.claude/wave-{1a,1b,2,3a,3b,4,5,6a,6b,7a,7b,8}-prompt.md` present.
3. `docs/audits/wave-1a/index.md` `### Wave 9-release` readable.
4. `CLAUDE.md` (uppercase) is the committed agent-instructions file (Wave 8).
5. `docs/security/csp.md` + `docs/security/rls-policies.md` exist.
6. `docs/operations/` has: `bundle-budget.md`, `advisor-lint.md`, `edge-function-budget.md`, `storage-retention.md`, `production-cutover.md`, `ENVIRONMENT.md`, `sentry-smoke.md`, `ingestion-pipeline.md`.
7. `docs/testing/` has: `test-helpers.md`, `pgtap.md`, `e2e-waivers.md`, `e2e_master_plan.md`.
8. `package.json` version is `1.0.0` (not already bumped).
9. No existing `CHANGELOG.md` at repo root.
10. No `@lhci/cli` in `package.json`.
11. **Wave 6a CI scripts present**: `npm run | grep -E "check:advisors|check:bundle"` returns both. These scripts ship with Wave 6a (`scripts/check-bundle-size.js` + `scripts/advisor-lint.js`) — if either is missing, Wave 6a hasn't executed yet and Wave 9a must WAIT. HALT until Wave 6a merges.
12. Baselines: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run check:advisors`, `npm run check:bundle`, `npm run frontend:build` all green on `main`.
13. `npm run test:e2e -- --workers=1` passing count matches Wave 5 closure target (63/63 or documented N/63 with waivers).

---

## Branch Conventions

- One branch per task:
  - `claude/wave-9a-lighthouse` → Task 1
  - `claude/wave-9a-owasp-audit` → Task 2
  - `claude/wave-9a-changelog-version` → Task 3

All three independent; merge in any order. Wave 9b depends on all three being on `main`.

PR per task. Wave 6a + 7a CI gates stay green.

---

## Wave Scope

Three parallel tasks: Lighthouse + OWASP + release metadata. Each produces its artifacts independently; Wave 9b consumes them.

---

## Task 1 — Lighthouse CI + Budgets

**Commit**: `feat(ci): add lighthouse budgets for perf + a11y regressions`

**Branch**: `claude/wave-9a-lighthouse`

### Steps

1. Checkout `claude/wave-9a-lighthouse` from latest `main`.

2. **Install `@lhci/cli`**:
   ```bash
   npm install --save-dev @lhci/cli
   ```
   One new dev dep.

3. **Create `.lighthouserc.js`** at repo root with these assertions (matching Phase 2 targets):
   - Perf ≥ 85 (error); A11y ≥ 95 (error); Best-Practices ≥ 95 (error); SEO ≥ 85 (warn).
   - LCP < 3500 ms (warn); CLS < 0.1 (error); TBT < 300 ms (warn).
   - `numberOfRuns: 3` (averages jitter).
   - `staticDistDir: './dist'` — Lighthouse CI serves `dist/` via its own HTTP server; no running dev server needed.
   - 3 pages audited: root (`/index.html`), login route, `/organizations/new` (Wave 4). Confirm exact URLs against current router at execution time.
   - `upload.target: 'temporary-public-storage'` (free, no auth, 7-day retention).

4. **Create `.github/workflows/lighthouse.yml`** — conditional trigger (same discipline as Wave 7a pgTAP):
   ```yaml
   name: Lighthouse
   on:
     pull_request:
       paths:
         - 'frontend/**'
         - 'packages/**'
         - 'vercel.json'
         - 'package.json'
         - 'package-lock.json'
         - 'vite.config.js'
         - '.lighthouserc.*'
         - '.github/workflows/lighthouse.yml'
     workflow_dispatch: {}
   jobs:
     lighthouse:
       runs-on: ubuntu-latest
       timeout-minutes: 15
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20', cache: 'npm' }
         - run: npm ci
         - run: npm run frontend:build
         - run: npm run check:bundle
         - run: npm run lighthouse:local
   ```
   Conditional trigger keeps Actions minutes in check: ~2–3 min × ~20 relevant PRs/mo ≈ 40–60 min/mo.

5. **Add npm script** (add FIRST — the workflow in Step 4 calls this by name so the script must exist when the workflow runs):
   ```json
   "lighthouse:local": "lhci autorun --config=.lighthouserc.js"
   ```
   Local workflow: `npm run frontend:build && npm run lighthouse:local`. The CI workflow uses the same script for consistency; `.lighthouserc.js` is the single config source.

6. **Baseline run + triage** — run Lighthouse locally after writing the config. For each failing assertion:
   - **Trivially fixable** (missing `<meta>`, non-descriptive `<title>`, missing `<html lang>` if not already, alt attributes): apply inline per Wave 1b trivial bar.
   - **Non-trivial** (bundle too large, layout shift, image weight): loosen the threshold with a rationale line in `.lighthouserc.js` OR re-file as a v1.1 follow-up. Do NOT ship a Wave 9a PR where assertions reject.

7. **Write `docs/operations/lighthouse.md`** (new, ~40 lines):
   - Thresholds table (from `.lighthouserc.js`).
   - Running locally (3 commands).
   - "When a PR fails a budget" — three paths: fix the cause / loosen with rationale / escalate.
   - Known limitations: SPA static-dist auditing; Chromium-only; doesn't replace prod manual smoke.

8. **Update `.gitignore`** — add `.lighthouseci/` (generated artifacts; never committed).

9. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build && npm run lighthouse:local
   git status
   ```

10. Commit, push, open PR. PR body includes: baseline numbers per page + category, inline fixes applied, any loosened thresholds with rationale.

### Tests to add (Task 1)

- None in Vitest. Lighthouse is its own test system.
- Trivial a11y / meta-tag inline fixes allowed per Wave 1b trivial bar.

### Out of scope (Task 1)

- Auditing post-auth flows (staticDistDir limitation).
- Cross-browser / mobile-device emulation.
- CDN / preload / prefetch tuning.
- PWA score auditing.
- Performance refactoring beyond trivial.

---

## Task 2 — OWASP Top 10 (2021) Audit

**Commit**: `docs(security): owasp top 10 audit`

**Branch**: `claude/wave-9a-owasp-audit`

### Steps

1. Checkout `claude/wave-9a-owasp-audit` from latest `main`.

2. **Write `docs/security/owasp-audit.md`** (new). One section per OWASP Top 10 (2021) category. Each section:
   - **Status**: `MITIGATED` / `PARTIAL` / `NOT APPLICABLE`.
   - **Evidence**: file paths, test IDs, wave references. Every bullet cites something that exists.
   - **Known gaps**: open items OR "none".

3. **Canonical categories + expected statuses** (verify each at doc-authoring time):
   - **A01 Broken Access Control — MITIGATED**. Evidence: RLS on every domain table (advisor-lint Wave 6a); pgTAP RLS invariant tests (Wave 7a); `<ProtectedRoute>` + `permissions.js`; `initialize_new_tenant` assigns admin role.
   - **A02 Cryptographic Failures — MITIGATED**. Evidence: HTTPS enforced (`upgrade-insecure-requests`); secrets never in `VITE_*`; Supabase manages session storage.
   - **A03 Injection — MITIGATED**. Evidence: Zod validation per `CLAUDE.md` §3; parameterized Supabase client queries; Wave 6a advisor-lint catches `SECURITY DEFINER` without `SET search_path`.
   - **A04 Insecure Design — MITIGATED**. Evidence: governance framework; RPC-only writes; Wave 1a audit + Waves 1b–8 resolution.
   - **A05 Security Misconfiguration — MITIGATED**. Evidence: Wave 6a advisor-lint; Wave 7a pgTAP; enforcing CSP (Wave 2 + Wave 7b connect-src fix); `VITE_*` scope doc.
   - **A06 Vulnerable Components — MITIGATED**. Evidence: Dependabot enabled; Wave 2 Task 5 triage; `docs/security/dependabot-waivers.md` if waivers exist.
   - **A07 Auth Failures — MITIGATED**. Evidence: Supabase Auth; leaked-password protection enabled (Wave 2 §2.3); password-length trigger.
   - **A08 Software & Data Integrity — PARTIAL**. Evidence: `script-src 'self'`; `strict-dynamic` + nonce/hash deferred to v1.1+ (Wave 7b waiver). If Supabase webhooks exist: signature verification inventory.
   - **A09 Logging & Monitoring — MITIGATED**. Evidence: `audit_log` table; Sentry (Wave 2 DSN + Wave 7b connect-src); BetterStack logging.
   - **A10 SSRF — NOT APPLICABLE**. Evidence: no user-controlled URLs in `supabase/functions/**/*.ts` fetch calls. Verify during Task 2 execution.

4. **Verify every "evidence" bullet** — walk the citations. If a reference is broken (path doesn't exist, test ID missing), FIX the doc (not the code) — the audit is evidence-based.

5. **Summary section at the bottom**:
   - Mitigated: 9 categories.
   - Partial: 1 (A08 — script-src hardening deferred with documented v1.1 follow-up in `docs/security/csp.md`).
   - Not applicable: 1 (A10).
   - Open findings: 0 (per `docs/audits/wave-1a/index.md`).
   - Re-audit cadence: at every major release.

6. **Do NOT**:
   - Rewrite `rls-policies.md` or `csp.md` content — cite + link them.
   - Add new security controls (out of scope for Wave 9).
   - Run third-party pen-test tools.
   - Generate SBOM or compliance-mapping docs.

7. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run format -- docs/security/owasp-audit.md
   git status
   ```

8. Commit, push, open PR. PR body summarizes: 9 mitigated / 1 partial / 1 N/A + any evidence gap surfaced.

### Tests to add (Task 2)

- None.

### Out of scope (Task 2)

- Net-new security controls.
- Third-party pen-test / scan.
- SBOM.
- Compliance mapping (SOC 2, HIPAA, etc.).
- Re-auditing mitigated categories for redundant evidence.

---

## Task 3 — CHANGELOG + Version Bump + README Polish

**Commit**: `docs(release): v1.0.1 changelog + version bump + readme`

**Branch**: `claude/wave-9a-changelog-version`

### Steps

1. Checkout `claude/wave-9a-changelog-version` from latest `main`.

2. **Create `CHANGELOG.md`** at repo root in Keep-a-Changelog format. Sections (use actual shipping state; if reality diverged from plan, reflect reality):

   - Header: `# Changelog` + format + semver pointers.
   - `## [Unreleased]` — placeholder for v1.1 work.
   - `## [1.0.1] - 2026-MM-DD` — main body. Sub-sections:
     - **Added**: wave-scoped bullets (one per wave's net-new artifact).
     - **Changed**: wave-scoped bullets (refactors, renames).
     - **Fixed**: real bug fixes (Wave 2 security advisors; Wave 5 E2E stabilization; Wave 7b CSP connect-src).
     - **Security**: security-specific highlights (Wave 7a pgTAP; Wave 7b CSP doc; Wave 9a OWASP audit).
     - **Deprecated**: (empty for v1.0.1).
     - **Removed**: (empty for v1.0.1).
   - `## [1.0.0] - 2026-04-XX` — brief retrospective pointer to `docs/expansion/03_ROADMAP.md`.

3. **Wave-walk discipline** — walk every `.claude/wave-*-prompt.md` + the matching closure entries in `docs/expansion/98_PROGRESS_LOG.md`. For each wave extract the shipping-state summary (not the plan). Common format per entry:
   ```
   - Wave <N>: <what actually shipped + delta metrics if applicable>
   ```
   Example (Wave 5):
   ```
   - Wave 5: `@axe-core/playwright` integration + 10 a11y-gated E2E
     scenarios; baseline 40/63 → 62/63 passing with 1 waived scenario
     in docs/testing/e2e-waivers.md.
   ```
   If a wave closed with a deviation from plan, reflect it honestly.

4. **Bump `package.json`**: `"version": "1.0.0"` → `"version": "1.0.1"`. Do NOT edit any other field.

5. **Update `README.md`** — surgical edits only:
   - Replace the status-banner line (e.g., "v1.0 GA — Phase 10 …") with: "v1.0.1 — hardening release; see [CHANGELOG.md](./CHANGELOG.md)".
   - Confirm the build-status badge URL still points at the correct CI workflow (no change unless the URL drifted).
   - Add ONE line in the Overview section acknowledging v1.0.1 scope (hardening, not features) — optional if the status banner is sufficient.
   - Do NOT rewrite feature descriptions, screenshots, or install instructions.

6. **Add `[Unreleased]` marker** at the top of `CHANGELOG.md` so v1.1 has a ready target. Body can be:
   ```
   ### Added
   - (Follow-ups from v1.0.1's OWASP audit + CSP doc appear here as they ship.)
   ```

7. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   npm run format -- CHANGELOG.md README.md
   git status
   ```

8. Commit, push, open PR. PR body includes: CHANGELOG summary per section + any wave-shipping-state deviations captured honestly.

### Tests to add (Task 3)

- None.

### Out of scope (Task 3)

- Creating GitHub Release (Wave 9b).
- Pushing the `v1.0.1` tag (Wave 9b).
- Badge artwork changes.
- Rewriting README feature content.
- Migrating to a different changelog / semver framework.

---

## Documentation Currency Pass

Handled across Tasks 1–3:
1. `.lighthouserc.js` (new — Task 1).
2. `.github/workflows/lighthouse.yml` (new — Task 1).
3. `docs/operations/lighthouse.md` (new — Task 1).
4. `.gitignore` — `.lighthouseci/` added (Task 1).
5. `docs/security/owasp-audit.md` (new — Task 2).
6. `CHANGELOG.md` (new — Task 3).
7. `package.json` — version bump + `lighthouse:local` script (Tasks 1, 3).
8. `README.md` — status banner (Task 3).

Do NOT touch: `CLAUDE.md` content (Wave 8 owned filename; content frozen), any `.claude/wave-*.md`, `docs/archive/**`, source code (except Wave-1b-trivial a11y fixes from Task 1 Lighthouse baseline), test files.

---

## Wave Review (Before Wave 9b kicks off)

Any "no" blocks Wave 9b.

1. All 3 tasks merged; CI green.
2. `.lighthouserc.js` + workflow + doc exist; `npm run lighthouse:local` passes all assertions.
3. `docs/security/owasp-audit.md` exists with all 10 categories documented.
4. `CHANGELOG.md` exists with `[1.0.1]` + `[Unreleased]` sections.
5. `package.json` version is `1.0.1`.
6. `README.md` status banner updated.
7. `npm run lint`: warning count ≤ baseline.
8. `npm run typecheck`: 0 errors.
9. `npm run test`: 100 % pass; case count unchanged (no Vitest additions this wave).
10. `npm run test:e2e -- --workers=1`: passing count = Wave 5 closure target.
11. `npm run check:bundle` + `npm run check:advisors`: green.
12. One new dev dep (`@lhci/cli`); no other additions.
13. **Test-impact reconciled**: trivial a11y fixes from Task 1 may alter E2E scenarios if they touch selectors; confirm E2E count unchanged.

---

## Commit & Push to Main

1. Tasks 1, 2, 3 in any order.
2. After all 3 merge: Wave 9b (the cutover) can start.
3. On regression: revert PR within 30 min.

---

## Verification Gate (Per Task)

For all three tasks:
```bash
npm run lint && npm run typecheck && npm run test
npm run check:advisors && npm run check:bundle
npm run frontend:build
git status
```

For Task 1 additionally:
```bash
npm run lighthouse:local
```

For Task 3 additionally:
```bash
npm run format -- CHANGELOG.md README.md
```

Each `FAIL → HALT`.

---

## Key References

- `docs/audits/wave-1a/index.md` § Wave 9-release.
- Keep a Changelog: https://keepachangelog.com/en/1.1.0/
- OWASP Top 10 (2021): https://owasp.org/Top10/
- `docs/security/csp.md` — feeds OWASP A08 + A05.
- `docs/security/rls-policies.md` — feeds OWASP A01.
- `docs/operations/{bundle-budget,advisor-lint,edge-function-budget,storage-retention}.md` — feed OWASP A05.
- Every `.claude/wave-*-prompt.md` closure + `docs/expansion/98_PROGRESS_LOG.md` entries — feed CHANGELOG wave walk.

---

## Critical Files

**Will create**:
- `.lighthouserc.js` (Task 1)
- `.github/workflows/lighthouse.yml` (Task 1)
- `docs/operations/lighthouse.md` (Task 1)
- `docs/security/owasp-audit.md` (Task 2)
- `CHANGELOG.md` (Task 3)

**Will edit**:
- `package.json` (Tasks 1, 3 — `@lhci/cli` dev dep + `lighthouse:local` script + version bump)
- `package-lock.json` (Task 1 via `npm install`)
- `.gitignore` (Task 1 — add `.lighthouseci/`)
- `README.md` (Task 3 — status banner)
- Potentially `frontend/src/**/*.jsx` — trivial a11y / meta-tag fixes from Task 1 baseline (per Wave 1b bar)

**Will NOT edit**:
- Any `.claude/wave-*.md`.
- `CLAUDE.md`.
- `docs/archive/**`.
- `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `tests/factories/**`, `tests/helpers/**`, `tests/setup.js`.
- `supabase/migrations/**`, `supabase/functions/**`.
- `vercel.json` (CSP frozen post-Wave-7b).
- Existing `docs/**` beyond those explicitly listed.

---

## Out of Scope This Wave (9a)

- `v1.0.1` tag (Wave 9b).
- GitHub Release (Wave 9b).
- Final seven-gate verification walk (Wave 9b).
- New features / breaking changes.
- Third-party pen-test.
- Cross-browser / mobile E2E.
- SSR / SSG.
- 2FA / TOTP.
- `style-src` or `script-src` hardening (v1.1+ per Wave 7b waivers).
- CDN tuning.
- PWA score auditing.
- SBOM / compliance mapping.
- Archiving or deleting any doc.

---

## Ground Rules

- **Budgets are prevention, not aspiration**. Don't weaken a Lighthouse threshold to make a Wave 9a PR pass — fix the cause OR defer. Loosened thresholds require one-line rationale in the config.
- **OWASP evidence must exist**. Every citation in the audit doc points at a real file / test / wave. Broken citations = doc failure.
- **CHANGELOG reflects reality**. If a wave's shipping state differs from its plan (E2E 62/63 with 1 waiver, etc.), say so honestly.
- **README stays surgical**. Status banner + version mention only; no feature-content rewrites.
- **Single new dev dep** (`@lhci/cli`). No other additions.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task.
