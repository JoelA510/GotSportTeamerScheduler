# Wave 2 — Security Advisor Cleanup

## Session Context

**Prior-wave recap**: Waves 1a + 1b shipped. Wave 1a produced `docs/audits/wave-1a/` findings; Wave 1b fixed the trivial ones and annotated the distribution table. Every remaining finding is now tagged against a later wave.

**This wave's purpose**: close out the NEXT_SESSION_PLAN (2026-04-17) security backlog — 1 ERROR + 4 WARNs — plus GitHub Dependabot's 3 vulnerability alerts on the default branch. By the end of this wave, `docs/expansion/NEXT_SESSION_PLAN.md` is either archived or empty of security items, and Supabase's advisor dashboard shows no remaining high-severity findings.

**Scope items (exhaustive)**:

| NEXT_SESSION_PLAN id | Severity | What | Task |
| --- | --- | --- | --- |
| §1.1 | ERROR | `public.import_efficiency_metrics` view is `SECURITY DEFINER`, bypasses org-scoped RLS | Task 1 |
| §2.1 | WARN | `raw-imports` storage bucket is public with broad SELECT | Task 2 |
| §2.2 | WARN | 6 functions lack `SET search_path = public` | Task 3 |
| §2.3 | WARN | Supabase leaked-password protection disabled | Task 4 (Supabase dashboard) |
| §3.1 | WARN | `VITE_SENTRY_DSN` not set in Vercel prod → Sentry inert | Task 4 (Vercel dashboard) |
| Dependabot | 2 high, 1 moderate | Open vulnerability alerts on `main` | Task 5 |
| Closure | — | NEXT_SESSION_PLAN + audit index + progress log updates | Task 6 |

**Operating mandate** (free tier):
- No new Edge Function invocations.
- No new scheduled jobs.
- No new dependencies unless absolutely required (Dependabot may force one).
- Every migration ships a revert path.

**Wave is NOT**:
- pgTAP CI runner (Wave 7).
- CSP `style-src` nonce hardening (Wave 7).
- Comprehensive OWASP Top 10 audit doc (Wave 9).
- 2FA / TOTP (out of scope entirely).
- Third-party pen test (out of scope entirely).

---

## Pre-flight Verification

Verify each. **HALT** on any false claim.

1. `git status` on `main` is clean; `git log --oneline -5` shows the Wave 1b closure commit on top.
2. `docs/audits/wave-1a/index.md` exists and contains a `### Wave 2-security` sub-heading listing findings (may be 0–N entries; read them all before starting Task 1).
3. `docs/expansion/NEXT_SESSION_PLAN.md` exists and still lists items §1.1, §2.1, §2.2, §2.3, §3.1 (if any were closed in Wave 1b triage, their task below is a no-op — confirm and move on).
4. `supabase/migrations/` exists; the most recent migration filename matches `YYYYMMDDHHMMSS_*.sql` (14-digit concatenated datetime prefix — NOT `YYYY_MM_DD`).
5. `frontend/src/main.jsx` contains the `if (SENTRY_DSN) { Sentry.init({ ... }) }` gate; no code change needed for Task 4.
6. `frontend/src/lib/logger.js` exists (the Sentry-forwarding logger).
7. `vercel.json` exists with an enforcing `Content-Security-Policy` header (not Report-Only).
8. `package.json` version is `1.0.0`; `.github/workflows/ci.yml` runs the full test suite on PR.
9. Supabase project ref is documented in `docs/operations/ENVIRONMENT.md` or `production-cutover.md` (needed for Task 4 dashboard URLs — if absent, HALT and surface).
10. Baseline counts: record fresh `npm run lint` warnings, `npm run test` count, `npm run frontend:build` bundle sizes in the Wave 2 kickoff PR description (becomes the delta reference for Wave Review).

