# SquadLogic Documentation

> **Status**: v1.0 GA shipped; Wave 7–9 hardening in flight (see [`expansion/98_PROGRESS_LOG.md`](expansion/98_PROGRESS_LOG.md)).
> **Documentation standard**: Active docs live in categorized subdirectories. Archived content under `archive/` is immutable and preserved for audit traceability.

## Reading Path for New Contributors

1. Start with [`architecture/system-overview.md`](architecture/system-overview.md) — technology stack and top-level diagram.
2. Read [`architecture/multi_tenancy.md`](architecture/multi_tenancy.md) and [`security/rls-policies.md`](security/rls-policies.md) for the multi-tenant security model.
3. Read [`architecture/persistence-rpc-layer.md`](architecture/persistence-rpc-layer.md) and [`architecture/edge-functions-inventory.md`](architecture/edge-functions-inventory.md) for how writes actually happen.
4. Skim [`architecture/frontend-architecture.md`](architecture/frontend-architecture.md) for routing, hooks, and component organization.
5. Skim [`architecture/team-generation.md`](architecture/team-generation.md), [`architecture/practice-scheduling.md`](architecture/practice-scheduling.md), and [`architecture/game-scheduling.md`](architecture/game-scheduling.md) for the core domain algorithms.
6. Check [`expansion/98_PROGRESS_LOG.md`](expansion/98_PROGRESS_LOG.md) for the append-only development log.

---

## Architecture

- [System Overview](architecture/system-overview.md) — Top-level architecture, technology stack, request flow, deployment topology.
- [Frontend Architecture](architecture/frontend-architecture.md) — Routing, lazy loading, React Context providers, hooks, design-system usage.
- [Data Modeling](architecture/data-modeling.md) — PostgreSQL schema: tables, columns, indexes, foreign keys, JSONB shapes.
- [Multi-Tenancy](architecture/multi_tenancy.md) — Organization scoping, `organization_members`, tenant isolation guarantees.
- [Persistence RPC Layer](architecture/persistence-rpc-layer.md) — Canonical inventory of every `SECURITY DEFINER` RPC, contract pattern, and checklist for adding a new one.
- [Edge Functions Inventory](architecture/edge-functions-inventory.md) — Every deployed Edge Function, its inputs/outputs, RLS interaction, and the RPC vs Edge-Function decision rule.
- [Team Generation](architecture/team-generation.md) — Algorithm design for converting registrations into balanced teams.
- [Practice Scheduling](architecture/practice-scheduling.md) — Practice slot allocation and conflict resolution.
- [Game Scheduling](architecture/game-scheduling.md) — Game slot allocation and matchup fairness.
- [Evaluation Pipeline](architecture/evaluation-pipeline.md) — Scoring engine, metrics, findings, and `evaluation_runs` persistence.
- [Output Generation](architecture/output-generation.md) — Exports, ICS calendar feeds, and downstream deliverables.

## Operations

- [Environment Variables](operations/ENVIRONMENT.md) — Full `VITE_*` / server-side env-var reference.
- [CI/CD Operations](operations/ci-cd.md) — GitHub Actions scope, reproducibility, artifacts, and branch-protection policy.
- [Production Cutover](operations/production-cutover.md) — Production deployment runbook.
- [Release Prep Closure](operations/release-prep.md) — Current release-prep evidence, explicit deferrals, and operator checks.
- [Ingestion Pipeline](operations/ingestion-pipeline.md) — GotSport CSV import flow end-to-end.
- [Advisor Lint](operations/advisor-lint.md) — Static migration security gate (Wave 6a Task 2).
- [Bundle Budget](operations/bundle-budget.md) — Frontend asset-size budget and enforcement.
- [Leaked-Password Protection](operations/leaked-password-protection.md) — Supabase Auth HIBP integration.
- [Sentry Smoke Test](operations/sentry-smoke.md) — Sentry integration runbook and verification.

## Security

- [Audit & Remediation Plan](security/audit_and_remediation_plan.md) — Master security audit tracker.
- [RLS Policies](security/rls-policies.md) — Row-Level Security policy catalogue.
- [Content-Security-Policy](security/csp.md) — CSP header policy and `connect-src` decisions (Wave 7b).
- [Dependabot Waivers](security/dependabot-waivers.md) — Documented waivers for npm-audit / Dependabot alerts.

## Testing

- [E2E Master Plan](testing/e2e_master_plan.md) — Playwright-BDD scope, Gherkin feature map, mock/live split.
- [Test Helpers & Factories](testing/test-helpers.md) — Shared test factory/helper usage, hoisted auth-mock idiom, and migration patterns.

## Governance

