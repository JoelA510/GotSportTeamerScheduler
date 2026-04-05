# SquadLogic: Enterprise UI/UX & Modularity Master Plan

### Phase 1: Architectural Foundation (Modularity, State, & Security)

Before changing the UI, the underlying systems must be refactored to support conditional processing safely and accountably.

- **1.1 Database Extension & Audit-Logged RPC:**
  - **Target:** `supabase/migrations/`
  - **Action:** Add a `feature_flags` JSONB column to the `organizations` table.
  - **Security Hardening:** Create a specific Supabase RPC (`update_org_feature_flags`) to allow authenticated tenant admins to safely toggle settings without opening standard `UPDATE` permissions. Inside the RPC transaction, mandate logging of changes (user, previous state, new state) into an `audit_log` table for guaranteed traceability.
- **1.2 Pipeline Refactor & "Ghost Roster" Simulations:**
  - **Target:** `packages/core/src/teamGeneration.js` and `packages/core/src/gameScheduling.js`.
  - **Action:** Break down monolithic functions into isolated pipeline classes: `SkillEvaluator`, `BuddyClusterer`, `CoachOverlapValidator`.
  - **Improvement (Ghost Rosters):** Spec the pipeline to accept a `dryRun: true` parameter. This bypasses database inserts, returning serialized JSON to the browser memory so admins can test teaming configurations risk-free.
  - **Improvement (PIM Guardrails):** Implement **Physically Impossible Move (PIM)** logic within the evaluators. To ensure drag-and-drop UI performance, do NOT use live routing APIs; rely on a pre-calculated **Travel Time Matrix** (or simple lat/long bounding) between the organization's registered venues.
- **1.3 Context & Guards:**
  - **Target:** `frontend/src/contexts/OrganizationContext.jsx` and `frontend/src/components/ui/FeatureGuard.jsx`.
  - **Action:** Fetch `feature_flags` on login. Build a standard wrapper component for conditional rendering of UI elements based on active flags.
- **1.4 Phase 1 Testing Requirements:**
  - **Unit:** `tests/unit/evaluators.test.js` to verify isolated logic for new Evaluator classes.
  - **Security:** pgTAP or Supabase test scripts to verify the RPC enforces RLS and prevents cross-tenant flag manipulation.

### Phase 2: The "Smart Ingestion" Onboarding Flow

Replace the static import process with a dynamic, high-performance, and "fuzzy" wizard.

- **2.1 The Configuration Wizard:**
  - **Target:** `frontend/src/components/onboarding/SetupWizard.jsx`
  - **Action:** Build a setup flow prompting admins to toggle their complexities (Skill Evals, Strict Coach Overlaps) before data import.
- **2.2 Dynamic Schema Generation & "Fuzzy" Worker:**
  - **Target:** `packages/core/src/schemas/index.js` and `frontend/src/workers/importWorker.js`.
  - **Action:** Convert static schemas to accept `feature_flags`. Offload CSV parsing to a Web Worker to prevent UI freezing.
  - **Improvement (Fuzzy Mapping):** Implement Levenshtein-based fuzzy matching in the worker to automatically map non-standard GotSport headers (e.g., `F_Name` → `first_name`).
- **2.3 Virtualized Inline Resolution & Delta Syncing:**
  - **Target:** `frontend/src/pages/ImportPage.jsx` and `DiffDashboard.jsx` [NEW].
  - **Action:** Implement DOM virtualization (`@tanstack/react-virtual`) for the inline error-resolution table to handle massive 2,000+ row exports.
  - **Improvement (Delta Sync):** The Web worker compares incoming CSV against the current Supabase state via Name + DOB hashing (Identity Resolution). Present a "Diff Dashboard" (New Additions, Modifications, Missing) to prevent mid-season overwrites.
  - **Improvement (Buddy History):** Automatically suggest "Historical Buddy Pairs" based on previous seasons to reduce manual entry.
- **2.4 Phase 2 Testing Requirements:**
  - **E2E:** Create `tests/e2e/features/onboarding_wizard.feature` to test the setup-to-import critical path.

### Phase 3: "Deep Space" System Maturation & Dashboards

Refine visuals for density while hard-enforcing accessibility standards.

- **3.1 Design System Polish & CI-A11y:**
  - **Target:** `frontend/src/index.css` and `ThemeToggle.jsx`.
  - **Action:** Dial back heavy glass effects for crisp `--focus-ring` variables.
  - **Accessibility:** Integrate `@axe-core/playwright` into the CI pipeline to treat WCAG contrast ratio regressions as build-breaking errors.
- **3.2 Top-Down Dashboards:**
  - **Target:** `frontend/src/pages/DashboardPage.jsx` and `SummaryGrid.jsx`.
  - **Action:** Surface key metrics (roster readiness, schedule conflict counts, compliance states) via Recharts sparklines.
- **3.3 Progressive Disclosure Facility Management:**
  - **Target:** `frontend/src/pages/FieldManagementPage.jsx`.
  - **Action:** Implement a Split-Pane architecture. Venue list remains anchored on the left; sub-unit/blackout configurations open in a stateful slide-out drawer on the right.

### Phase 3.5: Support Tooling & Troubleshooting

- **3.5 "View-As" Contextual Impersonation:**
  - **Target:** `frontend/src/components/admin/UserImpersonator.jsx` [NEW].
  - **Action:** Build a read-only impersonation feature using temporary scoped JWTs. Allows Master Admins to view the UI exactly as a specific Coach or Parent sees it to troubleshoot RBAC/multi-tenancy complaints instantly.

