# BUILDTWO vs. Main App: Final Gap Analysis

This document identifies the remaining UX and functional gaps between the `BUILDTWO` prototype and the main `frontend/` application. These features must be ported before the `BUILDTWO` directory is deleted.

## Spec Layout Matrix

| Feature Area | BUILDTWO Prototype Feature | Main App Status | Actionable Gap |
| :--- | :--- | :--- | :--- |
| **Field Management** | 'Copy from Season' modal | Missing | Port modal UI and `handleCopyFromSeason` logic to `FieldManagementPage.jsx`. |
| **Field Management** | Visual weekly grid display | Missing | Implement the interactive weekly schedule grid for each field. |
| **Practice Scheduling** | Inline 'Lock/Unlock' toggle | Missing | Add `locked` state to practice assignments and UI toggles in `PracticeSchedulingPage.jsx`. |
| **Data Import** | 'Constraints' tab (Division Sizing) | Missing | Port the 'Constraints' tab and `DEFAULT_DIVISIONS` logic into `ImportPage.jsx`. |
| **Account Management** | Dedicated 'Account' page | Basic `SettingsPage` | Enhance `SettingsPage.jsx` with the multi-tab layout (Profile, Security, Notifications) from `Account.tsx`. |

## Actionable Gaps (Remediation Plan)

### 1. Field Allocation Efficiency
- **Problem**: Adding fields manually for every new season is tedious.
- **Solution**: Port the `isCopyModalOpen` state and `handleCopyFromSeason` function. Create a `CopyFieldsModal` component.
- **Visuals**: Implement the `DAYS` grid rendering in the field cards to show allocated time slots at a glance.

### 2. Practice Scheduler Control
- **Problem**: Re-running the scheduler currently overwrites all assignments.
- **Solution**: Add a `locked` boolean to the `scheduler_runs` or assignment data. Add the `Lock`/`Unlock` icon button to the practice grid.

### 3. Data Ingestion Constraints
- **Problem**: Default roster sizes are hardcoded in the core engine, making them hard to adjust per-season.
- **Solution**: Port the `Constraints` tab into the `ImportPage` workflow, allowing admins to override `maxRoster` sizes before triggering team generation.

### 4. Account UX Overhaul
- **Problem**: `SettingsPage.jsx` is a single long form.
- **Solution**: Implement the tabbed sidebar navigation from BUILDTWO's `Account.tsx` to separate Profile, Security, and Notifications.

## Verification
Phase 2 will be considered complete when:
1. BDD tests for "Field Copy" and "Practice Locking" pass.
2. The `ImportPage` contains a working "Constraints" tab.
3. `SettingsPage` matches the BUILDTWO "Deep Space Glass" account UX.