- [Governance Framework](governance/governance-framework.md) — Phase 2 enterprise governance baseline.
- [Governance Framework — Phase 3](governance/governance-framework-phase-3.md) — Smart Ingestion governance overlay.
- [Governance Framework — Phase 4](governance/governance-framework-phase-4.md) — Performance governance overlay.
- [Governance Framework — Phase 5](governance/governance-framework-phase-5.md) — Accessibility governance overlay.
- [Master Audit Certification](governance/master-audit-certification.md) — Enterprise audit certification summary.
- [Accessibility Compliance Log](governance/accessibility-compliance.md) — Stage 4 accessibility compliance tracking.
- [Modularity Transition Plan](governance/modularity-transition.md) — Enterprise UI/UX and modularity roadmap.

## Audits

### Wave 0

- [Planning Drift Report](audits/wave-0/drift-report.md) — Drift audit between `.claude/wave-*-prompt.md` specs and repo state.

### Wave 1a

- [Consolidated Index](audits/wave-1a/index.md) — Entry point linking all Wave 1a audit deliverables.
- [Code Quality](audits/wave-1a/code-quality.md) — Repo-wide code-quality findings.
- [Security](audits/wave-1a/security.md) — Security posture audit.
- [Supabase Performance](audits/wave-1a/supabase-performance.md) — Query plans, index coverage, advisor findings.
- [Free-Tier Usage](audits/wave-1a/free-tier.md) — Supabase free-tier ceiling analysis.
- [Accessibility](audits/wave-1a/accessibility.md) — WCAG 2.2 AA conformance audit.

## UI/UX

- [Agent UI/UX Guidelines](ui/agent-ui-ux-guidelines.md) — Canonical behavior rules for agents doing UI/UX work.
- [UI/UX Pass Checklist (P0/P1)](ui/ui-ux-pass.md) — Prioritized checklist for UI/UX passes.
- [UI/UX Pass Summary](ui/ui-ux-pass-summary.md) — Rolled-up status of the UI/UX pass.
- [UI/UX Visual Polish (P2)](ui/ui-ux-polish.md) — P2 visual polish playbook.
- Rule IDs: [`ui/ui-ux-rules.json`](ui/ui-ux-rules.json) (machine-readable rule identifiers).

## Expansion / Planning

- [Expansion Index](expansion/00_INDEX.md) — Entry point to the expansion execution pack.
- [Roadmap](expansion/03_ROADMAP.md) — Active roadmap and milestone tracking.
- [Epic 19 — Launch & Beyond (Claude variant)](expansion/19_EPIC_LAUNCH_AND_BEYOND_CLAUDE.md) — From 57 green tests to v1.0 production.
- [Phase 2 — GameScheduleGrid Architecture](expansion/20_GAME_SCHEDULE_GRID_ARCHITECTURE.md) — Component architecture design for the game-schedule grid.
- [v1.1 Planning](expansion/21_V1_1_PLANNING.md) — Import persistence, teaming, and coach-leads post-v1.0 plan.
- [Next Session Plan](expansion/NEXT_SESSION_PLAN.md) — Scratchpad for the next dev session (security advisor cleanup + deferred items).
- [Progress Log (append-only)](expansion/98_PROGRESS_LOG.md) — Immutable per-wave progress log.

## SQL

- `sql/sample_seed_data.sql` — Sample seed dataset for local development.
- `sql/verify_rls_policies.sql` — RLS policy verification script.
- `sql/reverts/` — Per-migration revert scripts (timestamped, one per Wave-6a+ migration).
- `sql/tests/` — Per-migration smoke SQL scripts.

## Archive

> `docs/archive/**` contents are **immutable**. Preserved for git history, audit compliance, and architectural decision context. Do not modify.

- [Requirements Archive](archive/requirements.md) — Original requirements snapshot.
- `archive/architecture/` — Superseded architecture snapshots (e.g., `phase_1_audit_report.md`).
- `archive/expansion/` — Superseded expansion artifacts (Build-Two gap analysis, pre-2026-04-16 session plans, pre-Claude Epic 19).
- `archive/expansion-epics/` — Completed epic work orders (`10_EPIC_FOUNDATIONS.md` through `17_EPIC_TECH_DEBT.md`), scope guardrails, process inventory, agent runbook, and code-review template.
- `archive/governance/` — Completed audit-stage pass/fail criteria (stages 1–4) and code-review report.
- `archive/operations/` — Closed-out production-readiness plan (`production-readiness-plan-2026-04-12.md`).
- `archive/sql/` — Consolidated incremental schema patches and the initial-schema snapshot.
- `archive/testing/` — Historical test-execution audit.
- `archive/ui/` — Completed UI/UX audit artifacts (findings, issues, plan, status, verification, implementation plan, reflections, repo-files index).
