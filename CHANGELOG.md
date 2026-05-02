# Changelog

All notable changes to SquadLogic are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Release hygiene: CI now uses `npm ci`, explicit docs-only diff checks, concurrency, full E2E artifacts, and a hosted full E2E path restored in PR #209.
- Release hygiene: local and CI pgTAP now use a pinned Supabase CLI, committed `supabase/config.toml`, repaired fresh migration replay, and reproducible full/single-file DB test commands from PR #211.

### Documentation

- Clarified that GotSport CSV import validation and `import_jobs` tracking are shipped, while durable apply/promotion into player, coach, team, or staging records remains pending v1.1 work.

## [1.0.1] - 2026-04-23

### Added

- Wave 3a: Shared test factories under `tests/factories/**` (`audit`, `organization`, `player`, `run`, `scheduling`, `season`, `team`, `user`) for deterministic test data seeding. (#188)
- Wave 6a: Bundle-budget CI gate (`npm run check:bundle`, `scripts/check-bundle-size.js`, `config/bundle-budget.json`) and advisor-lint CI gate (`npm run check:advisors`, `scripts/advisor-lint.js`); wired into `.github/workflows/ci.yml`. (#173)
- Wave 6b: 15 hot-path database indexes covering org-scoped queries on `scheduler_runs`, `event_rsvps`, `team_players`, `import_jobs`, `games`, and 8 multi-tenancy tables (`divisions`, `teams`, `players`, `coaches`, `locations`, `fields`, `field_subunits`, `practice_slots`). Migration `20260421005642_add_free_tier_indexes.sql`. (#174)
- Wave 7b: `docs/security/csp.md` documenting the full Content Security Policy, Sentry ingest + Supabase wildcard additions to `connect-src`, waivers for `style-src 'unsafe-inline'` (Tailwind 4 compatibility), and a nonce-based tightening follow-up plan. (#175)

### Changed

- Wave 1b: Repo-wide trivial sweep — removed dead `expect` imports from 19 vitest files, underscore-prefixed unused locals/args across ~25 files, and applied 8 accessibility attribute fixes (`type=button`, `htmlFor`, `aria-label`, `aria-required`, screenReaderInstructions). Lint baseline collapsed from 66 warnings to 4. (#173)
- Wave 2: Flipped `vercel.json` CSP header from `Content-Security-Policy-Report-Only` to enforcing (also added `object-src 'none'` and `upgrade-insecure-requests`); switched `public.import_efficiency_metrics` view to `SECURITY INVOKER`; scoped the `raw-imports` storage bucket to private with org-member path-prefix RLS; pinned `search_path` on 7 `ALTER FUNCTION` statements across 6 definer functions (including both `persist_evaluation_run` overloads). (#157, #173)
- Main: `frontend/src/components/ImportPanel.jsx` and `frontend/src/components/ui/Button.jsx` type-narrowed to unblock `main` CI after PRs #184, #185, #186, and #187. Extracted shared `ImportType` typedef and froze the constant set. (#189)

### Fixed

- Wave 3a: `makeAuthSession` no longer returns a pre-expired session; the `user` subobject now shallow-merges under partial overrides so test callers can override without clobbering defaults. (#188)
- Main: Pre-existing TypeScript errors in `frontend/src/components/ImportPanel.jsx:517,623`; narrowed `importType` union and documented the `Button` `title` prop. (#189)

### Security

- Wave 2: Closed the repo-owned NEXT_SESSION_PLAN §1–§3 Supabase security advisor findings for `import_efficiency_metrics`, public `raw-imports`, and mutable `search_path` on 6 definer functions. Operator runbooks shipped at `docs/operations/sentry-smoke.md` and `docs/operations/leaked-password-protection.md`; production Sentry/leaked-password dashboard verification remains operator-owned. Dependabot prod-clean; vitest/vite dev-only finding waived in `docs/security/dependabot-waivers.md`. (#173)
- Wave 6a: Advisor-lint CI gate now blocks PRs that introduce `SECURITY DEFINER` without pinned `search_path`, `CREATE VIEW` without `security_invoker` on RLS-sensitive migrations, `CREATE TABLE` without RLS, `USING/WITH CHECK (true)` policies, or suspicious `VITE_*SECRET*` env keys. Corrective migration `20260421002500_lock_search_path_remaining_definers.sql` pinned `search_path` on 4 additional definer functions (`is_org_admin`, `is_org_member`, `handle_field_subunits`, `prune_old_audit_logs`) and flipped `coach_team_map` view to `security_invoker = on`. (#173)
- Wave 7b: Hardened CSP `connect-src` with the Sentry ingest domain and the Supabase project wildcard; documented policy + waivers in `docs/security/csp.md`. Production response headers verified live. (#175)

## [1.0.0] - 2026-03-10

### Added

- Initial v1.0 MVP: team generation, practice scheduling, game scheduling, roster management, CSV import pipeline, team portal, admin compliance dashboard, calendar feeds, league standings.
- Deep Space Glass design system with four themes (`dark`, `light`, `party`, `club`).
- Supabase multi-tenancy with RLS across the core domain tables.
- Playwright-BDD E2E suite (63/63 passing post-Epic 19 Phase 3 cutover).
- Sentry error monitoring + BetterStack/Logtail Edge Function logging.
- Maintenance-mode overlay + OfflineGuard.

See [`docs/expansion/98_PROGRESS_LOG.md`](docs/expansion/98_PROGRESS_LOG.md) for the full chronology.
