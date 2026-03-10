# Production Roadmap: SquadLogic Expansion

**Strategy**: "Core First, Then Features". We have successfully built the robust data model, the core scheduling engine, and the frontend admin shell. The focus now shifts to hardening the admin workflows, enforcing multi-tenancy, and building out the communication/reporting features.

_Note on Epics: Epics 10 (Foundations), 11 (Core Domain), 12 (Scheduling Engine), and 13 (Teams & Rosters) are largely complete at the algorithmic and schema levels. Remaining work in these epics is strictly UI wiring and edge-case hardening._

---

## Phase 1: Implemented Baseline (Completed)

**Goal**: Establish the bedrock, data models, and algorithmic engines.

- **Foundations**: Vitest, ESLint, Prettier, Monorepo structure (`@squadlogic/core`).
- **Core Data Model**: Supabase Organizations, Users, Profiles, RLS Policies, Context Providers.
- **Scheduling Engine**: Round-robin generation, conflict-aware slot allocation, daylight savings expansion.
- **Team Formation**: Auto-drafting honoring mutual buddy requests, coach assignments, and roster caps.
- **Evaluation Pipeline**: Automated readiness scoring, fairness metrics, and conflict detection.
- **Frontend Shell**: React Router, Deep Space Glass UI, Theme Context, Dashboard Aggregation Hooks.

## Phase 2: Partial / In-Progress (Current Focus)

**Goal**: Connect the engines to the humans. Polish the admin experience and enforce security.

- **Milestone 2.1: RBAC & Multi-Tenancy**: Broaden `usePermission` enforcement across all routes. Tighten RLS to strictly require `organization_id` checks.
- **Milestone 2.2: Ingestion Hardening**: [COMPLETED] Finalize the CSV import-to-profile pipeline, ensuring robust validation and error recovery for GotSport data.
- **Milestone 2.3: Admin Overrides**: [COMPLETED] Complete the UI for drag-and-drop roster adjustments, manual practice slot overrides, and game conflict resolution.
- **Milestone 2.4: Output Operationalization**: [COMPLETED] Connect the existing CSV formatters to Supabase Storage uploads and finalize coach email draft generation.

## Phase 3: Still Missing (Future Features)

**Goal**: Expand the platform into a full-suite club management tool.

- **Milestone 3.1: Facility Management**: [COMPLETED] Full CRUD UI for Venues, Fields, and Blackout Dates (currently handled via scripts/imports).
- **Milestone 3.2: Communication**: RSVP tracking, trigger-based notifications (Rainouts, Schedule Changes), and Team Chat.
- **Milestone 3.3: Calendar Sync**: Public ICS feeds for parents and coaches.
- **Milestone 3.4: Registration & Compliance**: Custom form builder, waiver tracking, and boolean compliance dashboards.
- **Milestone 3.5: Reporting**: Game score entry, standings calculations, and tie-breaker logic.

---

## Execution Sequence (Remaining Epics)

| Sequence | Epic ID     | File                           | Description                                            |
| :------- | :---------- | :----------------------------- | :----------------------------------------------------- |
| 1        | **CORE-UI** | `11_EPIC_CORE_DOMAIN.md`       | Finish RBAC enforcement and strict Multi-Tenant RLS.   |
| 2        | **SCH-UI**  | `12_EPIC_SCHEDULING.md`        | Build Facility CRUD and manual conflict resolution UI. |
| 3        | **COMMS**   | `14_EPIC_COMMS.md`             | Notifications, RSVP, Chat, ICS Feeds.                  |
| 4        | **DATA**    | `15_EPIC_REGISTRATION_DATA.md` | Form Builder, User creation from intake.               |
| 5        | **RPT**     | `16_EPIC_REPORTING.md`         | Standings, Stats, Compliance Dashboards.               |
