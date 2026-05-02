[← Back to Documentation Index](../README.md)
---

# Release Prep Closure

**Last refreshed:** 2026-05-02
**Status:** Conditionally ready for continued release-prep work; not a final release sign-off.

This page closes the current release-prep documentation drift. It does not
replace the final review-pass sign-off, and it does not claim production
security, database, or observability settings that were not directly verified.

## Verified Evidence

- **Vercel project:** `secureyourtech/squadlogic`
  (`prj_tdCn9qLkRFB9LFAVmp2AKJCkcDJ9`) exists and reports framework `vite`.
- **Latest production deployment:** Vercel reports deployment
  `dpl_EJTL5dvHaYvdVaU9LD3gFzjjSnTt` as `READY` for `main` commit
  `30f9aa7e9728008b7038228d9b74b46cc7c2141a` (PR #212).
- **Repo migration inventory:** 49 SQL migration files are present locally; the
  latest file is
  `supabase/migrations/20260430120000_recreate_import_efficiency_metrics_from_payload.sql`.
- **CI and DB harness:** PR #209 restored hosted CI/E2E; PR #211 restored local
  and hosted pgTAP for DB-affecting PRs.
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
- **Production Supabase advisor state:** production advisor output was not
  rechecked in this docs task. Use the Supabase dashboard/MCP before final
  release sign-off.
- **Sentry:** the SDK is wired, but `VITE_SENTRY_DSN` production/preview values
  and the synthetic event smoke remain operator-owned until verified with
  [`sentry-smoke.md`](./sentry-smoke.md).

## Operator Checks Before Final Sign-Off

- Confirm `main` branch protection settings and required checks.
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
