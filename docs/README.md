# SquadLogic Documentation

> **Status**: v1.0.1 shipped; the Lightning-class enterprise redesign is merged on `main`.
> **Documentation standard**: Active docs live in categorized subdirectories and describe the *current* system. Historical records (completed plans, point-in-time audits, progress logs) are retired to git history; their durable knowledge is consolidated in [`LESSONS_LEARNED.md`](LESSONS_LEARNED.md).

## Reading Path for New Contributors

1. Start with [`architecture/system-overview.md`](architecture/system-overview.md) — technology stack and top-level diagram.
2. Read [`architecture/multi_tenancy.md`](architecture/multi_tenancy.md) and [`security/rls-policies.md`](security/rls-policies.md) for the multi-tenant security model.
3. Read [`architecture/persistence-rpc-layer.md`](architecture/persistence-rpc-layer.md) and [`architecture/edge-functions-inventory.md`](architecture/edge-functions-inventory.md) for how writes actually happen.
4. Skim [`architecture/frontend-architecture.md`](architecture/frontend-architecture.md) for routing, hooks, and component organization.
5. Skim [`architecture/team-generation.md`](architecture/team-generation.md), [`architecture/practice-scheduling.md`](architecture/practice-scheduling.md), and [`architecture/game-scheduling.md`](architecture/game-scheduling.md) for the core domain algorithms.
6. Read [`LESSONS_LEARNED.md`](LESSONS_LEARNED.md) before making decisions it covers.

---

## Lessons Learned

- [Lessons Learned](LESSONS_LEARNED.md) — Durable engineering knowledge consolidated from the build-out: security/multi-tenancy gotchas, schema and import patterns, frontend patterns, testing/CI discipline, and decision rationale.

## Architecture

- [Current Architecture Map](ARCHITECTURE.md) — Reconnaissance map of the system as built: domain model, solver and validation paths, persistence and I/O, measured test coverage, and the "Known gaps" list that drives the scheduling-engine build plan.
- [System Overview](architecture/system-overview.md) — Top-level architecture, technology stack, request flow, deployment topology.
- [Frontend Architecture](architecture/frontend-architecture.md) — Routing, lazy loading, React Context providers, hooks, design-system usage.
- [Data Modeling](architecture/data-modeling.md) — PostgreSQL schema: tables, columns, indexes, foreign keys, JSONB shapes.
- [Multi-Tenancy](architecture/multi_tenancy.md) — Organization scoping, `organization_members`, tenant isolation guarantees.
- [Persistence RPC Layer](architecture/persistence-rpc-layer.md) — Canonical inventory of every `SECURITY DEFINER` RPC, contract pattern, and checklist for adding a new one.
- [Edge Functions Inventory](architecture/edge-functions-inventory.md) — Every deployed Edge Function, its inputs/outputs, RLS interaction, and the RPC vs Edge-Function decision rule.
- [GotSport Import Contract](architecture/gotsport-import-contract.md) — Whitelisted player/coach fields kept vs. dropped, age-cutoff modes, play-up rules, division auto-create, and coach→team linkage.
- [Team Generation](architecture/team-generation.md) — Algorithm design for converting registrations into balanced teams.
- [Incremental Teaming Hardening](architecture/incremental-teaming-hardening.md) — Snapshot-aware / incremental team generation: re-run policies, the `changePolicy` reference, change diagnostics, persistence invariants.
- [Practice Scheduling](architecture/practice-scheduling.md) — Practice slot allocation and conflict resolution.
- [Game Scheduling](architecture/game-scheduling.md) — Game slot allocation and matchup fairness.
- [Game Schedule Grid (ADR)](architecture/game-schedule-grid.md) — Component architecture for the drag-and-drop game-schedule grid (Fields × Time Slots layout, droppable-key design, optimistic UI).
- [Evaluation Pipeline](architecture/evaluation-pipeline.md) — Scoring engine, metrics, findings, and `evaluation_runs` persistence.
- [Output Generation](architecture/output-generation.md) — Exports, ICS calendar feeds, and downstream deliverables.

## Operations