If any of the 6 functions in §2.2 have been renamed since the NEXT_SESSION_PLAN was written, **HALT** and reconcile: the migration in Task 3 must `ALTER FUNCTION` the actual current names.

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-2-view-security-invoker` → Task 1
  - `claude/wave-2-raw-imports-policy` → Task 2
  - `claude/wave-2-search-path-functions` → Task 3
  - `claude/wave-2-external-config` → Task 4
  - `claude/wave-2-dependabot` → Task 5
  - `claude/wave-2-closure` → Task 6 (lands LAST — depends on 1–5)
- Tasks 1–5 are independent; they can merge in any order.
- Task 6 lands after all five so it reflects actual ship state.
- **PR per task. No direct pushes to `main`.** CI must be green before merge.
- Branch-to-main rebase allowed; no force-pushes to `main`.

---

## Wave Scope

Five fix-tasks (DB migration × 3, external config × 1, dependency triage × 1) plus one closure task. Every fix-task produces a verifiable artifact: a migration with revert SQL, a dashboard-action checklist, or a lockfile diff. Every fix-task updates its corresponding audit-index entry to `✅ shipped`.

---

## Task 1 — §1.1 `import_efficiency_metrics` SECURITY INVOKER

**Commit**: `fix(security): switch import_efficiency_metrics view to SECURITY INVOKER`

**Branch**: `claude/wave-2-view-security-invoker`

**Risk**: medium — changes how an analytics view enforces access.

### Steps

1. Checkout `claude/wave-2-view-security-invoker` from latest `main`.

2. **Find the view DDL** — `grep -rn "import_efficiency_metrics" supabase/migrations/`. Read the CREATE statement; note the column list + FROM clause. Confirm it's defined with `SECURITY DEFINER` (or implicit — default view owner is the migration runner, so it runs with postgres role and bypasses RLS).

3. **Find callers**:
   - `grep -rn "import_efficiency_metrics" frontend/ packages/ supabase/functions/` — where is it read from?
   - Is it displayed on the admin dashboard? If so, note the component path.
   - If zero frontend callers, the view is DB-only (e.g., BetterStack / Grafana queries) and the fix is lower-risk.

4. **Write the migration** at `supabase/migrations/<YYYYMMDDHHMMSS>_fix_import_efficiency_metrics_invoker.sql`. Use the current UTC datetime. Template:

   ```sql
   -- Forward: switch import_efficiency_metrics view to SECURITY INVOKER
   -- so it evaluates underlying table RLS for the querying user.
   
   DROP VIEW IF EXISTS public.import_efficiency_metrics;
   
   CREATE VIEW public.import_efficiency_metrics
   WITH (security_invoker = on) AS
   SELECT -- copy the full column list from the prior CREATE verbatim
       ...
   FROM
       ...
   ;
   
   COMMENT ON VIEW public.import_efficiency_metrics IS
     'Aggregated import metrics. security_invoker=on ensures RLS on ' ||
     'underlying tables is honored for the querying user.';
   
   -- Grant SELECT to authenticated only (no anon).
   GRANT SELECT ON public.import_efficiency_metrics TO authenticated;
   REVOKE SELECT ON public.import_efficiency_metrics FROM anon, public;
   ```

5. **Write the revert script** at `docs/sql/reverts/<YYYYMMDDHHMMSS>_revert_import_efficiency_metrics_invoker.sql`. Mirrors the forward but with `security_invoker = off` (the default SECURITY DEFINER behavior). Commit this alongside the migration as a NEW file — do NOT push it through `supabase db push`; it's a break-glass script only.

6. **Write an RLS smoke test** at `docs/sql/tests/import_efficiency_metrics_rls.sql`:
   
   ```sql
   -- Run as admin user on staging/prod.
   -- Expected: results scoped to the caller's org(s).
   -- Failure: results include rows from other orgs OR the query errors.
   
   SET LOCAL ROLE authenticated;
   SET LOCAL request.jwt.claims = '{"sub": "<test-user-uuid>"}';
   SELECT COUNT(*) AS user_visible_count FROM public.import_efficiency_metrics;
   -- Compare with: SELECT COUNT(*) FROM raw underlying-table-with-RLS-applied;
   -- Expect the two counts to match.
   ```

7. **Apply + verify locally** against the Supabase CLI (`supabase db reset && supabase db push`) OR against a branch Supabase project if CLI unavailable. Do NOT push to prod in this PR — the merge + CI flow handles prod.

8. **If frontend callers exist**: run `npm run test` locally; add a test only if the hook/view-consumer behavior is newly wrapped (unlikely — the view's shape is unchanged). Most likely no test change.

9. Commit, push, open PR titled `fix(security): switch import_efficiency_metrics view to SECURITY INVOKER`. PR body includes:
   - The exact DDL diff.
   - Caller inventory (files that read from the view, or "none").
   - Post-merge verification steps (see `## Post-deploy verification` below).

### Tests to add (Task 1)

- `docs/sql/tests/import_efficiency_metrics_rls.sql` (manual-run SQL smoke; not wired into CI yet — Wave 7 handles pgTAP).
- No Vitest changes unless a frontend consumer's behavior genuinely changed.

### Post-deploy verification (Task 1)

After merge lands and Supabase migration applies to prod (operator step):
1. Run `docs/sql/tests/import_efficiency_metrics_rls.sql` in the Supabase SQL editor as a non-admin test user; expect org-scoped counts.
2. Refresh the Supabase advisor dashboard; expect §1.1 ERROR to clear.
3. If §1.1 does not clear, open a hotfix: run the revert script and re-plan.