### Phase 4: The Visual Command Center (Highest Impact)

Transform the core scheduling workflow into an interactive 2D canvas with semantic density management.

- **4.1 Spatial Canvas, Minimap, & Semantic Grouping:**
  - **Target:** `frontend/src/components/scheduling/GameScheduleGrid.jsx` and `ScheduleMinimap.jsx` [NEW].
  - **Action:** Implement 2D canvas wrapped in strict `React.memo` for render optimization. Implement collapsible Y-axis groupings by Venue location.
  - **UX Enhancement:** Add a VS Code-style minimap with a "Conflict Radar" that pulses red for off-screen overlap errors. Clicking the minimap uses `scrollIntoView`.
- **4.2 Tactile Interactions & Local-First Sync Queue:**
  - **Target:** `GameCard.jsx`, `TimeSlotDropZone.jsx`, and `frontend/src/lib/syncQueue.js` [NEW].
  - **Action:** Utilize `@dnd-kit/core` with **Predictive Ghosting** (projecting a semi-transparent shadow with real-time green/red borders during hover).
  - **Robustness Upgrade:** Wrap DnD mutations in an IndexedDB-backed local queue. If cell service drops on the sideline, the app stacks mutations locally and flushes them to Supabase automatically when the connection is restored.
  - **Conflict Resolution:** Implement a "Server-Side Ground Truth" model. If Admin A (offline) and Admin B (online) place games in the same slot, the server wins. Admin A's conflicting game is automatically dumped to the "Parking Lot" upon reconnection, and they receive a push notification explaining the sync conflict.
- **4.3 Conflict Detection, Quick-Fix, & Presence:**
  - **Target:** `hooks/useConflicts.js` and `GameScheduleGrid.jsx`.
  - **Action:** **Intelligent Quick-Fix:** Right-clicking a conflicted `GameCard` calculates and suggests the top 3 valid alternative slots.
  - **Action:** **Real-Time Presence:** Integrate Supabase Realtime to "Lock" game cards visually when another admin is currently dragging them, preventing coordination collisions.
  - **Action:** **Fairness Heatmaps:** Add a toggleable overlay that visualizes scheduling equity (e.g., travel distances) across the grid.
- **4.4 Workflow Completion: Snapshots & Blast Notifications:**
  - **Target:** `frontend/src/components/scheduling/BlastAlertModal.jsx` [NEW].
  - **Action:** **Mandatory Pre-Flight Snapshot:** Auto-save schedule state as a JSON payload in a history table before mass commits, providing a 1-click "Undo All".
  - **Action:** **Targeted Blasts:** Identify only the specific teams impacted by the canvas changes and trigger routed SMS/Email alerts.
  - **Action:** **Bulk Rainout Lasso:** Allow admins to highlight a block of fields, instantly clearing the games into a side-panel "Parking Lot" queue for later rescheduling.
- **4.5 Phase 4 Testing Requirements:**
  - **E2E:** Complete rewrite of `admin_overrides.feature` for spatial DnD and verify `Undo/Redo` state management.

### Phase 5: Post-Season Analytics & Retention

Close the operational loop with data-driven league health assessments.

- **5.1 Season Health Retrospectives:**
  - **Target:** `frontend/src/pages/AnalyticsPage.jsx` [NEW].
  - **Action:** Build a "Post-Season Health Report" identifying pain points (high rainout fields, divisions with excessive travel burdens).
- **5.2 Retention Predictor:**
  - **Action:** Visualize expected player return rates based on historical parity vs. results, allowing admins to proactively address unbalanced divisions.

### Phase 6: "Sideline Triage" (Mobile & Disaster Realities)

The Command Center must gracefully degrade to survive field-level chaos on a smartphone.

- **6.1 PWA (Progressive Web App) & True Offline Shell:**
  - **Target:** `vite.config.js` and `frontend/public/manifest.json`.
  - **Action:** Implement `vite-plugin-pwa` to aggressively cache the app shell and scheduling schemas.
  - **Version Skew Protection:** Implement a **Mandatory Version Check** on online boot. If the active PWA schema version does not match the server, force a service-worker update _before_ the Sync Queue is allowed to flush, preventing data corruption.
- **6.2 "Game Day" Mobile Context (Responsive Triage):**
  - **Target:** `frontend/src/pages/GameDayMobile.jsx` [NEW].
  - **Action:** Detect mobile viewports. Strip away the 2D canvas and present a chronological, Tinder-style list of _today’s_ games only. Implement massive, high-contrast swipe actions (e.g., Swipe Left to Rainout, Swipe Right to Delay 15 Mins).
- **6.3 Mid-Season Team Triage (The Holding Pattern & Dispersal):**
  - **Target:** `frontend/src/components/teaming/TeamTriageModal.jsx` [NEW].
  - **Action (Interim Coach):** Allow admins to remove a coach without destroying the team by assigning an "Interim/TBD" status. This preserves schedule slots and re-routes automated comms to a designated parent volunteer.
  - **Action (Dispersal Wizard):** If a team must fold, provide a "Dispersal Engine." It links directly to the **Phase 1.2 Evaluators** (e.g., `SkillEvaluator`). It analyzes open roster spots on remaining teams and intelligently suggests player reallocations that actively maintain divisional parity (e.g., moving a high-skill player to a team needing an anchor) before forcing the admin to resort to opponent "Bye" weeks.
