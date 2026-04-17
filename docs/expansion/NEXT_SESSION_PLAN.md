[← Back to Documentation Index](../README.md)

---

# Next Dev Session: Security Advisor Cleanup + Deferred Items

**Session date TBD.** Written 2026-04-17, after the §1–§4 production push landed ([#156](https://github.com/JoelA510/SquadLogic/pull/156), [#157](https://github.com/JoelA510/SquadLogic/pull/157), [#158](https://github.com/JoelA510/SquadLogic/pull/158)) and the prod Supabase state was reconciled with the repo (three 2026-04-16 migrations applied, `rotate_calendar_token` re-created, `auto-scheduler` + `fairness-scoring` deployed). The previous plan is archived at [`docs/archive/expansion/next-session-plan-2026-04-16.md`](../archive/expansion/next-session-plan-2026-04-16.md).

## Context

`mcp get_advisors --type=security` now flags one ERROR + four distinct WARN categories against the production database, plus one deferred platform item. None block operation, but each is a concrete security or hardening gap with a bounded fix. The work below plus the three gap items from the prior session's follow-ups compose this session's scope.

---

## 1. Security Advisor — ERROR

### 1.1 `public.import_efficiency_metrics` is a `SECURITY DEFINER` view

A `SECURITY DEFINER` view enforces the **creator's** RLS/permissions when queried, not the caller's. In a multi-tenant schema where RLS on the underlying tables is the primary org-isolation gate, this means any querying user bypasses the caller-scoped `is_org_member(...)` policies on those tables.

**Fix.** Drop and recreate the view with `security_invoker = on` (Postgres 15+ supports this as a view option):

```sql
alter view public.import_efficiency_metrics set (security_invoker = on);
```

Or, if the view needs to aggregate across orgs for a legitimate admin-facing report:
- Keep `SECURITY DEFINER` but wrap the aggregation in a dedicated function that checks `is_global_admin(auth.uid())` before returning rows.
- Or recreate as a `MATERIALIZED VIEW` that's refreshed server-side by a service-role job and grant SELECT only to an admin role.

**Verification.**
1. `select reloptions from pg_class where relname = 'import_efficiency_metrics';` shows `{security_invoker=true}`.
2. `mcp get_advisors --type=security` no longer flags the view.
3. Exercise the import pipeline from two different orgs and confirm rows don't bleed across.

**Files to touch.**
- New migration `supabase/migrations/202604XXXXXXXX_security_invoker_for_efficiency_view.sql`.

**Remediation guide.** https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view

---

## 2. Security Advisor — WARN

### 2.1 `public.raw-imports` storage bucket is public with broad SELECT

Bucket is marked public AND has a `Public Access` SELECT policy on `storage.objects`. Combined, this lets any client list every file in the bucket — not just access a known-URL object. If the ingestion pipeline stores raw CSVs (with PII) in `raw-imports`, that's a data exposure path.

**Decision needed first.** Is `raw-imports` genuinely meant to serve public object URLs (e.g. logos, static assets), or is it storing user-uploaded CSVs? Confirm via Supabase dashboard → Storage → raw-imports before writing the fix.

**Fix (path A — private CSV bucket).** Flip the bucket to private and scope SELECT by org membership:

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

**Fix (path B — legitimate public bucket).** Keep `public = true`, but remove the list policy so clients can only fetch known URLs:

```sql
drop policy if exists "Public Access" on storage.objects;

create policy "raw-imports read public urls"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'raw-imports');
```

(Note: this is subtly different from the current policy — the bucket is still listable via the admin API with the service-role key, but clients can't enumerate via a bare SELECT.)

**Verification.** `mcp get_advisors --type=security` drops the `public_bucket_allows_listing` entry.

**Remediation guide.** https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing

### 2.2 Six functions with mutable `search_path`

Flagged:
- `public.get_reserved_keys`
- `public.log_schema_change`
- `public.validate_custom_attributes`
- `public.check_password_length_on_auth_users`
- `public.persist_evaluation_run` (two overloads)
- `public.prune_old_evaluation_runs`

A function without an explicit `SET search_path` resolves names against the caller's `search_path`, which an attacker-controlled search path can hijack to point at a malicious schema. The repo's newer functions (`initialize_new_tenant`, `rotate_calendar_token`, `record_audit_event`, `is_org_member`) already pin this; these six haven't been touched.

**Fix.** One migration that uses `ALTER FUNCTION` to set `search_path = public`:

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

**Verification.** `mcp get_advisors --type=security` no longer lists any `function_search_path_mutable` warnings.

**Remediation guide.** https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

### 2.3 Leaked-password protection disabled

Supabase Auth can reject passwords that appear in HaveIBeenPwned. Currently off.

**Fix.** Dashboard-only toggle:
- Supabase Dashboard → Authentication → Password Security → enable "Leaked password protection".
- No migration, no code change.

**Verification.** Try signing up with `password` or `qwerty`; expect rejection. `mcp get_advisors` drops the `auth_leaked_password_protection` entry.

**Remediation guide.** https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

---

## 3. Deferred from the previous session

### 3.1 Sentry DSN

`frontend/src/main.jsx:14` gates `Sentry.init(...)` on `import.meta.env.VITE_SENTRY_DSN`. The env var is currently **not set** in Vercel prod, so the production bundle (fetched 2026-04-17) contains no `ingest.sentry.io` URL and no errors flow to Sentry.

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

Unchanged from the 2026-04-16 plan:
- `initialize_new_tenant` needs pgTAP tests. **Blocker:** no pgTAP runner is configured in CI. PR #155's `supabase/setup-cli@v1 → supabase start → npm run test:db` scaffold is a reasonable starting point — it was closed unmerged but the branch (`feature/onboarding-testing-suite`) is preserved on origin.
- `OrganizationCreation` lacks E2E coverage. **Blocker:** the mock Supabase client doesn't implement the `initialize_new_tenant` RPC, and the page is rendered inline by [`App.jsx:65`](../../frontend/src/App.jsx#L65) rather than under a `/organizations/new` route — Playwright can't navigate to it without refactoring the app's routing.

**Suggested approach.** Solve the routing first: extract `OrganizationCreation` to `/organizations/new` and gate the App.jsx inline render behind a `needsOnboarding` predicate that no longer short-circuits the router. Then wire the mock client's `rpc()` dispatcher to handle `initialize_new_tenant`. Then add the pgTAP harness + an E2E scenario.

### 3.3 E2E stability gap (23 of 63)

The §1 repair moved the suite from 0/63 (build broken) to 40/63. The remaining 23 failures are stability drift on selectors and text expectations, not regressions from any of the four 2026-04-16 PRs. From the run logged on #156, the categories are:

- **Readiness-score selector drift** — `[data-testid="readiness-score"]` not found on `dashboard_workflow.feature`. Likely the testid was renamed or removed during the UI polish pass and the feature file wasn't updated.
- **"Drafting Summary" text** — `async_and_optimistic_ui.feature` expects this string; the rendered page uses different copy.
- **"Upload to Storage" button** — `output_operationalization.feature` expects a button with this label on the output page.
- **"Import Complete!" toast** — `ingestion_hardening.feature` expects this toast text.
- **Calendar subscription modal** — `calendar_sync.feature` doesn't see the subscription modal open.
- **Twins RSVP edge case + real-time chat** — `team_communication.feature` two scenarios time out.
- **Practice schedule locking (Locked status)** — `practice_schedule_locking.feature` doesn't see the Locked status badge.
- **Roster conflict detection + Admin overrides** — all scenarios fail the initial "Team Roster page" nav; needs a closer look at `TeamAnalysisPage` post-fix.

**Suggested approach.** Per-test loop: open the Playwright trace (`test-results/*-chromium/trace.zip`) via `npx playwright show-trace`, confirm what the page is actually rendering at the failing assertion, decide whether the feature file or the component is the source of truth, patch the smaller surface.

---

## 4. Other advisor-flagged follow-ups (not in get_advisors)

### 4.1 Nonce-based `style-src` tightening

The production CSP serves `style-src 'self' 'unsafe-inline'`. `'unsafe-inline'` was retained for Tailwind 4's inline `<style>` blocks, but long-term the tighter posture is a nonce. When the inline-style surface is smaller (e.g. after finishing the Deep Space Glass class migration), revisit this and flip to `style-src 'self' 'nonce-<nonce>'` with a per-response nonce injected by a Vercel edge function.

### 4.2 pgTAP / `supabase test db` in CI

Even outside the onboarding tests, the repo has a `supabase/tests/database/` directory that the current CI never runs. Wire `supabase start` + `supabase test db` into `.github/workflows/ci.yml` — the PR #155 scaffold is a fine starting point — so pgTAP failures block merges.

---

## Verification checklist for this session

- [ ] Migration for 1.1 applied; view advisor clears.
- [ ] Storage bucket fix (2.1) chosen between path A/B; advisor clears.
- [ ] One migration for 2.2 alters all 6 flagged functions; advisor clears.
- [ ] Leaked-password protection toggled on in dashboard (2.3); advisor clears.
- [ ] `VITE_SENTRY_DSN` set in Vercel prod; synthetic error lands in Sentry.
- [ ] `mcp get_advisors --type=security` returns an empty `lints` list (or only non-blocking informational entries).

## Verification checklist for stretch items

- [ ] pgTAP runner wired into CI; `npm run test:db` runs on every PR.
- [ ] `OrganizationCreation` moved under a `/organizations/new` route; mock client handles `initialize_new_tenant`; at least one E2E scenario covers the cold-start.
- [ ] E2E suite at 63/63 (or failing tests have per-issue GitHub issues with traces attached).
- [ ] CSP `style-src` hardened with a nonce; Deep Space Glass renders identically.
