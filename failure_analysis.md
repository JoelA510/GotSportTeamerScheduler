# E2E Test Failure Analysis Report

This report documents the 26 unexpected failures found in the recent E2E test run and provides my understanding of the root causes and proposed fixes.

## Summary Table

| Category | Count | Primary Impacted Features |
| :--- | :---: | :--- |
| **Locator Failures** | 12 | Facility Management, Team Portal, Engine, Standings |
| **Mock Data Issues** | 6 | Reporting, Roster Conflicts, Ingestion |
| **Timing & Navigation** | 4 | RBAC, General UI |
| **Glass Panel Interception** | 4 | Ingestion, General UI |

---

## Detailed Analysis

### 1. Facility Management Failures
*   **Symptoms**: "Save Changes", "Deactivate", and "Field Name" labels/buttons were not found.
*   **Root Cause**: The UI has likely diverged from the step definition expectations. For example, "Field Name" might be "Name" or inside a specific container that Playwright's `getByLabel` cannot resolve due to nested structures.
*   **Fix Strategy**: 
    - Audit `FieldManagement.jsx` and `LocationForm.jsx`.
    - Harmonize labels with [tests/e2e/steps/facility_management.ts](file:///c:/Users/joel.abraham/Downloads/SquadLogic/tests/e2e/steps/facility_management.ts).
    - Use more resilient locators (e.g., `data-testid`).

### 2. Mock Data Inconsistencies (Reporting & Roster Conflicts)
*   **Symptoms**: "Total Players" metric is 0; "Gender mismatch" and "Age mismatch" banners are missing.
*   **Root Cause**: 
    - The metric failure indicates that the `view_org_metrics` or `profiles`/`players` tables aren't populated correctly in [supabaseClient.js](file:///c:/Users/joel.abraham/Downloads/SquadLogic/frontend/src/lib/supabaseClient.js).
    - The conflict banners missing suggests either the logic in `useRosterConflicts.js` is failing or the mock data doesn't trigger the conflict conditions (e.g., mismatched IDs).
*   **Fix Strategy**:
    - Enhance `initialMockData` in [frontend/src/lib/supabaseClient.js](file:///c:/Users/joel.abraham/Downloads/SquadLogic/frontend/src/lib/supabaseClient.js) to include specific error-inducing records for conflict tests.
    - Ensure `view_org_metrics` logic in the mock client correctly aggregates player counts.

### 3. Glass Panel Pointer Interception
*   **Symptoms**: Failures in "Ingestion Hardening" where overlays are present. `toBeHidden` on `.glass-panel-premium` failed.
*   **Root Cause**: The premium "glass" effect uses pseudo-elements or absolute overlays that Playwright captures as visible, even if the user can interact. Conversely, they can trap clicks meant for buttons underneath.
*   **Fix Strategy**:
    - Add `z-index: 1` and `pointer-events: none` to the background glass effect.
    - Explicitly set `z-index: 10` and `relative` on the [Button](file:///c:/Users/joel.abraham/Downloads/SquadLogic/frontend/src/components/ui/Button.jsx#4-59) component to elevate it above the glass layer.

### 4. RBAC & Navigation Redirects
*   **Symptoms**: `page.waitForURL('**/')` timed out when attempting to access Admin routes as a Coach.
*   **Root Cause**: The `ProtectedRoute` or `usePermission` hook might be redirecting to a specific path like `/dashboard` instead of the root `/`, or the navigation is getting stuck in 404.
*   **Fix Strategy**:
    - Verify the redirection target in `frontend/src/components/auth/ProtectedRoute.jsx`.
    - Update [tests/e2e/steps/common_steps.ts](file:///c:/Users/joel.abraham/Downloads/SquadLogic/tests/e2e/steps/common_steps.ts) to wait for the specific expected redirect URL.

### 5. Automated Engine & Drafting
*   **Symptoms**: "Generate Teams" and "Quick Draft" buttons timed out.
*   **Root Cause**: These buttons are often dynamic. If the mock data suggests team generation is "already in progress" or "complete", the buttons might be disabled or hidden.
*   **Fix Strategy**:
    - Update the mock state in [supabaseClient.js](file:///c:/Users/joel.abraham/Downloads/SquadLogic/frontend/src/lib/supabaseClient.js) to ensure the `scheduler_runs` table is empty or in a "pending" state at the start of these tests.
    - Check `EngineDashboard.jsx` for button visibility logic.

## Recommended Next Steps for Instructions
1.  **Phase 1: UI Foundation**: Apply z-index fixes to [Button.jsx](file:///c:/Users/joel.abraham/Downloads/SquadLogic/frontend/src/components/ui/Button.jsx) and `GlassPanel.jsx`.
2.  **Phase 2: Data Integrity**: Revamp [supabaseClient.js](file:///c:/Users/joel.abraham/Downloads/SquadLogic/frontend/src/lib/supabaseClient.js) mock initialization.
3.  **Phase 3: Selector Hardening**: Add `data-testid` to critical headers and banners.
4.  **Phase 4: Step Definition Alignment**: Sync [facility_management.ts](file:///c:/Users/joel.abraham/Downloads/SquadLogic/tests/e2e/steps/facility_management.ts) and [coach_and_calendar.ts](file:///c:/Users/joel.abraham/Downloads/SquadLogic/tests/e2e/steps/coach_and_calendar.ts) with actual DOM labels.