- [Environment Variables](operations/ENVIRONMENT.md) — Full `VITE_*` / server-side env-var reference.
- [CI/CD Operations](operations/ci-cd.md) — GitHub Actions scope, reproducibility, artifacts, and branch-protection policy.
- [Production Cutover](operations/production-cutover.md) — Production deployment runbook.
- [Release Prep Closure](operations/release-prep.md) — Current release-prep evidence, explicit deferrals, and operator checks.
- [Ingestion Pipeline](operations/ingestion-pipeline.md) — GotSport CSV import flow end-to-end.
- [Advisor Lint](operations/advisor-lint.md) — Static migration security gate.
- [Bundle Budget](operations/bundle-budget.md) — Frontend asset-size budget and enforcement.
- [Edge Function Budget](operations/edge-function-budget.md) — Supabase Edge Function cost, dependency, logging, and review guardrails.
- [Leaked-Password Protection](operations/leaked-password-protection.md) — Supabase Auth HIBP integration.
- [Sentry Smoke Test](operations/sentry-smoke.md) — Sentry integration runbook and verification.
- [Storage Retention](operations/storage-retention.md) — `raw-imports` bucket cleanup workflow and safety caps.

## Security

- [RLS Policies](security/rls-policies.md) — Row-Level Security policy catalogue.
- [Content-Security-Policy](security/csp.md) — CSP header policy, waivers, and `connect-src` decisions.
- [Dependabot Waivers](security/dependabot-waivers.md) — Documented waivers for npm-audit / Dependabot alerts.

## Testing

- [E2E Master Plan](testing/e2e_master_plan.md) — Playwright-BDD scope, Gherkin feature map, mock/live split.
- [pgTAP](testing/pgtap.md) — Database-level RLS/RBAC regression testing.
- [Test Helpers & Factories](testing/test-helpers.md) — Shared test factory/helper usage, hoisted auth-mock idiom, and migration patterns.

## Governance

- [Governance Framework](governance/governance-framework.md) — The non-negotiable engineering mandates: RPC enforcement, definer hygiene, schema rigidity, audit immutability, privacy, and quality gates.

## UI/UX

- [Agent UI/UX Guidelines](ui/agent-ui-ux-guidelines.md) — Canonical behavior rules for agents doing UI/UX work ("Lightning-class" standards).
- [UI/UX Pass Checklist (P0/P1)](ui/ui-ux-pass.md) — Prioritized checklist for UI/UX passes.
- [UI/UX Visual Polish (P2)](ui/ui-ux-polish.md) — P2 visual polish playbook.
- Rule IDs: [`ui/ui-ux-rules.json`](ui/ui-ux-rules.json) (machine-readable rule identifiers).

## Planning

- [Roadmap](expansion/03_ROADMAP.md) — Delivered phases and the current open-items backlog.
- [v1.1 Planning](expansion/v1.1-planning.md) — Import write-through completion, division configuration, and coach management scope for v1.1.

## Fixtures

- [Fall 2026 Field Availability](fixtures/fall-2026-field-availability.md) — Canonical field-availability fixture used by lifecycle tests.
- [Season 2026 Regression Corpus](../fixtures/season-2026/README.md) — A full anonymized season: known-good invariants and the numbered incident log the build plan references. Loaded read-only by `packages/core/src/fixtures/`.
- [Model Gaps](MODEL_GAPS.md) — What the season-2026 corpus contains that the current domain types cannot represent, with source field, example, current behaviour, and the phase that needs each one.
- [Constraint Registry](CONSTRAINT_REGISTRY.md) — Constraints as records rather than control flow: hardness (hard/soft/preference), scope and its precedence rule, effective windows, provenance, the seeded season-2026 set, the "what if this went back to being a preference?" query, and the bounded placement demonstration harness.
- [Duration Migration Path](DURATION_MIGRATION.md) — Analysis only: every place a game duration lives today, what it silently means, what it becomes under the occupancy/play/block/warm-up model, and what would break. No migration has been performed.

## SQL

- `sql/sample_seed_data.sql` — Sample seed dataset for local development.
- `sql/verify_rls_policies.sql` — RLS policy verification script.
- `sql/*_revert.sql` / `sql/reverts/` — Per-migration revert scripts.
- `sql/*_smoke.sql` / `sql/tests/` — Per-migration smoke SQL scripts.