### Out of scope (Task 1)

- Moving the view to a materialized view (performance is out of scope for this PR).
- Adding additional views (this PR only touches `import_efficiency_metrics`).
- Any change to the underlying tables' RLS policies.

---

## Task 2 — §2.1 `raw-imports` bucket policy

**Commit**: `fix(security): scope raw-imports bucket to org-owner reads`

**Branch**: `claude/wave-2-raw-imports-policy`

**Risk**: high — changes a storage bucket's access model. If any frontend path uses `getPublicUrl()` on this bucket, that path breaks.

### Steps

1. Checkout `claude/wave-2-raw-imports-policy` from latest `main`.

2. **Audit current usage**:
   - `grep -rn "raw-imports" frontend/ packages/ supabase/functions/` — list every code site.
   - For each site, record whether it uses `.getPublicUrl()`, `.download()`, `.upload()`, or `.createSignedUrl()`.
   - Record the bucket's current path structure (look at recent uploads in the Supabase dashboard OR inspect an `import-validation` Edge Function that writes to the bucket — what's the path prefix?).

3. **Decide the target path shape**. Required: `<organization_id>/<yyyy-mm-dd>/<filename>.csv` (org prefix is load-bearing for the RLS policy in Step 4). If the current path shape differs, the migration additionally needs to restructure uploads — if so, **HALT and re-file the upload-restructure work as a Wave 4 (onboarding) prereq**; keep Task 2 scoped to the RLS+access change.

4. **Write the migration** at `supabase/migrations/<YYYYMMDDHHMMSS>_scope_raw_imports_bucket.sql`:
   
   ```sql
   -- Forward: flip raw-imports to private + org-scoped RLS.
   
   UPDATE storage.buckets SET public = false WHERE id = 'raw-imports';
   
   -- Drop any existing over-permissive policies on this bucket.
   DROP POLICY IF EXISTS "Public read on raw-imports" ON storage.objects;
   DROP POLICY IF EXISTS "Authenticated read raw-imports" ON storage.objects;
   
   -- Users can read only files inside their org's path prefix.
   CREATE POLICY "raw-imports: org members can read"
   ON storage.objects FOR SELECT
   TO authenticated
   USING (
     bucket_id = 'raw-imports'
     AND (storage.foldername(name))[1] IN (
       SELECT organization_id::text
       FROM public.organization_members
       WHERE user_id = auth.uid()
     )
   );
   
   -- Users can write only into their org's path prefix.
   CREATE POLICY "raw-imports: org members can upload"
   ON storage.objects FOR INSERT
   TO authenticated
   WITH CHECK (
     bucket_id = 'raw-imports'
     AND (storage.foldername(name))[1] IN (
       SELECT organization_id::text
       FROM public.organization_members
       WHERE user_id = auth.uid()
     )
   );
   
   -- Service role keeps full access for Edge Functions (implicit via bypass).
   ```

5. **Write the revert** at `docs/sql/reverts/<YYYYMMDDHHMMSS>_revert_raw_imports_scope.sql` that restores the prior public-bucket state. Commit alongside the forward migration.

6. **Update frontend callers**:
   - Any `.getPublicUrl('raw-imports/...')` calls → replace with `.createSignedUrl('raw-imports/<path>', 3600)` (1-hour TTL).
   - Each caller's return type changes from `{ data: { publicUrl } }` to `{ data: { signedUrl }, error }`. Adjust callers accordingly.
   - If an Edge Function reads the bucket, it already uses the service role — no change needed.

7. **Add a unit test** at `tests/rawImportsBucket.test.js` (if not already present) for any changed frontend helper:
   - Mocks the storage client's `createSignedUrl` method.
   - Asserts the helper passes an org-scoped path.
   - Asserts signed-URL TTL is bounded (≤ 1 hour).

8. Run `npm run test`, `npm run lint`, `npm run typecheck`, `npm run frontend:build`. All green.

9. **Add an E2E scenario** ONLY if the change alters a user-visible flow AND existing E2E doesn't cover it. If adding: `tests/e2e/features/raw_imports_access.feature` — scenario covers "coach cannot read another org's CSV via public URL" (negative test). If not adding, note in PR that Wave 5 will cover it as part of the 23-failure stabilization.

10. Commit, push, open PR titled `fix(security): scope raw-imports bucket to org-owner reads`. PR body includes:
    - Caller audit table (code site | current access method | new access method).
    - Migration DDL + revert.
    - Explicit note on breaking changes to any path-structure assumption.

### Tests to add (Task 2)

