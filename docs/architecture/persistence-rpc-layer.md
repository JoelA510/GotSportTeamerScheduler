## [← Back to Documentation Index](../README.md)

# Persistence RPC Layer

> **Status**: Canonical reference for the RPC-based persistence model mandated by [`CLAUDE.md`](../../CLAUDE.md) §3 ("RPC Enforcement"). Grounded in the migrations under `supabase/migrations/` as of Wave 7a.

## 1. Purpose

All state-altering database operations in SquadLogic are mediated by PostgreSQL functions declared `SECURITY DEFINER` and granted to the `authenticated` role. The client (browser or Edge Function) never issues `INSERT`/`UPDATE`/`DELETE` directly against application tables. Three motivations sit behind this policy:

1. **RLS bypass prevention.** Row-Level Security is enforced on every table, but many mutations need to look across multiple organizations or tables before deciding what to write (e.g., deriving the form's real `organization_id` before letting a caller register a player). An RPC with `SECURITY DEFINER` runs with elevated privilege, but only after the function body itself has re-checked the caller's identity via `auth.uid()` and their organization membership via `is_org_member()` / `is_org_admin()`. A directly-issued client write would either need an overly permissive policy or couldn't complete at all.
2. **Atomic cross-table operations.** Creating a team roster writes to `scheduler_runs`, `teams`, and `team_players` in one unit of work. Registering a player writes to `players`, `profile_players`, and `registrations`. An RPC wraps those writes in a single transaction so partial failures roll back cleanly; a client-orchestrated sequence would leak half-written state on error.
3. **Audit immutability.** Every sensitive mutation emits an `audit_log` row through `record_audit_event()`. Routing writes through RPCs guarantees the audit trail exists even if the caller forgets to log; the RPC does it unconditionally.

This matches `CLAUDE.md` §3: _"Dedicated RPCs are mandatory for all state persistence; direct table upsert is discouraged for sensitive domain state."_ It is also the enforcement mechanism behind the strict RLS posture documented in [`security/rls-policies.md`](../security/rls-policies.md) — most write policies are deliberately absent, so writes physically cannot happen outside the RPC surface.

## 2. Inventory

Every RPC shipping in the current `supabase/migrations/**/*.sql` catalogue. Grouped by domain. The "declared in" column names the most recent migration file that defines (or re-defines) the function body.

### 2.1 Identity & Authorization Helpers

These are the foundation everything else leans on. They are `SECURITY DEFINER` with pinned `search_path = public` and are invoked inline from RLS policies as well as from RPC bodies.

| Function                                             | Declared in                                                                        | Purpose                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `public.is_org_member(org_id uuid) returns boolean`  | `20260331000000_definitive_schema.sql` (search_path pinned by `20260421002500`)    | Returns `true` if `auth.uid()` is in `organization_members` for `org_id`. Gate used by almost every RLS policy. |
| `public.is_org_admin(p_org_id uuid) returns boolean` | `20260404100000_phase_2_setup_wizard.sql` (search_path pinned by `20260421002500`) | Admin-only variant. Admits `role IN ('admin', 'tenant_admin')`.                                                 |
| `public.current_user_role()`                         | `20251208000000_consolidated_schema.sql`                                           | Legacy role probe used by early RLS drafts; superseded by `is_org_member`/`is_org_admin`.                       |

### 2.2 Tenant Onboarding

| Function                                                                                                      | Declared in                                        | Purpose                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `public.initialize_new_tenant(p_name text, p_slug text, p_timezone text, p_season_year integer) returns uuid` | `20260416000001_initialize_new_tenant.sql`         | Creates the `organizations` row, the `organization_members` admin row for `auth.uid()`, and an initial `season_settings` row. Emits a `settings.updated` audit event. Invoked by the self-serve onboarding wizard. |
| `public.finalize_onboarding(p_org_id uuid, p_flags jsonb) returns void`                                       | `20260404100000_phase_2_setup_wizard.sql`          | Writes feature flags, flips `organizations.is_onboarded = true`, and emits `organization.onboarded` audit. Admin-only via `is_org_admin`.                                                                          |
| `public.handle_new_user()` (trigger function on `auth.users`)                                                 | `20260421022121_auto_create_profile_on_signup.sql` | AFTER INSERT OR UPDATE trigger that upserts a `profiles` row for every new Supabase Auth user. Not called directly; runs automatically on signup.                                                                  |

### 2.3 Membership Invites

| Function                                                                                                                       | Declared in                             | Purpose                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.generate_invite_code() returns text`                                                                                   | `20260421034626_invite_code_system.sql` | Internal helper. Produces a Crockford-ish base32 `XXXX-XXXX` code.                                                                                                                       |
| `public.create_org_invite(p_org_id uuid, p_role text, p_expires_in interval) returns table(code text, expires_at timestamptz)` | `20260421034626_invite_code_system.sql` | Admin-only. Mints a single-use invite with preset role; retries on collision.                                                                                                            |
| `public.redeem_org_invite(p_code text) returns uuid`                                                                           | `20260421034626_invite_code_system.sql` | Any authenticated user. `FOR UPDATE` lock on the invite row guarantees single-use; emits a `members.invited_joined` audit event when available. Idempotent for already-existing members. |

### 2.4 Team / Practice / Game Persistence

Called by the `team-persistence`, `practice-persistence`, and `game-persistence` Edge Functions (see [`edge-functions-inventory.md`](./edge-functions-inventory.md)). The Edge Function authenticates and checks org scope before invoking the RPC; team persistence additionally requires org-admin membership because it mutates durable rosters. `persist_game_schedule` is `SECURITY DEFINER` with pinned `search_path` because `game_assignments` intentionally has no broad authenticated write policy; the function body performs its own org-membership, season, team, slot, and field checks before writing.

| Function                                                                                     | Declared in                                            | Purpose                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.persist_team_schedule(run_data jsonb, teams jsonb, team_players jsonb) returns uuid` | `20260503040000_repair_team_persistence_rpc.sql`       | Upserts the org-scoped `scheduler_runs` row, bulk-upserts validated `teams`, and replaces the submitted teams' `team_players` rows with the authoritative roster snapshot. Returns the scheduler run id and rejects non-admin callers plus cross-org season, division, team, coach, or player references. |
| `public.persist_practice_schedule(run_data jsonb, assignments jsonb) returns uuid`           | `20260503020000_link_practice_assignments_to_runs.sql` | Upserts the org-scoped `scheduler_runs` row and bulk-upserts validated `practice_assignments` (keyed by `team_id`, `practice_slot_id`, `effective_date_range`) while linking each current assignment row to the persisted scheduler run via `run_id`. Returns the scheduler run id.                       |
| `public.persist_game_schedule(run_data jsonb, assignments jsonb) returns uuid`               | `20260503030000_repair_game_persistence_rpc.sql`       | Upserts the org-scoped `scheduler_runs` row and bulk-upserts validated `game_assignments` (keyed by `home_team_id`, `away_team_id`, `game_slot_id`, `week_index`) while linking each current assignment row to the persisted scheduler run via `run_id`. Returns the scheduler run id.                    |

### 2.5 Registration

| Function                                                                                                                                                                                                              | Declared in                                                                                             | Purpose                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.submit_registration(p_organization_id uuid, p_form_id uuid, p_profile_id uuid, p_responses jsonb, p_player_id uuid default null, p_first_name text default null, p_last_name text default null) returns uuid` | `20260421051109_add_registration_forms_division.sql` (supersedes `20260310000003` and `20260324000003`) | Derives the authoritative `organization_id` and `division_id` from the form (does _not_ trust client input), enforces `is_org_member`, allows admins to submit on behalf of others, creates a `players` row if needed, links `profile_players`, and writes the `registrations` row. Emits a `registration.submitted` audit event. |

### 2.6 Calendar Feed Tokens

| Function                                                    | Declared in                                | Purpose                                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.rotate_calendar_token(p_team_id uuid) returns json` | `20260324000002_calendar_token_expiry.sql` | Generates a fresh `calendar_token` UUID on `teams`, resets `calendar_token_expires_at` to `now() + 90 days`, emits a `calendar.token_rotated` audit event. Invoked from the Team Portal UI. |

### 2.7 Governance, Telemetry & Audit

| Function                                                                                                                                                                                                                  | Declared in                                                           | Purpose                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `public.record_audit_event(p_organization_id uuid, p_action text, p_resource_type text default null, p_resource_id uuid default null, p_metadata jsonb default '{}'::jsonb, p_ip_address inet default null) returns uuid` | `20260331000000_definitive_schema.sql` (superseding `20260324000004`) | The single write path into `audit_log`. `audit_log` has no INSERT policy, so direct writes are physically blocked.                  |
| `public.log_telemetry_event(p_org_id uuid, p_event_name text, p_payload jsonb default '{}'::jsonb) returns uuid`                                                                                                          | `20260404110000_telemetry_rpc.sql`                                    | Writes to `telemetry_log` under the caller's org, validated via `is_org_member`.                                                    |
| `public.update_org_feature_flags(p_org_id uuid, p_flags jsonb) returns void`                                                                                                                                              | `20260403000000_settings_audit_rpc.sql` (supersedes `20260402150700`) | Admin-only. Replaces `organizations.feature_flags`, short-circuits on no-op, emits `feature_flags.updated` audit with old/new diff. |
| `public.get_settings_audit_log(p_organization_id uuid) returns table(...)`                                                                                                                                                | `20260403000000_settings_audit_rpc.sql`                               | Admin-only read-side RPC that joins `audit_log` with `profiles` for a UI-ready settings history feed.                               |

### 2.8 Analytics Persistence

| Function                                                                                                                                  | Declared in                                                           | Purpose                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.persist_evaluation_run(p_org_id uuid, p_type text, p_metrics jsonb, p_duration integer) returns uuid`                             | `20260406180000_phase_7_analytics_persistence.sql`                    | Four-arg overload. Membership-gated; writes a single `evaluation_runs` row.                                                                                                                                           |
| `public.persist_evaluation_run(p_run_data jsonb, p_findings jsonb default '[]'::jsonb, p_metrics jsonb default '[]'::jsonb) returns uuid` | `20260407000000_persist_evaluation_run_overload.sql`                  | Three-arg overload used by the `fairness-scoring` and `auto-scheduler` Edge Functions. Atomically inserts `evaluation_runs`, then fan-outs into `evaluation_findings` and `evaluation_metrics` from the JSONB arrays. |
| `public.prune_old_evaluation_runs() returns void`                                                                                         | `20260408100000_retention_180_days.sql` (supersedes `20260406180000`) | Retention sweep — per-org delete of `evaluation_runs` older than `organizations.settings.retention_days` (default 180). Invoked by the `pg_cron` schedule created in `20260416000002_data_retention_cron.sql`.        |
| `public.prune_old_audit_logs() returns void`                                                                                              | `20260409000000_audit_log_retention_180.sql`                          | Symmetric retention sweep for `audit_log` at 180 days. `pg_cron`-invoked.                                                                                                                                             |

### 2.9 Coach Leads

| Function                                                                                                      | Declared in                                                                                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.upsert_coach_leads(p_leads jsonb) returns jsonb`                                                      | `20260421060000_coach_leads.sql`, hardened by `20260503000000_secure_coach_lead_scoping.sql` | Set-based upsert of "interested-coach" lead rows inferred from player imports. Per-org `is_org_member` pre-check in a tight loop; the main CTE pipeline runs as one statement. Returns counts of leads created, programs linked, and existing rows skipped. Cross-tenant linkage is prevented by scoping the coach lookup, division id, and player id to the same `organization_id`; the junction table also has a trigger-level org-scope guard. |
| `public.set_import_job_coach_lead_summary(p_import_job_id uuid, p_summary jsonb, p_status text) returns void` | `20260503000000_secure_coach_lead_scoping.sql`                                               | Atomically merges player-import coach lead capture results into `import_jobs.warning_summary.coach_leads` with `jsonb_set`, optionally updating the import job status after verifying caller membership in the job organization.                                                                                                                                                                                                                  |

### 2.10 Coach Administration

| Function                                                                                          | Declared in                                      | Purpose                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.admin_update_coach_status(p_organization_id uuid, p_coach_id uuid, p_status text)`        | `20260503050000_coach_admin_mutations.sql`       | Admin-only coach lifecycle mutation used by `/coaches` to promote interested leads and update active/pending/inactive statuses. Verifies `is_org_admin`, rejects cross-org coach references, prevents assigned coaches from being marked inactive/interested, and writes audit rows. |
| `public.admin_assign_team_coach(p_organization_id uuid, p_team_id uuid, p_coach_id uuid default null)` | `20260503050000_coach_admin_mutations.sql`       | Admin-only team head-coach assignment mutation used by `/coaches`. Verifies the team and coach belong to the requested org, rejects inactive/interested coach assignment, enforces single-team coach capacity, supports unassigning with `NULL`, and writes assignment/swap audit rows. |

### 2.11 Schema Evolution & Custom Attributes

These are trigger functions rather than caller-invokable RPCs, but they run inside the same `SECURITY DEFINER` envelope and are part of the RPC layer's attack surface.

| Function                                                                             | Declared in                                                                                                                   | Purpose                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.get_reserved_keys() returns text[]`                                          | `20260405120000_phase_5_fluid_schemas.sql`                                                                                    | Immutable list of reserved attribute keys (blocks shadowing of system columns).                                                                                  |
| `public.validate_custom_attributes() returns trigger`                                | `20260405120000_phase_5_fluid_schemas.sql`                                                                                    | BEFORE INSERT/UPDATE trigger on `players`, `coaches`, `teams`. Enforces the per-org schema stored in `organization_schemas` and rejects writes to reserved keys. |
| `public.log_schema_change() returns trigger`                                         | `20260405120000_phase_5_fluid_schemas.sql`                                                                                    | AFTER UPDATE trigger on `organization_schemas`; appends to `organization_schema_history`.                                                                        |
| `public.handle_field_subunits() returns trigger`                                     | `20251216000000_facility_multi_tenancy.sql`                                                                                   | Facility hierarchy propagation trigger.                                                                                                                          |
| `propagate_org_id_from_*()` (9 trigger functions)                                    | `20260324000000_phase1_rls_unification.sql`                                                                                   | Trigger functions that back-fill `organization_id` on child rows from their parent (field → field_subunits, team → team_players, etc.).                          |
| `public.check_password_length_on_auth_users()`                                       | `20240405180000_password_hardening.sql`                                                                                       | BEFORE INSERT/UPDATE trigger on `auth.users` enforcing minimum password length.                                                                                  |
| `public.set_updated_at()`, `trigger_set_timestamp()`, `set_created_by_to_auth_uid()` | `20251217000000_communication_schema.sql`, `20251208000000_consolidated_schema.sql`, `20251208000000_consolidated_schema.sql` | Generic row-stamping triggers reused across tables.                                                                                                              |

## 3. Contract Pattern

Every RPC in the inventory above follows the same template. When adding a new RPC, replicate this structure exactly:

```sql
CREATE OR REPLACE FUNCTION public.my_new_rpc(
    p_org_id   uuid,
    p_payload  jsonb
)
RETURNS jsonb                    -- prefer jsonb or the id of the created row
LANGUAGE plpgsql
SECURITY DEFINER                 -- elevated, BUT we re-check auth in the body
SET search_path = public         -- MANDATORY. See §4 below.
AS $$
DECLARE
    v_result jsonb;
BEGIN
    -- 1. Input validation. Raise EXCEPTION with a clear message.
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'p_org_id is required';
    END IF;

    -- 2. Authz. Gate the whole function on org membership before ANY mutation.
    --    Use is_org_admin() for admin-only mutations.
    IF NOT public.is_org_member(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: user is not a member of organization %', p_org_id
          USING ERRCODE = '42501';
    END IF;

    -- 3. Do the work. Multi-table writes run inside this implicit transaction.
    --    INSERT / UPDATE / DELETE as needed.

    -- 4. Audit. Emit exactly one audit_log row per logical action.
    PERFORM public.record_audit_event(
        p_org_id,
        'domain.action',        -- must match the audit_log action CHECK constraint
        'resource_type',
        v_resource_id,
        jsonb_build_object('key', 'value')
    );

    -- 5. Return a useful value (the new row's id, a counts summary, etc.).
    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_new_rpc(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.my_new_rpc(uuid, jsonb) IS
  'One-line description that ends up in pg_proc.prodescription.';
```

Notes on the pattern:

- **`auth.uid()` is always available inside a `SECURITY DEFINER` function** in Supabase. Never pass the caller's user id as a parameter; clients can forge it. Derive it from `auth.uid()` instead.
- **Derive authority from the server, not the client.** `submit_registration` is the canonical example: the caller passes `p_organization_id`, but the RPC reads the real org off the `registration_forms` row and aborts on mismatch. Apply the same posture to any RPC where the client references a resource that pins it to an org.
- **One RPC per logical action.** Prefer narrow, purpose-built RPCs over wide "swiss army" ones — narrow RPCs are cheaper to pgTAP-cover and easier to reason about.
- **Return JSONB when the caller needs structured feedback** (e.g., `{leads_created, programs_linked, skipped_existing}`); return the `uuid` of the primary row for simple create operations.
- **Audit actions must match the `audit_log_action_check` constraint.** If a new action name is needed, the migration that introduces the RPC must also drop-and-recreate the constraint to include it (see `20260407000000` and `20260403000000` for examples).
- **Never `RAISE` inside an `EXCEPTION WHEN` block unless you intend to preserve the transaction rollback** — wrapping a user-facing error with `RAISE EXCEPTION` inside an exception handler is the supported pattern (see `submit_registration`'s `unique_violation` handler).

## 4. Adding a New RPC — Checklist

When you need to add a new state-altering RPC, every item below must be satisfied before the PR lands. The advisor-lint script (`scripts/advisor-lint.js`) enforces items 2 and 3 statically.

1. **Migration file.** Create one under `supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`. Never edit an existing migration.
2. **`SET search_path = public` pinned at function definition.** `SECURITY DEFINER` functions inherit the caller's `search_path` by default; an attacker can redirect operations against shadowed objects. Every RPC in the current inventory has this pinned — see `20260421001209_lock_search_path_on_definer_functions.sql` for the backfill pattern if you forget.
3. **`SECURITY DEFINER` justified.** Prefer `SECURITY INVOKER` when the caller could do the work under their own RLS context. Use `SECURITY DEFINER` only when the function needs to look across tables the caller doesn't have direct RLS on (e.g., reading `organization_members`, checking a form's real `organization_id`).
4. **`is_org_member()` / `is_org_admin()` gate.** Called _before_ any mutation. Exceptions must carry `ERRCODE = '42501'` so the Supabase client surfaces a structured `403` rather than a generic error.
5. **Audit event.** One `record_audit_event()` call per logical action. If introducing a new action name, extend the CHECK constraint in the same migration.
6. **`GRANT EXECUTE ... TO authenticated`.** Supabase's PostgREST layer will refuse to expose the function otherwise.
7. **pgTAP test.** Add a test file under `supabase/tests/rls_<feature>.sql` that asserts (a) cross-org callers are rejected, (b) unauthenticated callers are rejected, (c) the happy path writes the expected rows, (d) the audit row is present. Run via `npm run test:db` locally.
8. **Advisor-lint pass.** `npm run check:advisors` must pass; the lint script checks for `SECURITY DEFINER` without pinned `search_path` and flags RPCs missing `is_org_member` gates.
9. **Revert + smoke SQL.** Drop a revert script under `docs/sql/reverts/<timestamp>_revert.sql` and a smoke script under `docs/sql/tests/<timestamp>_smoke.sql`. See the Wave 6a migrations for examples.
10. **Document it here.** Append a row to the relevant §2 subsection above. Cross-link from [`edge-functions-inventory.md`](./edge-functions-inventory.md) if an Edge Function calls the new RPC.

## 5. Known Gaps

v1.1-deferred items surfaced while writing this inventory. None block v1.0 production but should be tracked for later hardening.

- **pgTAP coverage is seeded but thin.** `supabase/tests/` ships four pgTAP suites today (`rls_admin_vs_coach`, `rls_anonymous_gate`, `rls_cross_org_isolation`, `rls_service_role_bypass`). The RPC bodies themselves (e.g., `submit_registration`'s cross-org rejection path, `redeem_org_invite`'s single-use lock) are _not_ individually covered. Wave 7b or later should add per-RPC suites; see [`testing/e2e_master_plan.md`](../testing/e2e_master_plan.md).
- **Two `persist_evaluation_run` overloads.** The four-arg variant predates Phase 8 and is no longer called by any Edge Function. It remains installed because dropping an overload requires a targeted `DROP FUNCTION` migration. Safe to remove in v1.1.
- **`current_user_role()` is legacy.** Defined in `20251208000000_consolidated_schema.sql` but superseded by `is_org_member` / `is_org_admin`. Not referenced by any current RLS policy or RPC. Can be dropped in v1.1.
- **check_password_length_on_auth_users targets the auth schema.** It is SECURITY DEFINER and was pinned to `public` by 20260421001209, but it operates on `auth.users`; low-risk since the trigger body does no schema-sensitive lookups, but worth noting for a future audit.
- **`record_audit_event` audit-action CHECK lag.** When a new `action` string is introduced, the CHECK constraint must be dropped and recreated in the same migration. Several migrations do this ad-hoc (`20260403000000`, `20260407000000`, `20260404100000`). A consolidated migration that sources the set from a single table would be cleaner; defer to v1.1.
