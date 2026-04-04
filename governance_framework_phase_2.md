# Phase 2 Governance Framework: Smart Ingestion & Modularity

**Role**: Lead Enterprise Architect & Governance Supervisor  
**Status**: ACTIVE  
**Scope**: Phase 2 (Smart Ingestion Onboarding)

---

## 1. Decomposition: SettingsPage & SetupWizard
*Ensuring the transition from monolithic UI to a modular, scalable architecture.*

### Pass/Fail Criteria
| Metric | Requirement | Pass Condition |
| :--- | :--- | :--- |
| **Separated Complexity** | Tab-level isolation | `SettingsPage.jsx` must not exceed 100 lines. Logic for "General", "FeatureFlags", and "AuditLog" must reside in dedicated sub-components. |
| **Interface Purity** | Prop Interface | Components must receive only the slice of state they require. No passing the entire `org` object if only `feature_flags` are needed. |
| **Render Optimization** | Memoization & Lazy Loading | Heavy logic (e.g., `AuditLogTable`) must be lazy-loaded using `React.lazy` and wrapped in `ErrorBoundary`. |
| **State Locality** | Wizard State Management | `SetupWizard` must maintain local draft state until the final "Commit" to minimize redundant RPC calls. |

---

## 2. Security: Persistence & Guardrails
*Hard-enforcing the 'Constitutional' security standards established in Phase 1.*

### Non-Negotiable Guardrails
1. **RPC Enforcement**: All feature flag updates originating from the `SetupWizard` or `SettingsPage` **MUST** go through the `update_org_feature_flags` RPC. Direct `supabase.from('organizations').update()` is a critical failure.
2. **Schema Rigidity**: Every update must be validated against the `FeatureFlagSchema` (Zod) on the client **before** transmission. The RPC must ideally re-validate (check Supabase constraint/trigger status).
3. **Session Integrity**: The `SetupWizard` must verify the user's `role === 'tenant_admin'` via the `OrganizationContext` before mounting.
4. **Audit Immutability**: Ensure every Wizard 'Step' completion that modifies state is captured in the `audit_log` with `previous_state` and `new_state` JSON blobs.

---

## 3. Telemetry: Fuzzy Match Accuracy
*Quantifying the 'Intelligence' of the Smart Ingestion engine.*

### Accuracy Tracking Requirements
* The `importWorker.js` must emit a `telemetry_payload` for every import session containing:
    * **Matching Confidence**: Average Levenshtein score across all auto-mapped headers.
    * **User Correction Rate**: Ratio of `Auto-Mapped-Headers` vs `User-Corrected-Headers`. (Target: < 15% correction rate).
    * **Performance Latency**: Total time spent in the Fuzzy Matching loop (Target: < 200ms for 50 columns).
    * **Ambiguity Flagging**: If a header matches two fields with equal scores, it must be flagged as `HIGH_AMBIGUITY` in telemetry.

---

## 4. Operational 'Go/No-Go' Protocol
As the Governance Supervisor, I will evaluate all Coding Agent output against these checkpoints:
* [ ] **Audit Breach?** (Any bypass of the RPC?)
* [ ] **Fragility Check?** (Does the change increase `SettingsPage` complexity?)
* [ ] **Accessibility Drift?** (Does the Wizard support keyboard navigation and screen readers?)
* [ ] **Type Leakage?** (Are we using `any` in the import worker?)

---
> [!IMPORTANT]
> Any implementation that violates the **RPC-only persistence** rule will receive an immediate **NO-GO** recommendation.
