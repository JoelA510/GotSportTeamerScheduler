# Wave 9b — Release Cutover: Seven-Gate Verification + `v1.0.1` Tag

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4, 5, 6a, 6b, 7a, 7b, 8, 9a shipped. Wave 9a delivered the three prerequisites: Lighthouse CI (`.lighthouserc.js` + workflow), `docs/security/owasp-audit.md`, `CHANGELOG.md` + `package.json` version bump to `1.0.1` + `README.md` refresh.

**This wave's purpose**: the cutover. Run the full seven-gate verification TWICE + complete the operator manual-smoke checklist + tag `v1.0.1` + create the GitHub Release + append the terminal progress-log entry.

**Tagging discipline (load-bearing)**: `v1.0.1` is **socially irreversible** once pushed. Anyone watching the repo sees the release. The second verification walk exists to catch flaky state that slipped into the first. If ANY gate fails on the second pass, HALT + investigate + rerun — do NOT proceed to tag.

**This is the terminal wave**. Post-Wave-9b, the wave-by-wave loop ends. Hotfixes go to `v1.0.2` (patch releases); new features go into a v1.1 planning pass.

**Wave 9b is**:
- TWO independent walks through the seven-gate verification.
- Five manual prod smokes (CSP / Sentry / advisor / Vercel deploy / cron workflows).
- `git tag -a v1.0.1` + `git push origin v1.0.1`.
- `gh release create v1.0.1` with CHANGELOG body.
- Terminal updates to `docs/audits/wave-1a/index.md` + `docs/expansion/98_PROGRESS_LOG.md`.

**Wave 9b is NOT**:
- Any code change.
- Any CHANGELOG / OWASP / Lighthouse additions (Wave 9a owned).
- Feature work.
- A v1.0.2 patch (separate future work).
- v1.1 planning.
- External announcement / social media.

---

## Pre-flight Verification

HALT on any false claim. This is the final pre-flight before the tag.

1. `git status` on `main` is clean.
2. Wave 9a merged: `.lighthouserc.js`, `.github/workflows/lighthouse.yml`, `docs/operations/lighthouse.md`, `docs/security/owasp-audit.md`, `CHANGELOG.md` all present. `package.json` version is `1.0.1`. `README.md` status banner mentions v1.0.1.
3. **All gate scripts defined in `package.json`**: `npm run | grep -E "lint|typecheck|test|test:e2e|check:advisors|check:bundle|frontend:build|lighthouse:local"` returns every script the seven gates invoke. `check:advisors` + `check:bundle` ship with Wave 6a; `lighthouse:local` ships with Wave 9a. If any is missing, a prior wave hasn't fully executed — HALT + resolve before running the cutover.
4. `docs/audits/wave-1a/index.md` distribution table: zero findings carry `Proposed wave: <any>` without a `✅` shipped marker OR a recorded waiver. Confirm via a full text scan of the index.
5. `gh auth status` — authenticated GitHub CLI with push + release permissions on the repo.
6. No existing `v1.0.1` tag: `git tag -l v1.0.1` returns empty locally AND `git ls-remote --tags origin v1.0.1` returns empty on origin.
7. Vercel production deploy is healthy (operator confirms via dashboard + live URL 200 check).
8. Supabase advisor dashboard: 0 ERROR + 0 high-severity WARN.
9. `VITE_SENTRY_DSN` set in Vercel Production (Wave 2).
10. All prior wave closure commits visible in `git log --oneline -30`.

---

## Branch Conventions

- Single branch: `claude/wave-9b-release-tag`.
- PR opens, CI goes green, merge to main, then the tag push happens on `main`.
- Tag operation IS the PR's final step; the closing commits (audit-index + progress-log) merge first, then the tag ships.

Alternative flow: merge the docs updates in Task 1 (step by step below), then a SEPARATE `git tag` + `git push origin v1.0.1` + `gh release create` sequence directly on `main`. Either works; the PR flow is slightly safer because it lets CI run one more time before tag creation.

---

## Wave Scope

One task — the cutover.

---

## Task 1 — Seven-Gate Verification TWICE + `v1.0.1` Tag + Release

**Commit**: `chore(release): v1.0.1 closure`

**Branch**: `claude/wave-9b-release-tag`

### Steps

1. Checkout `claude/wave-9b-release-tag` from latest `main`. Confirm the Wave 9a commits are present (Lighthouse config, OWASP doc, CHANGELOG, version bump, README banner).

