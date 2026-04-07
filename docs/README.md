# SquadLogic Documentation

> **Last restructured**: April 6, 2026
> **Documentation standard**: All active docs maintained in categorized subdirectories; historical content archived with full audit traceability.

## Quick Navigation

| Need | Go To |
|---|---|
| System architecture & tech stack | [`architecture/system-overview.md`](architecture/system-overview.md) |
| Frontend routing, hooks & components | [`architecture/frontend-architecture.md`](architecture/frontend-architecture.md) |
| Database schema & data model | [`architecture/data-modeling.md`](architecture/data-modeling.md) |
| Multi-tenancy & org isolation | [`architecture/multi_tenancy.md`](architecture/multi_tenancy.md) |
| Team generation algorithm | [`architecture/team-generation.md`](architecture/team-generation.md) |
| Practice scheduling design | [`architecture/practice-scheduling.md`](architecture/practice-scheduling.md) |
| Game scheduling algorithm | [`architecture/game-scheduling.md`](architecture/game-scheduling.md) |
| Output generation & exports | [`architecture/output-generation.md`](architecture/output-generation.md) |
| Evaluation pipeline design | [`architecture/evaluation-pipeline.md`](architecture/evaluation-pipeline.md) |
| Security audit & remediation | [`security/audit_and_remediation_plan.md`](security/audit_and_remediation_plan.md) |
| RLS policies reference | [`security/rls-policies.md`](security/rls-policies.md) |
| Enterprise audit certification | [`governance/master-audit-certification.md`](governance/master-audit-certification.md) |
| Governance framework (Phase 2) | [`governance/governance-framework.md`](governance/governance-framework.md) |
| Governance — Smart Ingestion (Phase 3) | [`governance/governance-framework-phase-3.md`](governance/governance-framework-phase-3.md) |
| Governance — Performance (Phase 4) | [`governance/governance-framework-phase-4.md`](governance/governance-framework-phase-4.md) |
| Governance — Accessibility (Phase 5) | [`governance/governance-framework-phase-5.md`](governance/governance-framework-phase-5.md) |
| Modularity transition plan | [`governance/modularity-transition.md`](governance/modularity-transition.md) |
| Accessibility compliance log | [`governance/accessibility-compliance.md`](governance/accessibility-compliance.md) |
| Production deployment runbook | [`operations/production-cutover.md`](operations/production-cutover.md) |
| Data ingestion pipeline | [`operations/ingestion-pipeline.md`](operations/ingestion-pipeline.md) |
| UI/UX guidelines & checklist | [`ui/ui-ux-pass.md`](ui/ui-ux-pass.md) |
| Project roadmap & milestones | [`expansion/03_ROADMAP.md`](expansion/03_ROADMAP.md) |
| Execution progress log | [`expansion/98_PROGRESS_LOG.md`](expansion/98_PROGRESS_LOG.md) |
| E2E testing master plan | [`testing/e2e_master_plan.md`](testing/e2e_master_plan.md) |

---

## Directory Structure

```
docs/
├── architecture/       # System architecture, data model, scheduling algorithms, frontend structure
├── security/            # Security audit, RLS policies, password hardening
├── governance/          # Enterprise certification, compliance, per-phase governance frameworks
├── operations/          # Production runbooks, ingestion pipeline specifications
├── ui/                  # UI/UX checklists, visual polish guides, agent instructions
├── expansion/           # Active roadmap, ADRs, and execution log
├── sql/                 # Active seed data and RLS verification scripts
├── testing/             # E2E test plans and test infrastructure docs
└── archive/             # Historical docs preserved for audit traceability
    ├── architecture/    # Superseded architecture snapshots
    ├── expansion/       # Older expansion archive items
    ├── expansion-epics/ # Completed epic work orders & master expansion spec
    ├── governance/      # Completed audit stage pass/fail criteria & code review report
    ├── sql/             # Consolidated incremental schema patches
    ├── testing/         # Historical test execution audits
    └── ui/              # Completed UI/UX audit artifacts
```

## Reading Path for New Contributors

1. Start with **[`architecture/system-overview.md`](architecture/system-overview.md)** for the full technology stack and system diagram.
2. Review **[`security/rls-policies.md`](security/rls-policies.md)** to understand the multi-tenant security model.
3. Read **[`architecture/frontend-architecture.md`](architecture/frontend-architecture.md)** for routing, hooks, and component organization.
4. Skim **[`architecture/team-generation.md`](architecture/team-generation.md)** and **[`architecture/practice-scheduling.md`](architecture/practice-scheduling.md)** for the core domain algorithms.
5. Check **[`expansion/98_PROGRESS_LOG.md`](expansion/98_PROGRESS_LOG.md)** for the complete development history.

## Archive Policy

Documents in `archive/` are **read-only historical records**. They are never modified but preserved for:
- Git history traceability
- Audit compliance requirements
- Architectural decision context

To reference an archived document, use the path `docs/archive/<category>/<filename>`.
