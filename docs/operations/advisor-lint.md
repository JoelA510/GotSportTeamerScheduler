[← Back to Documentation Index](../README.md)
---

# Advisor Lint — Static Migration Security Gate

> Wave 6a Task 2 (Audit F-2-01..F-2-03 regression-prevention): static SQL grep
> over `supabase/migrations/**.sql` + `.env.*.example` files. Catches the
> Wave 2 fix patterns that Supabase's live `get_advisors` MCP only sees
> post-deploy. Source: [`scripts/advisor-lint.js`](../../scripts/advisor-lint.js).

## What it catches

| Rule | Pattern | Why |
| --- | --- | --- |
| 1 | `SECURITY DEFINER` function without `SET search_path` (in body OR fixed by a later `ALTER FUNCTION ... SET search_path`) | Search-path injection vector (audit F-2-03). |
| 2 | `CREATE [OR REPLACE] VIEW` in an RLS-sensitive migration without `security_invoker = on` (or fixed by a later `ALTER VIEW`) | Cross-org RLS bypass (audit F-2-01). |
| 3 | `CREATE TABLE` not paired with `ENABLE ROW LEVEL SECURITY` in any migration | Open-table risk. |
| 4 | Policy with `USING (true)` or `WITH CHECK (true)` | Over-permissive grant. |
| 5 | `.env.*.example` keys matching `VITE_*SECRET*`, `VITE_*PRIVATE*`, `VITE_*TOKEN*`, `VITE_*KEY*`, `VITE_*PASSWORD*` (excluding the documented allow-list) | Secret-shaped Vite key would be inlined into the client bundle. |

## Cross-migration awareness

Rules 1, 2, and 3 are CROSS-MIGRATION aware. A `CREATE FUNCTION ... SECURITY
DEFINER` in migration A is NOT flagged if migration B contains
`ALTER FUNCTION ... SET search_path` for the same function name. Same applies
to views and tables. This means corrective migrations (like Wave 2 Task 3's
`20260421001209_lock_search_path_on_definer_functions.sql`) close the
historical violations automatically.

## Waivers

Add a `-- advisor-lint-allow: <reason>` SQL comment on the line ABOVE the
flagged statement to explicitly accept it. Example:

```sql
-- advisor-lint-allow: service_role policies bypass RLS by design.
create policy "Service role full access" on my_table for all to service_role
-- advisor-lint-allow: same — service_role canonical.
  using (true)
-- advisor-lint-allow: same — service_role canonical.
  with check (true);
```

The waiver is per-line, not per-policy. The reason text is mandatory in code
review even though the script doesn't parse it — the next reviewer needs to
understand WHY the violation is OK.

## When to fix vs. waive

- **Fix**: any new `SECURITY DEFINER` function should ship with `SET search_path` in the body. Any `CREATE VIEW` over RLS-sensitive data should ship with `security_invoker = on`. Defaults are unsafe.
- **Waive**: a policy that is intentionally permissive for `service_role` (which bypasses RLS anyway), or a `USING (true)` on a public-by-design table (e.g. lookup tables with no PII).
- **NEVER waive**: an open `INSERT`/`UPDATE`/`DELETE` policy on a table with `organization_id`. That's a cross-org write leak. Fix immediately.

## Running

```bash
# Local
npm run check:advisors

# CI (added in .github/workflows/ci.yml)
# Runs in the full matrix. Docs-only PRs intentionally skip Node checks; see
# docs/operations/ci-cd.md.
```

## Failure modes

| Symptom | Diagnosis | Remedy |
| --- | --- | --- |
| `SECURITY DEFINER without SET search_path` on a function I just added | New function lacks the inline `SET search_path` clause | Add `SET search_path = public` to the function body OR ship a corrective `ALTER FUNCTION` in a sibling migration. |
| Same on a function I didn't touch | Cross-file regex isn't finding the corrective ALTER | Verify the corrective migration uses the exact same function name; the regex is `(?:public\.)?<name>\b`. |
| `CREATE VIEW ... without security_invoker` | New view in an RLS-sensitive migration | Add `WITH (security_invoker = on)` to the CREATE statement. |
| `over-permissive policy: USING (true)` | New permissive policy | Either tighten the USING clause OR add a `-- advisor-lint-allow:` waiver with rationale. |
| `suspicious VITE_* secret-shaped key` | Adding a new env-example key | Either rename it to drop SECRET/PRIVATE/TOKEN/KEY/PASSWORD OR add it to the allow-list in the script. |

## Limitations

- **Static only** — does NOT replace Supabase's live `get_advisors` MCP. Run the live advisor on the deployed DB after every wave that ships a migration.
- **Regex-based** — corner cases (e.g., functions defined inside `DO $$ ... $$ blocks`) may slip through. The live advisor catches those.
- **Not a substitute for review** — code review is still required; the lint just guarantees a baseline floor.
