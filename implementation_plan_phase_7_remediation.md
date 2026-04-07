# Implementation Plan: Phase 7 Remediation & Certification

Remediate missing database components and accessibility gaps in the Phase 7 implementation to achieve a production-ready, certified state for Regional Performance & Real-time Analytics.

## Proposed Changes

### [Database]
#### [NEW] [20260406180000_phase_7_analytics_persistence.sql](file:///c:/Users/joel.abraham/Downloads/SquadLogic/supabase/migrations/20260406180000_phase_7_analytics_persistence.sql)
- **Table Definition**: Define `evaluation_runs` with:
    - `id` (UUID PRIMARY KEY).
    - `organization_id` (UUID REFERENCES organizations(id)).
    - `scheduler_run_type` (TEXT CHECK (scheduler_run_type IN ('practice', 'game', 'composite'))).
    - `status` (TEXT DEFAULT 'pending').
    - `metrics_summary` (JSONB): *Zod-governed schema (fairnessIndex, conflictCount, executionTimeMs, etc.)*.
    - `execution_time_ms` (INTEGER).
    - `created_at` (TIMESTAMPTZ DEFAULT NOW()).
- **Configurable Retention**:
    - Add `settings` column to `organizations` table (if missing) or use a dedicated `organization_settings` table.
    - Implement `retention_days` setting (default: 365).
- **Pruning Trigger**:
    - Implement a `prune_old_evaluation_runs()` function.
    - Attach a trigger to `evaluation_runs` or a cron job via `pg_cron` to delete records older than the organization's specific `retention_days`.
- **RPC Implementation**:
    - `persist_evaluation_run(p_org_id, p_type, p_metrics, p_duration)`:
        - Security: Checks `auth.uid()` membership in `p_org_id`.
        - Atomically inserts into `evaluation_runs`.

### [Frontend]
#### [MODIFY] [AnalyticalDashboard.jsx](file:///c:/Users/joel.abraham/Downloads/SquadLogic/frontend/src/pages/AnalyticalDashboard.jsx)
- **WCAG 2.2 AA Compliance**:
    - Add `aria-label` and `role="img"` to all iconography.
    - Add `title` and `desc` elements inside `<LineChart>` and `<AreaChart>` for screen reader context.
    - Add semantic `<caption>` to the evaluation history table.
    - Audit color contrast for text and chart series against "Enterprise Glass" backgrounds.
- **Data Hook**: Ensure `fetchHistory` handles zero-data states gracefully.

#### [MODIFY] [EvaluationPanel.jsx](file:///c:/Users/joel.abraham/Downloads/SquadLogic/frontend/src/components/EvaluationPanel.jsx)
- Apply similar accessibility and stability audits.

### [Governance]
#### [Certification]
- Achieve a **Zero-Warning** lint state across the monorepo (`npm run lint`).
- Validate the Edge Function integration in a mock environment using the `supabase-mcp-server`.

## Verified Requirements (User Feedback)
- [x] **Retention Policy**: Global default is **365 days** (not 90). Must be overrideable per organization/program.
- [x] **Schema Integrity**: Include the Zod schema definition within the SQL migration comments for documentation and future check-constraint hardening.

## Verification Plan

### Automated Tests
- **SQL**: Verify `persist_evaluation_run` prevents cross-org data insertion.
- **Retention**: Manually call the pruning function with a set of old test records and verify they are deleted based on the org-specific threshold.

### Manual Verification
- **Accessibility**: Use the browser tool to confirm screen reader visibility and keyboard focus order on the dashboard.
- **Integration**: Start a `dev` server and verify the `AnalyticalDashboard` correctly visualizes metrics from the Edge Function.
