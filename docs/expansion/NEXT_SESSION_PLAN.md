[← Back to Documentation Index](../README.md)

---

# Security Advisor Cleanup + Deferred Items Status

**Originally written:** 2026-04-17, after the §1–§4 production push landed ([#156](https://github.com/JoelA510/SquadLogic/pull/156), [#157](https://github.com/JoelA510/SquadLogic/pull/157), [#158](https://github.com/JoelA510/SquadLogic/pull/158)) and the prod Supabase state was reconciled with the repo (three 2026-04-16 migrations applied, `rotate_calendar_token` re-created, `auto-scheduler` + `fairness-scoring` deployed). The previous plan is archived at [`docs/archive/expansion/next-session-plan-2026-04-16.md`](../archive/expansion/next-session-plan-2026-04-16.md).

**Status refreshed:** 2026-05-02. This page is now a historical cleanup plan plus a current follow-up list. Repo-owned security-advisor fixes, the full E2E CI path, and the pgTAP harness have since shipped. Operator-owned production settings and v1.1 feature work remain separate release-readiness gates.

## Context

On 2026-04-17, `mcp get_advisors --type=security` flagged one ERROR + four distinct WARN categories against the production database, plus one deferred platform item. Repo-owned fixes for the view, storage bucket, function `search_path`, CSP, and supporting docs have since landed. Production dashboard state still requires operator confirmation for leaked-password protection, Sentry, and current advisor output.

---

## 1. Security Advisor — ERROR (repo fix shipped)

### 1.1 `public.import_efficiency_metrics` is a `SECURITY DEFINER` view

Historical finding: a `SECURITY DEFINER` view enforces the **creator's** RLS/permissions when queried, not the caller's. In a multi-tenant schema where RLS on the underlying tables is the primary org-isolation gate, this means any querying user bypasses the caller-scoped `is_org_member(...)` policies on those tables.

**Current status.** Shipped in Wave 2 and re-verified in the import-efficiency repair. The view retains `security_invoker = on`, and targeted pgTAP coverage for the caller-scoped behavior is present in `supabase/tests/rls_import_efficiency_metrics_view.sql`.

**Shipped fix.** Drop and recreate the view with `security_invoker = on` (Postgres 15+ supports this as a view option):

```sql
alter view public.import_efficiency_metrics set (security_invoker = on);
```

Or, if the view needs to aggregate across orgs for a legitimate admin-facing report:
- Keep `SECURITY DEFINER` but wrap the aggregation in a dedicated function that checks `is_global_admin(auth.uid())` before returning rows.
- Or recreate as a `MATERIALIZED VIEW` that's refreshed server-side by a service-role job and grant SELECT only to an admin role.

**Historical verification.**
1. `select reloptions from pg_class where relname = 'import_efficiency_metrics';` shows `{security_invoker=true}`.
2. `mcp get_advisors --type=security` no longer flags the view.
3. Exercise the import pipeline from two different orgs and confirm rows don't bleed across.

**Historical files touched.**
- Shipped migration `supabase/migrations/20260421000833_fix_import_efficiency_metrics_invoker.sql`.

**Remediation guide.** https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view

---

## 2. Security Advisor — WARN (repo fixes shipped; operator checks remain)

### 2.1 `public.raw-imports` storage bucket is public with broad SELECT

Historical finding: the bucket was marked public and had a broad `Public Access` SELECT policy on `storage.objects`. Combined, this let any client list every file in the bucket.

**Current status.** Path A shipped in migration `20260421001043_scope_raw_imports_bucket.sql`: `raw-imports` is private and read/write policies are scoped by organization path prefix. The scheduled raw-import retention workflow exists, but its Actions secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) remain operator-owned.

**Shipped fix (path A — private CSV bucket).** Flip the bucket to private and scope SELECT by org membership:

```sql
update storage.buckets set public = false where id = 'raw-imports';

drop policy if exists "Public Access" on storage.objects;

create policy "raw-imports read by org member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'raw-imports'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );
```

(This assumes uploads are keyed by `{organization_id}/{filename}`; adjust the folder parse if the path shape is different.)

**Rejected alternative (path B — legitimate public bucket).** Keep `public = true`, but remove the list policy so clients can only fetch known URLs:

```sql
drop policy if exists "Public Access" on storage.objects;

create policy "raw-imports read public urls"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'raw-imports');
```

(Historical note: this was subtly different from the old policy — the bucket would still have been listable via the admin API with the service-role key, but clients couldn't enumerate via a bare SELECT.)

**Historical verification.** `mcp get_advisors --type=security` drops the `public_bucket_allows_listing` entry.

**Remediation guide.** https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing

### 2.2 Six functions with mutable `search_path`

Historical functions flagged:
- `public.get_reserved_keys`
- `public.log_schema_change`
- `public.validate_custom_attributes`
- `public.check_password_length_on_auth_users`
- `public.persist_evaluation_run` (two overloads)
- `public.prune_old_evaluation_runs`

A function without an explicit `SET search_path` resolves names against the caller's `search_path`, which an attacker-controlled search path can hijack to point at a malicious schema.

**Current status.** Shipped in Wave 2 via `20260421001209_lock_search_path_on_definer_functions.sql`, with additional Wave 6a coverage for later definer functions through `npm run check:advisors`.

**Shipped fix.** One migration that uses `ALTER FUNCTION` to set `search_path = public`:

```sql
alter function public.get_reserved_keys() set search_path = public;
alter function public.log_schema_change() set search_path = public;
alter function public.validate_custom_attributes() set search_path = public;
alter function public.check_password_length_on_auth_users() set search_path = public;
-- persist_evaluation_run has two overloads; alter each by signature:
alter function public.persist_evaluation_run(jsonb, jsonb[], jsonb[]) set search_path = public;
alter function public.persist_evaluation_run(jsonb, jsonb, jsonb) set search_path = public;
alter function public.prune_old_evaluation_runs(integer) set search_path = public;
```

Grab the exact arg signatures from prod first:

```sql
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'get_reserved_keys', 'log_schema_change', 'validate_custom_attributes',
      'check_password_length_on_auth_users', 'persist_evaluation_run', 'prune_old_evaluation_runs'
    );
```

**Historical verification.** `mcp get_advisors --type=security` no longer lists any `function_search_path_mutable` warnings.

**Remediation guide.** https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

### 2.3 Leaked-password protection disabled

Supabase Auth can reject passwords that appear in HaveIBeenPwned. This remains an operator-owned dashboard setting unless production verification proves it is already enabled.

**Fix.** Dashboard-only toggle:
- Supabase Dashboard → Authentication → Password Security → enable "Leaked password protection".
- No migration, no code change.

**Verification.** Try signing up with `password` or `qwerty`; expect rejection. `mcp get_advisors` drops the `auth_leaked_password_protection` entry.

**Remediation guide.** https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

---

## 3. Deferred from the previous session

### 3.1 Sentry DSN

`frontend/src/main.jsx:14` gates `Sentry.init(...)` on `import.meta.env.VITE_SENTRY_DSN`. As of the 2026-04-17 production bundle check, the env var was **not set** in Vercel prod, so the bundle contained no `ingest.sentry.io` URL and no errors flowed to Sentry. The 2026-05-02 status is pending operator verification.

**Fix.**
1. Create (or locate) the Sentry project for SquadLogic — Frontend → React.
2. Copy the DSN (format: `https://<publicKey>@<host>.ingest.sentry.io/<projectId>`).
3. Set `VITE_SENTRY_DSN = <dsn>` in Vercel → squadlogic → Settings → Environment Variables → **Production** scope (and **Preview** if you want preview deploys to emit).
4. Trigger a production redeploy (push a trivial commit, or use Vercel's "Redeploy" button — the value is only baked into the bundle at build time, so a redeploy is mandatory).

**Verification.**
1. After redeploy, `curl https://squadlogic.vercel.app/assets/index-*.js | grep ingest.sentry.io` returns the DSN host.
2. In DevTools Console, type `throw new Error('synthetic sentry ping')` on any page and confirm the event lands in Sentry's Issues list within ~60s.
3. Confirm the [`@sentry/react`](https://www.npmjs.com/package/@sentry/react) `ErrorBoundary` catch-all still renders the Deep Space Glass fallback — Sentry init should not swap the boundary's UI.

### 3.2 Onboarding test coverage

**Current status.** The `/organizations/new` route, mock `initialize_new_tenant` RPC path, and onboarding cold-start E2E coverage shipped in PR #201. The pgTAP harness was restored in PR #211. Explicit pgTAP coverage for `initialize_new_tenant` can still be added as a focused DB test, but the old blockers are gone.

### 3.3 E2E stability gap (closed in CI)

Historical state: the §1 repair moved the suite from 0/63 (build broken) to 40/63. The remaining 23 failures were selector/text/session drift categories:

- **Readiness-score selector drift** — `[data-testid="readiness-score"]` not found on `dashboard_workflow.feature`. Likely the testid was renamed or removed during the UI polish pass and the feature file wasn't updated.
- **"Drafting Summary" text** — `async_and_optimistic_ui.feature` expects this string; the rendered page uses different copy.
- **"Upload to Storage" button** — `output_operationalization.feature` expects a button with this label on the output page.
- **"Import Complete!" toast** — `ingestion_hardening.feature` expects this toast text.
- **Calendar subscription modal** — `calendar_sync.feature` doesn't see the subscription modal open.
- **Twins RSVP edge case + real-time chat** — `team_communication.feature` two scenarios time out.
- **Practice schedule locking (Locked status)** — `practice_schedule_locking.feature` doesn't see the Locked status badge.
- **Roster conflict detection + Admin overrides** — all scenarios fail the initial "Team Roster page" nav; needs a closer look at `TeamAnalysisPage` post-fix.

**Current status.** PR #209 restored the hosted full E2E path with `npm run test:e2e -- --workers=1` and preserves Playwright HTML report, traces, screenshots, videos, and error-context artifacts. Future E2E failures should still use the per-test trace loop before changing feature files or assertions.

---

## 4. Other advisor-flagged follow-ups (not in get_advisors)

### 4.1 Nonce-based `style-src` tightening

The production CSP serves `style-src 'self' 'unsafe-inline'`. `'unsafe-inline'` was retained for Tailwind 4's inline `<style>` blocks, but long-term the tighter posture is a nonce. When the inline-style surface is smaller (e.g. after finishing the Deep Space Glass class migration), revisit this and flip to `style-src 'self' 'nonce-<nonce>'` with a per-response nonce injected by a Vercel edge function.

### 4.2 pgTAP / `supabase test db` in CI

**Current status.** PR #211 restored the DB harness and wires `supabase start` + `npm run test:db` through `.github/workflows/pgtap.yml` for DB-affecting pull requests. Full and single-file local commands are documented by the package scripts and the Supabase test fixtures.

---

## Verification checklist for this session

- [x] Migration for 1.1 applied; view retains caller-scoped `security_invoker` behavior.
- [x] Storage bucket fix (2.1) chosen and applied as private org-scoped `raw-imports`.
- [x] One migration for 2.2 alters all 6 flagged functions.
- [ ] Leaked-password protection toggled on in dashboard (2.3); advisor clears. Pending operator verification.
- [ ] `VITE_SENTRY_DSN` set in Vercel prod; synthetic error lands in Sentry.
- [ ] `mcp get_advisors --type=security` returns an empty `lints` list (or only non-blocking informational entries). Pending production re-check.

## Verification checklist for stretch items

- [x] pgTAP runner wired into CI for DB-affecting PRs; `npm run test:db` runs in the pgTAP workflow.
- [x] `OrganizationCreation` moved under a `/organizations/new` route; mock client handles `initialize_new_tenant`; at least one E2E scenario covers the cold-start.
- [x] Hosted full E2E path restored in CI after PR #209.
- [ ] CSP `style-src` hardened with a nonce; Deep Space Glass renders identically.