- Unit test for any frontend helper that now uses signed URLs.
- SQL smoke at `docs/sql/tests/raw_imports_cross_org.sql` — asserts a test user cannot list or read objects from another org's path prefix.

### Post-deploy verification (Task 2)

After merge and migration applies to prod:
1. Sign in as coach in Org A; attempt to fetch a CSV path belonging to Org B via the old public-URL shape (copy a known path, URL-guess). Expect 403.
2. Normal import flow in Org A still works (upload + list + download a same-org file).
3. Supabase advisor dashboard: §2.1 WARN clears.

### Out of scope (Task 2)

- Restructuring existing uploads in prod (if shapes drift; it's a Wave 4 prereq flagged in Step 3).
- Retention / cleanup cron for `raw-imports` (Wave 6).
- Encryption-at-rest config (Supabase default is AES-256; nothing to change).
- Introducing a new bucket.

---

## Task 3 — §2.2 `SET search_path` on 6 functions

**Commit**: `fix(security): set search_path=public on definer functions`

**Branch**: `claude/wave-2-search-path-functions`

**Risk**: low — adds a safety boundary without changing function behavior.

### Steps

1. Checkout `claude/wave-2-search-path-functions` from latest `main`.

2. **Confirm the 6 function names** — search `supabase/migrations/**/*.sql` for each of:
   - `get_reserved_keys`
   - `log_schema_change`
   - `validate_custom_attributes`
   - `check_password_length_on_auth_users`
   - `persist_evaluation_run` (note: there's an overload — migration `20260407000000_persist_evaluation_run_overload.sql`; both signatures may need the ALTER)
   - `prune_old_evaluation_runs`

   For each, record the exact argument-type list (needed for `ALTER FUNCTION` signature). If a function was renamed or dropped in a later migration, adjust the task plan.

3. **Write the migration** at `supabase/migrations/<YYYYMMDDHHMMSS>_lock_search_path_on_definer_functions.sql`:
   
   ```sql
   -- Forward: set search_path=public on SECURITY DEFINER functions
   -- to prevent search-path injection attacks.
   
   ALTER FUNCTION public.get_reserved_keys() SET search_path = public, pg_temp;
   ALTER FUNCTION public.log_schema_change() SET search_path = public, pg_temp;
   ALTER FUNCTION public.validate_custom_attributes(<args>) SET search_path = public, pg_temp;
   ALTER FUNCTION public.check_password_length_on_auth_users() SET search_path = public, pg_temp;
   ALTER FUNCTION public.persist_evaluation_run(<args_v1>) SET search_path = public, pg_temp;
   ALTER FUNCTION public.persist_evaluation_run(<args_v2>) SET search_path = public, pg_temp;
   ALTER FUNCTION public.prune_old_evaluation_runs() SET search_path = public, pg_temp;
   
   -- pg_temp included so temp-table functions still resolve (a pg_temp
   -- omission would break any function that creates temp relations).
   ```

4. **Write the revert** at `docs/sql/reverts/<YYYYMMDDHHMMSS>_unlock_search_path.sql` that resets each function's `search_path` to default (`ALTER FUNCTION ... RESET search_path`).

5. **Regression check**: run existing Vitest suite. If any persistence or trigger-adjacent test fails, the `search_path` lock likely broke a function that depends on a non-`public` schema being in scope. HALT and debug.

6. Commit, push, open PR with DDL + revert + per-function sanity log (confirming each function's signature was found via `\df`).

### Tests to add (Task 3)

- None in Vitest (search_path is a DB property, not observable from the client mock).
- SQL smoke at `docs/sql/tests/search_path_lock.sql`: for each of the 6 functions, `SELECT proname, proconfig FROM pg_proc WHERE proname IN (...)` should return rows with `search_path=public,pg_temp` in `proconfig`.

### Post-deploy verification (Task 3)

1. Run the SQL smoke in Supabase SQL editor — expect 6 (or 7, counting the overload) rows.
2. Supabase advisor dashboard: §2.2 WARNs clear for each function.
3. Run `npm run test:e2e` on merge; no regression in import, evaluation-run persistence, or password-policy flows.

### Out of scope (Task 3)

- Converting any of these functions from `SECURITY DEFINER` to `SECURITY INVOKER` (beyond the scope of the advisor item).
- Refactoring the function bodies.
- Adding new `search_path`-locked functions (if the codebase has OTHER `SECURITY DEFINER` functions not listed here, file new findings for Wave 7).

---

## Task 4 — §2.3 Leaked-Password Protection + §3.1 `VITE_SENTRY_DSN`

**Commit**: `docs(security): document external dashboard steps for §2.3 + §3.1`

**Branch**: `claude/wave-2-external-config`

**Risk**: low — no code change; documentation + operator actions.

### Steps

1. Checkout `claude/wave-2-external-config` from latest `main`.

2. **§2.3 — Supabase dashboard**:
   - Operator action: Supabase Dashboard → Authentication → Policies → enable "Prevent use of leaked passwords" (or the current equivalent setting name).
   - No code change.

3. **§3.1 — Vercel dashboard**:
   - Operator action: Vercel project → Settings → Environment Variables → add `VITE_SENTRY_DSN=<prod-dsn-value>` (Production scope only; do NOT enable Preview or Development — free-tier Sentry budget is 10k errors/mo).
   - Verify `frontend/src/main.jsx` already reads `VITE_SENTRY_DSN` with the `if (SENTRY_DSN) { Sentry.init(...) }` gate — it does. No code change.

4. **Document both steps** — update `docs/operations/production-cutover.md` and `docs/operations/ENVIRONMENT.md`:
   - New section in `production-cutover.md`: `## Post-deploy security toggles` listing these two dashboard actions + the verification steps below + the Sentry free-tier budget reminder.
   - `ENVIRONMENT.md`: confirm `VITE_SENTRY_DSN` is listed with a note "set in Vercel Production only; leave empty for Preview + Development to stay inside the 10k-errors/mo free tier".

5. **Write a Sentry smoke test** script at `docs/operations/sentry-smoke.md` with step-by-step operator instructions:
   1. In the browser on prod (`https://<prod-url>`), open DevTools console.
   2. Run `throw new Error('wave-2 sentry smoke ' + Date.now())`.
   3. Within 60 s, the error appears in the Sentry project dashboard with `environment: production` and the runtime datetime.
   4. Tag the event as "ops smoke — can be archived".

6. **Dispense with a code-level test** — the init is DSN-gated and the gate is already in place; adding a unit test that asserts `Sentry.init` is called when DSN is set would require mocking `import.meta.env`, which isn't worth the complexity for a one-line gate.

7. Commit, push, open PR. PR body includes:
   - Checklist the operator ticks off post-merge (Supabase toggle, Vercel env var, smoke test).
   - Links to the new doc sections.

### Tests to add (Task 4)

- None. Docs + operator actions only.

### Post-deploy verification (Task 4)

- Supabase Auth policy "Prevent use of leaked passwords" shows as enabled in the dashboard.
- Vercel prod environment shows `VITE_SENTRY_DSN` as set.
- Sentry dashboard shows the smoke event within 60 s of the triggering `throw`.
- Advisor dashboard: §2.3 WARN clears (Supabase auto-detects the toggle).

### Out of scope (Task 4)

- Setting `VITE_SENTRY_DSN` in Preview or Development scope (would burn free-tier budget; skip).
- Enabling `replaysSessionSampleRate > 0` (already 0 per `main.jsx`; free-tier preservation).
- Adding user identity to Sentry events beyond what `logger.setUser` already provides (Wave 9).
- Adding Sentry release tagging (Wave 9 — ties to `v1.0.1` tag).

---

## Task 5 — Dependabot triage

**Commit**: varies per alert (`fix(deps): bump <pkg> <old>→<new> for <CVE>`)

**Branch**: `claude/wave-2-dependabot`

**Risk**: medium — dependency bumps can surface transitive breakages.

### Steps

1. Checkout `claude/wave-2-dependabot` from latest `main`.

2. **Enumerate alerts** — `gh api /repos/JoelA510/SquadLogic/dependabot/alerts --paginate` OR browse https://github.com/JoelA510/SquadLogic/security/dependabot. Record:
   - CVE ID
   - Affected package + version range
   - Severity (high / moderate)
   - Patch availability (fixed version)
   - Direct vs transitive dependency

3. **For each alert**, choose a path:
   - **Direct dep with patch available**: `npm install <pkg>@<fixed-version> --save` then run the full test suite.
   - **Transitive dep with patch**: add to `overrides` in `package.json` (see existing `"overrides": { "esbuild": "^0.25.0" }` pattern). Then `npm install` to refresh the lockfile.
   - **No patch yet**: document the alert in `docs/security/dependabot-waivers.md` (create if missing) with CVE + exposure analysis + monitoring plan. Do NOT ignore silently.

4. **Per-alert verification**:
   ```bash
   npm install
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   ```
   All green. If any fail, the bump introduced a regression — HALT, investigate, potentially pin lower OR re-file the alert as a waiver.

5. **Free-tier check**: if a bump grows `dist/` bundle size > 5 %, flag in the PR body. Bundle discipline is Wave 6's job, but don't land a silent regression.

6. **Commit as one commit per resolved alert** (or one commit if a single `npm install` resolves multiple). Use one of:
   - `fix(deps): bump <pkg> to <version> (resolves <CVE-id>)`
   - `fix(deps): override <pkg> transitive to <version> (resolves <CVE-id>)`
   - `docs(security): waive <CVE-id> — <pkg> has no patch yet`

7. Open a single PR titled `fix(deps): resolve dependabot alerts (wave-2)`. PR body lists every alert and its disposition.

### Tests to add (Task 5)

- None, unless a bump requires a behavioral test to prove no regression (rare; lint + typecheck + test are usually sufficient).

### Post-deploy verification (Task 5)

- After merge, the Dependabot alerts page shows the resolved alerts as closed.
- CI on `main` stays green.
- Any waived alerts are tracked in `docs/security/dependabot-waivers.md`.

### Out of scope (Task 5)

- Running `npm audit fix` blindly (can introduce breaking changes; handle alerts individually).
- Major-version bumps unless they're the only patch path (and then flag explicitly).
- Dependency rotation beyond the flagged alerts.
- Auto-merge of future Dependabot PRs (out of scope; may be enabled in Wave 9).

---

## Task 6 — Closure

**Commit**: `docs(audit): wave-2 closure — security advisor cleanup shipped`

**Branch**: `claude/wave-2-closure`

**Depends on**: Tasks 1–5 merged to `main`.

### Steps

1. Checkout `claude/wave-2-closure` from latest `main` AFTER Tasks 1–5 merge. Confirm `git log --oneline -10` shows five `fix(...):` or `docs(...):` commits from Wave 2.

2. **Update `docs/expansion/NEXT_SESSION_PLAN.md`**:
   - For each item §1.1, §2.1, §2.2, §2.3, §3.1: annotate with `**✅ Resolved 2026-MM-DD in Wave 2 Task N — see PR #<n>**` next to the item heading.
   - If ALL listed items are now resolved, add a top-of-file notice: `> **Status: All items in this plan are resolved. Archive candidate; see `docs/archive/expansion/` for the canonical home.**`
   - Do NOT move the file to the archive in this task — archival is a Wave 8 (docs) decision. Annotation only.

3. **Update `docs/audits/wave-1a/index.md`**:
   - For each Wave-2-security finding: prepend `✅` to the title cell and update `Proposed wave` to `2 (shipped)`.
   - Append a `## Wave 2 closure` section summarizing: what shipped per NEXT_SESSION_PLAN item, Dependabot disposition, advisor dashboard state before/after.

4. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 2 security advisor cleanup
   
   Five fix PRs + one closure PR shipped.
   
   - §1.1 (ERROR): import_efficiency_metrics → SECURITY INVOKER
   - §2.1 (WARN): raw-imports bucket → private, org-scoped RLS
   - §2.2 (WARN): search_path=public,pg_temp on 6 definer functions
   - §2.3 (WARN): leaked-password protection enabled (Supabase dashboard)
   - §3.1 (WARN): VITE_SENTRY_DSN set in Vercel Production; smoke-tested
   - Dependabot: N alerts resolved, M waived (see docs/security/dependabot-waivers.md if any)
   - Supabase advisor dashboard: 0 ERROR, 0 high-severity WARN remaining.
   ```

5. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   git status                   # only the listed doc files changed
   npm run format -- docs/expansion/NEXT_SESSION_PLAN.md docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
   ```
   Each `FAIL → HALT`.

6. Commit, push, open PR.

### Tests to add (Task 6)

- None.

### Out of scope (Task 6)

- Archiving `NEXT_SESSION_PLAN.md` (Wave 8).
- Adding new findings to `docs/audits/wave-1a/*.md` sub-reports (they are frozen artifacts).
- Editing any `.claude/wave-*-prompt.md` file.

---

## Documentation Currency Pass

Handled by Task 6 (annotations) plus per-task doc edits:
1. `docs/operations/production-cutover.md` — new `## Post-deploy security toggles` section (Task 4).
2. `docs/operations/ENVIRONMENT.md` — DSN scope note (Task 4).
3. `docs/operations/sentry-smoke.md` — new (Task 4).
4. `docs/security/dependabot-waivers.md` — new if any alert requires waiver (Task 5).
5. `docs/sql/reverts/*` — three new revert scripts (Tasks 1, 2, 3).
6. `docs/sql/tests/*` — three new smoke scripts (Tasks 1, 2, 3).
7. `docs/expansion/NEXT_SESSION_PLAN.md` — resolution annotations (Task 6).
8. `docs/audits/wave-1a/index.md` — Wave-2-security findings marked shipped (Task 6).
9. `docs/expansion/98_PROGRESS_LOG.md` — dated wave-close entry (Task 6).

**Do NOT** touch `claude.md`, `docs/architecture/*.md`, `docs/expansion/03_ROADMAP.md`, or any `.claude/wave-*.md` file in this wave.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 6 tasks merged with CI green.
2. `npm run lint` on `main`: warning count ≤ pre-wave baseline (Dependabot bumps may add or remove warnings — document in the PR).
3. `npm run typecheck` on `main`: 0 errors.
4. `npm run test` on `main`: 100 % pass; count ≥ pre-wave baseline (Task 2 adds 1 + test; Tasks 1, 3, 4, 5, 6 add 0).
5. `npm run frontend:build` on `main`: clean; bundle-size delta documented if any Dependabot bump affected it.
6. `npm run test:e2e -- --workers=1` on `main` (post-merge CI): passing-count unchanged from baseline (40/63). Any new failure = HALT + hotfix or revert.
7. Supabase **advisor dashboard** snapshotted before and after the wave: 0 ERROR findings, 0 high-severity WARN findings post-wave.
8. Supabase Auth dashboard: "Prevent use of leaked passwords" is ENABLED.
9. Vercel prod environment variables: `VITE_SENTRY_DSN` is SET.
10. Sentry project: at least one event from the post-deploy smoke test appears with `environment: production`.
11. GitHub Dependabot alerts page: all 3 alerts are either resolved or documented in `docs/security/dependabot-waivers.md`.
12. `docs/sql/reverts/` contains exactly 3 new scripts — one per migration.
13. `docs/sql/tests/` contains exactly 3 new smoke scripts — one per migration.
14. `docs/expansion/NEXT_SESSION_PLAN.md` has `✅ Resolved` annotations on §1.1, §2.1, §2.2, §2.3, §3.1.
15. `docs/audits/wave-1a/index.md` has `## Wave 2 closure` populated and no finding retains `Proposed wave: 2-security` without a shipped marker.
16. **Test-impact reconciled**: Task 2's added test file accounts for the only test-count increment; no other task silently added tests.

---

## Commit & Push to Main

1. Tasks 1–5 PRs can merge in any order.
2. Task 6 lands LAST.
3. After each merge, operator applies migrations to prod:
   - Task 1: `supabase db push --db-url $PROD_DB_URL` (or the project's documented push flow).
   - Task 2: same, plus monitor for 403s on CSV download for 24 h post-cutover.
   - Task 3: same, then run `docs/sql/tests/search_path_lock.sql` in SQL editor.
   - Task 4: Supabase dashboard toggle + Vercel env var (NO db push).
   - Task 5: No db push; `npm install` locks the new versions.
4. After all 6 merge + prod migrations apply:
   ```bash
   git checkout main && git pull
   npm install
   npm run lint && npm run typecheck && npm run test && npm run frontend:build
   ```
   All green. CI runs E2E; wait for green.
5. If CI regresses on `main`, open a `revert:` PR immediately — do not leave `main` red.

---

## Verification Gate (Per Task, Before Push)

For Tasks 1, 2, 3 (migration tasks):
```bash
npm run lint
npm run typecheck
npm run test
npm run frontend:build
git status                     # only expected files changed
```
Plus: confirm the forward migration applies cleanly against `supabase db reset` (local) OR a Supabase branch project.

For Task 4 (external config):
```bash
npm run lint && npm run typecheck && npm run test && npm run frontend:build
```
Docs-only PR; dashboard actions happen post-merge.

For Task 5 (Dependabot):
```bash
npm install                    # refreshes lockfile
npm run lint
npm run typecheck
npm run test
npm run frontend:build
```
Plus: verify no new Vitest failures; bundle-size delta documented.

For Task 6 (closure):
```bash
npm run lint && npm run typecheck && npm run test && npm run frontend:build
npm run format -- docs/expansion/NEXT_SESSION_PLAN.md docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
git status
```

Do NOT run `npm run test:e2e` locally per-task (cost). CI runs it on merge.

---

## Key References

- `claude.md` — §2 scope guardrails, §7 Supabase/Mock client, §10 environment variables, §11 CI pipeline.
- `docs/expansion/NEXT_SESSION_PLAN.md` — the authoritative backlog this wave closes.
- `docs/audits/wave-1a/index.md` — Wave-2-security findings section (read before Task 1).
- `docs/audits/wave-1a/security.md` — full-context detail per finding.
- `docs/security/rls-policies.md` — existing RLS documentation; update if Task 2's bucket policy requires doc sync.
- `docs/operations/production-cutover.md` — runbook for post-merge prod steps.
- `docs/operations/ENVIRONMENT.md` — env var registry.
- `frontend/src/main.jsx` — Sentry init gate (no code change in this wave).
- `frontend/src/lib/logger.js` — Sentry forwarder (no code change in this wave).

---

## Critical Files

**Will create**:
- `supabase/migrations/<YYYYMMDDHHMMSS>_fix_import_efficiency_metrics_invoker.sql` (Task 1)
- `supabase/migrations/<YYYYMMDDHHMMSS>_scope_raw_imports_bucket.sql` (Task 2)
- `supabase/migrations/<YYYYMMDDHHMMSS>_lock_search_path_on_definer_functions.sql` (Task 3)
- `docs/sql/reverts/*_revert_import_efficiency_metrics_invoker.sql` (Task 1)
- `docs/sql/reverts/*_revert_raw_imports_scope.sql` (Task 2)
- `docs/sql/reverts/*_unlock_search_path.sql` (Task 3)
- `docs/sql/tests/import_efficiency_metrics_rls.sql` (Task 1)
- `docs/sql/tests/raw_imports_cross_org.sql` (Task 2)
- `docs/sql/tests/search_path_lock.sql` (Task 3)
- `docs/operations/sentry-smoke.md` (Task 4)
- `docs/security/dependabot-waivers.md` — only if Task 5 requires waivers

**Will edit**:
- `frontend/src/**/*.jsx` — any storage caller that now uses signed URLs (Task 2; ≤5 files)
- `tests/rawImportsBucket.test.js` — new file or extend existing (Task 2)
- `package.json`, `package-lock.json` (Task 5)
- `docs/operations/production-cutover.md` (Task 4)
- `docs/operations/ENVIRONMENT.md` (Task 4)
- `docs/expansion/NEXT_SESSION_PLAN.md` (Task 6)
- `docs/audits/wave-1a/index.md` (Task 6)
- `docs/expansion/98_PROGRESS_LOG.md` (Task 6)

**Will NOT edit**:
- `claude.md`
- `docs/architecture/**`
- `docs/expansion/03_ROADMAP.md`
- Any `.claude/wave-*.md` file
- Any `supabase/functions/**` (no new invocations)
- `vercel.json` (directives)
- `vitest.config.js`, `playwright.config.ts`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`
- The `docs/audits/wave-1a/*.md` sub-reports (frozen)

---

## Out of Scope This Wave

- pgTAP CI wiring (Wave 7).
- CSP `style-src` nonce migration (Wave 7).
- OWASP Top 10 full audit (Wave 9).
- 2FA / TOTP.
- Third-party pen test.
- Additional `SECURITY DEFINER` → `SECURITY INVOKER` conversions beyond `import_efficiency_metrics`.
- Bucket-path restructure for `raw-imports` if current shape drifts from `<org_id>/...`.
- Retention cron for `raw-imports` (Wave 6).
- `raw-imports` frontend upload-path consolidation (Wave 4 or Wave 6).
- E2E scenario expansion beyond at most one negative-access test in Task 2.
- Sentry release tagging / source-map upload (Wave 9).
- Log-call audit (re-filed from Wave 1b; handled in Wave 3 or Wave 9).
- `claude.md` → `CLAUDE.md` rename (Wave 8).

---

## Ground Rules

- **Migration = revert pair**. Every forward migration ships with its revert script in `docs/sql/reverts/`. If a forward migration has no sensible revert, the plan needs rework before it lands.
- **No destructive DDL**. No `DROP TABLE`, no `DROP COLUMN`, no `DROP FUNCTION` (except Task 1's view drop-and-recreate, which is non-destructive because the recreate preserves the contract).
- **One-commit-per-migration within a task**. If Task 1 or Task 2 needs multiple commits (e.g., migration + frontend update), split logically; final PR can still roll up to a single review unit.
- **Tests run locally before push** for every task except Task 4.
- **E2E is CI-only**. Don't run it locally except to reproduce a post-merge failure.
- **Dashboard actions happen post-merge**, not during PR work. The PR documents the action; the operator performs it after CI goes green.
- **Free-tier awareness**: no new Edge Function, no new scheduled job, no new realtime channel in this wave. If an implementation needs one, re-file to Wave 6.
- **No `--no-verify`, no `--force-push`, no `git push main` direct**.
- **CI green is the merge gate**. Every PR waits for CI.
- **5-attempt debugging cap** per task. If stuck, surface findings and STOP.
- **Prod-cutover honesty**: if a migration applies to staging but is blocked in prod (e.g., existing data violates a new constraint), do NOT force-push. Open a hotfix PR and surface.
