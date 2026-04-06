# SquadLogic Expansion Execution Pack

This folder contains the active roadmap, architectural decisions, and execution log for the SquadLogic platform.

> [!NOTE]
> Completed epic work orders and the original master expansion spec have been archived to `docs/archive/expansion-epics/`.
> The production cutover runbook has been promoted to `docs/operations/production-cutover.md`.

## Active Documents

1.  **[00_INDEX.md](./00_INDEX.md)** - This file.
2.  **[03_ROADMAP.md](./03_ROADMAP.md)** - Milestone-based roadmap with dependencies and current status.
3.  **[19_EPIC_LAUNCH_AND_BEYOND_CLAUDE.md](./19_EPIC_LAUNCH_AND_BEYOND_CLAUDE.md)** - Detailed execution plan for CI/CD, Game Scheduler, and Live Backend.
4.  **[20_GAME_SCHEDULE_GRID_ARCHITECTURE.md](./20_GAME_SCHEDULE_GRID_ARCHITECTURE.md)** - _(ADR)_ Game Schedule Grid component architecture design.
5.  **[98_PROGRESS_LOG.md](./98_PROGRESS_LOG.md)** - Running log of execution progress.

## Related Active Docs (Promoted)

- **[Production Cutover Runbook](../operations/production-cutover.md)** — v1.0 production deployment runbook (moved to `docs/operations/`).

---

## Archived Documents (Historical Reference)

The following files were completed during the Build 1.0 phase and are preserved in `docs/archive/expansion-epics/` for audit traceability:

| Original File | Description |
|---|---|
| `01_SCOPE_GUARDRAILS.md` | Explicit inclusions, exclusions, and privacy constraints |
| `02_PROCESS_INVENTORY_DEDUP.md` | Normalized list of all features/processes to build |
| `04_AGENT_RUNBOOK.md` | Instructions for the AI agent executing the build plan |
| `05_CODE_REVIEW_TEMPLATE.md` | Template for self-reviews before push |
| `10_EPIC_FOUNDATIONS.md` | Repo structure, Types, CI, Testing harness |
| `11_EPIC_CORE_DOMAIN.md` | Organizations, Users, Permissions, Persistence |
| `12_EPIC_SCHEDULING.md` | Scheduling engine, Conflicts, Cal sync |
| `13_EPIC_TEAMS_ROSTERS.md` | Roster management, Team formation |
| `14_EPIC_COMMS.md` | Notifications, Chat, Alerts |
| `15_EPIC_REGISTRATION_DATA.md` | Data ingestion, Forms |
| `16_EPIC_REPORTING.md` | Analytics, Exports |
| `17_EPIC_TECH_DEBT.md` | Vite 6, React 19, Tailwind 4, TypeScript adoption |
| `SquadLogic Master Expansion.md` | Original 76KB master expansion specification |

Previously archived (in `docs/archive/expansion/`):

- **[18_BUILDTWO_GAP_ANALYSIS.md](../archive/expansion/18_BUILDTWO_GAP_ANALYSIS.md)** — BUILDTWO prototype gap analysis (all gaps resolved)
- **[19_EPIC_LAUNCH_AND_BEYOND.md](../archive/expansion/19_EPIC_LAUNCH_AND_BEYOND.md)** — Summary version of the launch plan
