[← Back to Documentation Index](../README.md)

# Release Prep Closure

**Last refreshed:** 2026-05-04
**Status:** Code-completable release-prep hardening is current through PR #266; not a final release sign-off.

This page closes the current release-prep documentation drift. It does not
replace the final review-pass sign-off, and it does not claim production
security, database, or observability settings that were not directly verified.

## Verified Evidence

- **Current repo head:** local `main` and `origin/main` are at
  `6b84a5cbe7ba0a2cde239e5367e1cd52a3df46ea`, the squash merge for PR #266
  (`fix(db): drop legacy current user role helper`).
- **Recent merged production-readiness PRs:** #257 registration-form writes, #258
  invite revoke, #259 schema-builder saves, #260 facility mutations, #261 team
  portal communication writes, #262 import job lifecycle writes, #263 release
  evidence refresh, #264 Edge Function budget guidance, #265 legacy evaluation
  RPC overload removal, and #266 legacy `current_user_role()` removal.
- **Frontend direct-write scan:** `rg -U` found no routed Supabase
  `insert`/`update`/`upsert`/`delete` calls under `frontend/src` outside the mock
  client. The only generic mutation matches in app code were local cache
  `Map.delete()` operations in `frontend/src/lib/cache.js`.
- **Vercel project:** `secureyourtech/squadlogic`
  (`prj_tdCn9qLkRFB9LFAVmp2AKJCkcDJ9`) exists, reports framework `vite`, and
  reports Node `24.x`. Project domains reported by the connector are
  `squadlogic.vercel.app`, `squadlogic.secureyour.tech`,
  `squadlogic-secureyourtech.vercel.app`, and
  `squadlogic-git-main-secureyourtech.vercel.app`.
- **Latest Vercel deployment visible in connector:** deployment
  `dpl_BiHCjxMUUktnxZHJRwij3NrWKqZa` is `READY` for PR #266 branch commit
  `e6aacbdc050b94ff48c6897037341aa92515e66b`; its target is `null`, so this is
  preview evidence, not production evidence.
- **Latest production-target Vercel deployment visible in connector:**
  deployment `dpl_EtxTonCsCxRVhWj3UjqEhLw5jZ8s` is `READY` for `main` commit
  `ffbb67467864c852c14cfe3836a699d10e5dbcae` (PR #261). The PR #266 merge
  commit `6b84a5cbe7ba0a2cde239e5367e1cd52a3df46ea` was not visible as a
  production-target deployment during this refresh.
- **GitHub `main` branch protection:** GitHub API returned `404 Branch not
  protected` for `repos/JoelA510/SquadLogic/branches/main/protection` during
  this refresh after PR #266 merged.
- **Repo migration inventory:** 74 SQL migration files are present locally; the
  latest file is
  `supabase/migrations/20260504100000_drop_current_user_role_helper.sql`.
- **Repo pgTAP inventory:** 31 SQL test files are present under
  `supabase/tests/`, covering RLS plus targeted RPC contracts added during the
  production-readiness PR queue.
- **CI and DB harness:** PR #209 restored hosted CI/E2E; PR #211 restored local
  and hosted pgTAP for DB-affecting PRs. PR #262 hosted checks reported
  `Build & Test`, pgTAP, CodeQL, GitGuardian, and Vercel as passing. PR #266
  hosted checks reported `Build & Test`, pgTAP, CodeQL, GitGuardian, and Vercel
  as passing before merge.
- **Release checks available today:** `npm ci`, `npm run typecheck`,
  `npm run lint`, `npm run test`, `npm run test:coverage`,
  `npm run frontend:build`, `npm run check:bundle`,
  `npm run check:advisors`, `npm run test:e2e -- --workers=1`, and
  `npm run test:db`.

## Explicit Deferrals

- **Final Lighthouse score:** no repo-native Lighthouse command exists. Use
  browser/manual Lighthouse during Task 9 or Task 10, then record the exact
  URL, mode, device profile, and score. Do not claim Lighthouse closure before
  that evidence exists.
- **Performance budget tightening:** current bundle budgets remain the active
  gate. Chart-vendor splitting, asset optimization, and tighter earned budgets
  are deferred to the performance polish task.
- **Vercel/CI Node parity:** Vercel currently reports Node `24.x`, while CI runs
  Node 20 and `package.json` declares `>=20`. The release-prep decision is to
  keep CI on Node 20 as the minimum supported runtime for now and treat Vercel
  Node 24 as a documented deployment setting. Changing either side requires a
  separate PR with the full build/test/E2E verification suite.
- **Current main production deployment:** connector evidence did not show
  `6b84a5cbe7ba0a2cde239e5367e1cd52a3df46ea` as a production-target deployment
  during this refresh. The latest production-target deployment visible in the
  connector remains `dpl_EtxTonCsCxRVhWj3UjqEhLw5jZ8s` for PR #261 commit
  `ffbb67467864c852c14cfe3836a699d10e5dbcae`. Operators must either
  wait for/trigger the production deployment and record the resulting deployment
  id, or explicitly decide that a later commit is the release candidate.
- **Production Supabase advisor state:** production advisor output was not
  rechecked in this docs task. Use the Supabase dashboard/MCP before final
  release sign-off.
- **Sentry:** the SDK is wired, but `VITE_SENTRY_DSN` production/preview values
  and the synthetic event smoke remain operator-owned until verified with
  [`sentry-smoke.md`](./sentry-smoke.md).

## Operator Checks Before Final Sign-Off

- Configure `main` branch protection and required checks, or document an
  intentional exception. Connector/API evidence during this refresh showed
  `main` was not protected.
- Confirm the production-target Vercel deployment for the intended release
  commit. As of this refresh, the latest production-target deployment visible to
  the connector was PR #261, not PR #266.
- Confirm Vercel production/preview environment variables, especially
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_USE_MOCK_SUPABASE`, and
  `VITE_SENTRY_DSN`.
- Configure or intentionally disable the raw-import cleanup workflow secrets:
  `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm production Supabase migration count and advisor output.
- Run the full final validation suite listed in the release-readiness plan.

## Rollback

This document is docs-only. Roll back by reverting the PR that changed it. No
runtime, schema, or data rollback is required.
