[← Back to Documentation Index](../README.md)
---

# CI/CD Operations

## GitHub Actions

The primary workflow is [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
It runs on pushes to `main`, pull requests targeting `main`, weekly
Supabase keep-alive schedules, and manual dispatch.

## Reproducibility

CI installs dependencies with `npm ci` from `package-lock.json`. The local
fresh-checkout baseline is:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run frontend:build
npm run check:bundle
npm run check:advisors
```

`npm run check:bundle` must run after `npm run frontend:build` because it
reads `dist/assets`. If the build artifact is missing, the bundle gate fails
loudly and tells the operator to build first.

## Pull Request Scope

PRs that touch only Markdown or files under `docs/` run a docs-only path:

- checkout
- changed-file classification
- `git diff --check`

All code, config, workflow, package, Supabase, test, or asset changes run the
full Node/build/test matrix. Workflow files are intentionally not considered
docs-only, even when their changes are comment-only, because they affect
release automation.

## Artifacts

The full matrix uploads these artifacts when present, including on failure:

- Playwright HTML report: `playwright-report/`
- Playwright traces, screenshots, videos, and error contexts: `test-results/`
- Bundle-budget command output: `bundle-budget-report.txt`
- Coverage output: `coverage/`

The Playwright artifact upload is part of the failure triage loop: use the
HTML report and trace zip before changing feature files or assertions.

## Scheduled Jobs

The weekly keep-alive job validates `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, then pings the Supabase REST API. Missing secrets
or API failures fail the scheduled run; the workflow must not silently hide a
paused or unreachable project.

Raw import retention is handled by
[`.github/workflows/cleanup-raw-imports.yml`](../../.github/workflows/cleanup-raw-imports.yml).
It requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, validates
`dry_run`, and fails fast when either secret is missing.

## Branch Protection

`main` must be protected before release work can merge. Required checks should
include the primary CI workflow, CodeQL, the Vercel deployment check, and the
pgTAP workflow for database-affecting pull requests. Conversation resolution
and pull-request review should remain required.

## Rollback

Workflow changes are rolled back by reverting the pull request that introduced
them. Since these changes are limited to CI/CD automation, no database or
runtime data rollback is typically required.