2. **FIRST walk — seven-gate verification**. Every gate must pass.

   ```bash
   # Gate 1: lint
   npm run lint                                      # 0 errors; warnings ≤ baseline

   # Gate 2: typecheck
   npm run typecheck                                 # 0 errors

   # Gate 3: unit tests + coverage
   npm run test                                      # 100 % pass
   npm run test:coverage                             # thresholds met

   # Gate 4: build
   npm run frontend:build                            # clean

   # Gate 5: CI guards (Wave 6a + 9a)
   npm run check:bundle                              # within budgets
   npm run check:advisors                            # zero new flags

   # Gate 6: E2E
   npm run test:e2e -- --workers=1                   # target pass-count per Wave 5 close

   # Gate 7: Lighthouse (Wave 9a)
   npm run lighthouse:local                          # all assertions pass
   ```

   Record each gate's output in a local scratch file. If ANY gate fails, HALT; diagnose; re-run the ENTIRE first walk (not just the failing gate) after fix.

3. **SECOND walk — repeat every gate**. Fresh invocations. The second walk's purpose: catch non-deterministic state (flaky E2E, timing-sensitive Lighthouse assertions, OS-specific lint drift). If ANY gate fails on the second walk, HALT — tag creation is blocked until both walks are clean.

   Record each gate's output separately from the first walk.

