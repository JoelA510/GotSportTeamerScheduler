[← Back to Documentation Index](docs/README.md)
---

# Phase 5 Governance Framework: Dynamic Data Schemas & Enterprise Mapping

**Role**: Lead Enterprise Architect & Governance Supervisor  
**Status**: DRAFT (Pending Baseline Implementation)  
**Scope**: Phase 5 (Custom Attributes, JSONB Validation, & Schema Evolution)

---

## 1. Core Immortality (Field Protection)

_System-critical fields must be immutable and protected from collision with user-defined attributes._

### Pass/Fail Criteria

- **RESERVED_KEYS Enforcement**: The schema engine MUST maintain a strictly enforced `RESERVED_KEYS` constant (including `id`, `created_at`, `org_id`, `email`, `first_name`, `last_name`, `phone`, `status`).
- **Shadowing Prevention**: Any attempt to map a CSV header to a custom attribute that matches a `RESERVED_KEY` (case-insensitive) MUST be caught at the mapping stage and rejected with a `403 Forbidden: System Field Collision`.
- **Namespace Isolation**: Custom attributes MUST be stored in a flat `custom_attributes` JSONB column. Deep nesting is prohibited for performance reasons.

---

## 2. Validation Efficiency (The 15ms Gate)

_Dynamic schema validation must not degrade ingestion throughput._

### Optimization Standards

- **Trigger Performance**: The PostgreSQL trigger (or Edge Function) performing JSONB validation against the `organization_schemas` MUST complete in **<15ms** per row.
- **Schema Caching**: The validation engine MUST use a localized JSON schema cache to avoid redundant lookups to the `organization_schemas` table during a bulk batch.
- **O(1) Lookups**: Field type validation (e.g., `date`, `numeric`, `enum`) must be implemented as direct lookups, not regex-heavy loops.

---

## 3. Enterprise Auditability & Evolution

_Changes to data structure must be traceable for compliance and recovery._

### Architectural Requirements

- **`organization_schema_history` Table**: A mandatory table to track every change to an organization's dynamic schema.
  - Columns: `id`, `org_id`, `changed_by`, `old_schema`, `new_schema`, `change_reason`, `created_at`.
- **State Recovery**: The system must be able to "Replay" an import using a historical schema version if a data-integrity issue is discovered post-ingest.

---

## 4. Circuit Breaker v2 (Matching Latency)

_Dynamic field overhead must not break the real-time UX._

### Matching Gate Constraints

- **Match Time Baseline**: The `matchHeaders` logic from `telemetryUtils.js` must incorporate dynamic custom-field lookups without exceeding the **50ms** hard limit.
- **Lazy Loading**: Custom fields for the organization should be loaded into `ImportContext` once per session, not per `matchHeaders` call.
- **Matching Bias**: If a header matches both a `RESERVED_KEY` and a `custom_attribute`, the `RESERVED_KEY` MUST take precedence (Priority 1.0).

---

## 5. Visual Governance (Dynamic Mapping UI)

_The mapping UI must handle N-number of custom fields without layout shift._

### UI/UX Rules

- **The "Glass" Standard**: Custom field rows in the `IngestionOverlay` must use the same glassmorphic aesthetics as system fields but be visually distinct (e.g., subtle indigo accent `border-indigo-500/20`).
- **Validation Feedback**: Invalid custom data must highlight the specific JSON path in the error report.

---

> [!CAUTION]
> **GO/NO-GO CRITICAL**: Any implementation that allows `JSONB_SET` operations without schema validation or audit logging will be issued an immediate **NO-GO**.
