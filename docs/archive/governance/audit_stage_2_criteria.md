# Governance Framework: Audit Stage 2 (Database Performance & Optimization)

## 📌 Objective

Establish precise benchmarks for the **Stage 2 (The Core)** query and database optimization audit. The goal is to maximize performance handling for large-scale operations under the new Phase 5 Fluid Schema (JSONB) architecture.

## ✅ Pass/Fail Criteria

- **JSONB Query Scaling (PASS)**: The Supabase database must be equipped with GIN (Generalized Inverted Index) indices targeting `custom_attributes` to guarantee 100,000+ player lookups without triggering full-table scans.
- **Trigger Optimization (PASS)**: Custom PL/pgSQL triggers (e.g., `validate_custom_attributes`) must execute instantaneously during batch operations. They must be immune to intentional bypassing.
- **N+1 Prevention (PASS)**: Frontend-driven RPC and standard database calls must be guaranteed free of cascading N+1 query waterfall patterns.

## 🛠️ Code & Architectural Rules

1. **Index Driven**: All performance refactors must be based on proven PostgreSQL `EXPLAIN ANALYZE` reports queried via the Supabase MCP.
2. **Safe Migrations**: Restructuring indices or altering triggers must be executed via non-destructive SQL migrations ensuring zero data degradation.
3. **Latency Governance**: All tested read queries encompassing the JSONB custom schemas must safely duck beneath the previously outlined 200ms application limit.

## 📦 Required Deliverables

1. The execution of all necessary DB migration scripts applying optimized indices and hardened trigger logic.
2. A populated **`db_optimization_log.md`** detailing the before/after latency measurements and explicit execution plans proving the fixes.