4. **Operator manual prod smokes** — each must be marked DONE before tagging. Capture results in the PR body:

   a. **CSP prod smoke** (per `docs/security/csp.md` + `docs/operations/sentry-smoke.md`):
      - Load production URL; DevTools → Network → response shows the CSP header with `connect-src` including `*.ingest.sentry.io` (Wave 7b fix).
      - DevTools → Console during golden-path flow (login → dashboard → import → schedule): zero CSP violations.

   b. **Sentry smoke**:
      - In prod DevTools console: `throw new Error('v1.0.1 release smoke ' + Date.now())`.
      - Within 60 s, the error appears in the Sentry dashboard with `environment: production` and the fresh timestamp.

   c. **Supabase advisor dashboard**:
      - Supabase project → Advisors.
      - 0 ERROR findings. 0 high-severity WARN findings. Any WARN-level items are documented in `docs/audits/wave-1a/index.md` or `docs/security/dependabot-waivers.md` with a follow-up.

   d. **Vercel deploy health**:
      - Vercel project → most recent production deploy shows "Ready" state.
      - Response headers on prod URL: `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: …` (enforcing, matching `vercel.json`).

   e. **GitHub Actions workflows healthy**:
      - `ci.yml` most recent run on `main`: green.
      - `cleanup-raw-imports.yml` (Wave 6b): last scheduled run green OR successful manual `workflow_dispatch`.
      - `pgtap.yml` (Wave 7a): last conditional run green (or never-run; if never-run, trigger `workflow_dispatch` now and confirm green).
      - `lighthouse.yml` (Wave 9a): last run green (from Wave 9a Task 1's PR or a manual dispatch).

   If any smoke fails, HALT. Do NOT tag until all five are DONE.

5. **Create the annotated tag** — ONLY after both walks + all five manual smokes pass:

   ```bash
   git tag -a v1.0.1 -m "v1.0.1 — hardening release

   See CHANGELOG.md for the complete changelist (Waves 1a–8).

   Highlights:
   - Security advisor cleanup (SECURITY INVOKER view, search_path lock on 6
     definer functions, private raw-imports bucket, Sentry DSN + CSP fix,
     Dependabot triage).
   - Test infrastructure consolidation (factories, helpers, hoisted-auth
     idiom); 5 representative tests migrated.
   - OrganizationCreation cold-start flow + route + E2E.
   - E2E stabilization to Wave-5 target with documented waivers.
   - Free-tier guards (bundle budget, advisor-lint, edge-cache,
     DB indexes, storage retention via GitHub Actions).
   - pgTAP live-DB RLS tests + CSP connect-src Sentry fix.
   - Docs gap closure + claude.md → CLAUDE.md rename.
   - Lighthouse CI + OWASP Top 10 audit.

   This tag marks the terminal v1.0.1 state. Post-1.0.1 work tracked
   outside the wave-by-wave plan system."
   ```

6. **Push the tag — the irreversible step**:
   ```bash
   git push origin v1.0.1
   ```
   Once pushed, the tag is visible to everyone watching the repo.

7. **Create the GitHub Release**:
   ```bash
   # Extract the [1.0.1] section body from CHANGELOG.md into a tempfile.
   # Exact extraction command varies by platform; a Node one-liner works everywhere:
   node -e "
     const fs = require('fs');
     const md = fs.readFileSync('CHANGELOG.md', 'utf8');
     const match = md.match(/## \[1\.0\.1\][\s\S]*?(?=\n## \[|$)/);
     fs.writeFileSync('.release-notes-v1.0.1.md', match ? match[0] : '(see CHANGELOG.md)');
   "

   gh release create v1.0.1 \
     --title "SquadLogic v1.0.1 — Hardening Release" \
     --notes-file .release-notes-v1.0.1.md \
     --latest

   rm .release-notes-v1.0.1.md
   ```
   If the `gh` CLI isn't installed / available in the environment, use the web UI: GitHub repo → Releases → Draft a new release → Tag `v1.0.1` → Title + body (paste CHANGELOG section) → Publish.

8. **Update `docs/audits/wave-1a/index.md`** — prepend `✅` on any Wave-9-release findings; append a final `## Wave 9 closure + v1.0.1 shipped` section summarizing:
   - Lighthouse CI: N assertions; all green at tag time.
   - OWASP audit: 9 mitigated / 1 partial / 1 N/A.
   - CHANGELOG: shipped; `[Unreleased]` placeholder in place.
   - Version: 1.0.0 → 1.0.1.
   - Tag: `v1.0.1` pushed + GitHub Release live at `<url>`.

9. **Append the TERMINAL entry to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 9 release readiness + v1.0.1 tagged

   Wave 9a (three PRs):
   - Lighthouse CI + budgets + conditional workflow + docs.
   - OWASP Top 10 (2021) audit — 9 mitigated / 1 partial / 1 N/A.
   - CHANGELOG.md + package.json 1.0.0 → 1.0.1 + README banner.

   Wave 9b (this entry):
   - Seven-gate verification walked TWICE; both passes green.
   - Five operator manual smokes DONE (CSP / Sentry / advisor / Vercel / Actions).
   - git tag -a v1.0.1 + git push origin v1.0.1 — irreversible.
   - gh release create v1.0.1 — live.

   **The wave-by-wave loop terminates here.** Post-1.0.1 work is
   tracked outside this plan system. Patch releases go to v1.0.2;
   new features go into a v1.1 planning pass.
   ```

10. Commit the two doc updates on the PR branch, push, open PR titled `chore(release): v1.0.1 closure`. PR body must include:
    - First-walk gate results (7 gates × status).
    - Second-walk gate results (7 gates × status).
    - Five manual-smoke results (each DONE).
    - Tag creation confirmation.
    - GitHub Release URL.
    - CI status on the PR itself (green).

11. After PR merges: the closing commits land on `main`, the tag is already live, the Release is already live. The wave system enters its terminal state.

### Tests to add (Task 1)

- None.

### Out of scope (Task 1)

- Any code change.
- Any CHANGELOG / OWASP / Lighthouse modifications (Wave 9a).
- External announcements.
- v1.0.2 patch planning.
- v1.1 feature planning.
- Editing any `.claude/wave-*.md` file.

---

## Documentation Currency Pass

Task 1 edits:
1. `docs/audits/wave-1a/index.md` — terminal closure section.
2. `docs/expansion/98_PROGRESS_LOG.md` — terminal entry.

Do NOT touch anything else.

---

## Wave Review (Before `git push origin v1.0.1`)

This is the check-twice list before the irreversible push. Every "no" blocks the tag.

1. Wave 9a fully merged on `main`; all its artifacts present.
2. `docs/audits/wave-1a/index.md`: zero findings without `✅` or documented waiver.
3. **First walk**: all 7 gates green. Output captured.
4. **Second walk**: all 7 gates green. Output captured.
5. Manual smoke a (CSP): DONE.
6. Manual smoke b (Sentry): DONE.
7. Manual smoke c (advisor dashboard): DONE.
8. Manual smoke d (Vercel deploy): DONE.
9. Manual smoke e (Actions workflows): DONE.
10. `git tag -l v1.0.1` returns empty (not yet created).
11. `git ls-remote --tags origin v1.0.1` returns empty (not yet pushed).
12. `gh auth status` shows authenticated.
13. `package.json` version is `1.0.1`.
14. `CHANGELOG.md` has a `[1.0.1]` section with accurate body.
15. `README.md` banner mentions v1.0.1.
16. CI on the `claude/wave-9b-release-tag` branch PR is green (or will go green before merge).
17. No uncommitted changes: `git status` clean.

---

## Verification Gate (Before tagging)

The seven gates are the verification. Walk them twice. See Step 2–3 above.

---

## Commit & Push Sequence (Task 1)

1. Open PR with the two doc updates (audit-index + progress-log terminal entry).
2. CI runs on PR; green.
3. Run both verification walks on the PR branch (seven gates × 2).
4. Complete the five manual smokes.
5. Merge the PR to `main`.
6. On `main`, run the tag creation + push + GitHub Release commands.
7. After tag + release: no further commits. Wave system terminates.

Alternative order: run verification walks + manual smokes BEFORE opening the PR (on main post-Wave-9a); if all green, open PR; merge; tag immediately after. Either order respects the "tag only after both walks + smokes" rule.

---

## Key References

- `docs/audits/wave-1a/index.md` § Wave 9-release.
- `CHANGELOG.md` — `[1.0.1]` section body is the release-note source.
- `docs/security/csp.md` — manual smoke a reference.
- `docs/operations/sentry-smoke.md` — manual smoke b reference.
- `.lighthouserc.js` — gate 7 assertions.
- `scripts/check-bundle-size.js` + `scripts/advisor-lint.js` — gate 5 implementations.
- Wave 9a closure — the prerequisite artifacts live here.

---

## Critical Files

**Will edit**:
- `docs/audits/wave-1a/index.md` — terminal closure section
- `docs/expansion/98_PROGRESS_LOG.md` — terminal entry

**Will create** (on operator's filesystem, NOT committed):
- `.release-notes-v1.0.1.md` — transient; extracted from CHANGELOG; removed after `gh release create`.

**Will NOT edit**:
- Any source code.
- Any test file.
- `package.json`, `package-lock.json`.
- `CHANGELOG.md` (already shipped in Wave 9a).
- `README.md` (already updated in Wave 9a).
- `CLAUDE.md`.
- Any `.claude/wave-*.md`.
- `docs/archive/**`.
- `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- Any Lighthouse / OWASP file (all shipped in Wave 9a).

**Will perform** (git-level + GitHub-level operations):
- `git tag -a v1.0.1 -m "…"`.
- `git push origin v1.0.1` (irreversible).
- `gh release create v1.0.1 …`.

---

## Out of Scope This Wave (9b)

- Any code change.
- Any Wave 9a artifact modification.
- External announcements (social media, email, etc.).
- v1.0.2 patch release.
- v1.1 feature planning.
- Back-porting fixes to v1.0.0.
- Editing `.claude/wave-*.md`.
- Retroactive changes to any prior wave's work.

---

## Ground Rules

- **Tagging is socially irreversible**. The TWO walks + the FIVE manual smokes must all be DONE before `git push origin v1.0.1`. No exceptions.
- **Both walks from a clean state**. Run `git status` clean before each walk; no stashed changes, no uncommitted edits.
- **Record results in the PR body**. Reviewers + future-you can audit the cutover.
- **Fresh invocations on walk 2**. Don't copy-paste output from walk 1. Run the commands again.
- **HALT on any gate failure**. First walk fail → fix + re-run walk 1 entirely. Second walk fail → HALT + investigate.
- **Manual smokes are non-negotiable**. Each must be DONE with evidence (screenshot note / dashboard confirmation).
- **Post-tag is immutable**. If regression surfaces after the tag, hotfix goes to `v1.0.2`. Do NOT `git tag -d v1.0.1` + re-push.
- **No code change**. This wave is pure verification + tag + release. Any code change surfaces in v1.0.2 (or later).
- **No `--no-verify`, no `--force-push`, no direct commits to `main`** for PRs; but the tag IS pushed to main (that's the whole point).
- **5-attempt debugging cap** per gate. If stuck on a gate for > 5 attempts, escalate + fix in a separate PR (which would then ship as v1.0.2 — or gate `v1.0.1` until the fix lands).
- **Terminal state is terminal**. Post-Wave-9b, this plan system ends. Any new work needs its own planning artifacts.
