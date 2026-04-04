# Phase 3 Governance Framework: Smart Ingestion & Telemetry

**Role**: Lead Enterprise Architect & Governance Supervisor  
**Status**: ACTIVE  
**Scope**: Phase 3 (Dynamic Ingestion Pipeline)

---

## 1. Algorithm Transparency & Auditability
*The "Intelligence" of the system must be observable and accountable.*

### Pass/Fail Criteria
| Metric | Requirement | Pass Condition |
| :--- | :--- | :--- |
| **Logic Traceability** | Match Rationale | The `Smart Header Matcher` must return an object containing the `suggested_mapping` AND a `confidence_score` (0.0 - 1.0). |
| **Decision Logging** | Telemetry Write-Back | When a user accepts a "Smart Suggestion," a `telemetry_log` event (`import.suggestion_accepted`) must be emitted. |
| **Explanation UI** | Semantic Clarity | Hovering over a "Smart" badge in the UI must briefly explain *why* (e.g., "Matched based on GotSport Legacy profile"). |

---

## 2. Fallback Integrity (Circuit Breakers)
*Ensuring the system remains functional even if "Smart" signals are missing.*

### Non-Negotiable Guardrails
1. **Static Fallback**: If the `telemetry_log` is empty or the `telemetryUtils` parser fails, the system **MUST** default to the hardcoded `HEADER_ALIASES` within 50ms.
2. **Schema Sanitization**: Any dynamic aliases generated from telemetry must be sanitized against the `ImportSchema` (Zod) before being applied to the UI state.
3. **Graceful Degradation**: Toggling off the `SMART_INGESTION` feature flag must instantly revert the UI to the standard "Manual Mapping" mode without a page refresh.

---

## 3. Performance & Density
*Maintaining the "Premium" feel under high data loads.*

### Performance Targets
* **Mapping Latency**: Initial "Smart Match" calculation for a 50-column CSV must complete in **< 100ms**.
* **Memory Management**: Telemetry processing must happen in a `useMemo` hook or within the `ImportWorker` thread to prevent UI thread blocking.
* **Density Management**: "Smart" badges must be non-intrusive (e.g., a subtle 12px icon/dot) to avoid cluttering the already dense table headers.

---

## 4. Operational 'Go/No-Go' Protocol
As the Governance Supervisor, I will evaluate Phase 3 implementation against:
* [ ] **Black Box Risk?** (Is the matching logic opaque?)
* [ ] **Dependency Loop?** (Does the ImportPanel depend too heavily on Telemetry state?)
* [ ] **A11y Regression?** (Are the "Smart" indicators screen-reader accessible?)

---
> [!IMPORTANT]
> Any "Smart" logic that does not include a **Confidence Score** and a **Static Fallback** will be rejected.
