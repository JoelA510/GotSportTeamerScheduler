# pgTAP Testing

Live-Postgres tests that exercise RLS invariants, trigger behavior, and
other DB-state properties Vitest can't see. Runs inside the database via
the `extensions.pgtap` extension.

## Why (vs Wave 6a's advisor-lint)

| Layer                                        | Catches                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Static** (Wave 6a `scripts/advisor-lint.js`) | Structural anti-patterns: missing `search_path`, tables without `ENABLE ROW LEVEL SECURITY`, `USING (true)` catch-all policies. Greps migration files. |
| **Dynamic** (Wave 7a pgTAP)                  | Behavioral violations: a policy that exists but still allows cross-org reads; a definer function that leaks rows; a view whose `security_invoker` doesn't enforce what we expect. Runs real queries under real roles. |

Together they cover structural + behavioral regressions.

## Running locally

Prerequisites: Supabase CLI + Docker Desktop.

```bash
supabase start            # ~3 min first time; pulls images & applies every migration
npm run test:db           # runs every supabase/tests/*.sql in order
supabase stop
```

Single file (for fast iteration while writing a new test):

```bash
npm run test:db:once supabase/tests/rls_cross_org_isolation.sql
```

## CI

`.github/workflows/pgtap.yml` runs pgTAP against a fresh local Supabase
instance on every PR that touches:

- `supabase/migrations/**`
- `supabase/tests/**`
- `.github/workflows/pgtap.yml` itself

**Conditional trigger is load-bearing.** A full `supabase start` + test
cycle costs ~3–5 min of GitHub Actions time. At typical PR cadence (~50/mo)
an unconditional trigger would consume ~300 min/mo against the free-tier
2000/mo cap. The `paths` filter reduces this to ~40 min/mo.

Manual runs are available via `workflow_dispatch` on the Actions tab when
you need to validate the suite without an open PR.

## Writing a test

1. Copy `supabase/tests/_template.sql` to a descriptive filename —
   snake_case, `<area>_<invariant>.sql`:
   - `rls_players_coach_write.sql`
   - `trigger_audit_log_append_only.sql`
   - `function_rotate_calendar_token_rejects_stranger.sql`
2. Wrap the body in `BEGIN ... ROLLBACK`. Tests must leave zero residue.
3. Include `\i supabase/tests/_fixtures.sql` if you need the shared seed
   (two orgs, three users, a team per org, audit rows, import rows).
   If the fixture is missing something, extend `_fixtures.sql` — **per-test
   INSERT statements are forbidden**.
4. Declare `SELECT plan(N)` with the exact number of assertions. Too many
   / too few asserts → test fails.
5. Simulate a user:

   ```sql
   SET LOCAL role = 'authenticated';
   SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';
   ```

   `auth.uid()`, `is_org_member()`, and `is_org_admin()` read from the JWT
   claims the session has set.

6. End with `SELECT * FROM finish();` before `ROLLBACK;`.

Useful pgTAP assertion helpers:

| Helper                                  | Use for                                                    |
| --------------------------------------- | ---------------------------------------------------------- |
| `is(actual, expected, description)`     | Scalar equality.                                           |
| `isnt(actual, expected, description)`   | Scalar inequality.                                         |
| `ok(boolean_expr, description)`         | Truthy assertion.                                          |
| `results_eq(query, expected, desc)`     | Row-set equality (column list + row list).                 |
| `throws_ok(query, err_code, desc)`      | "This should raise error X" — crucial for write-path RLS.  |

## Canonical fixtures

Defined in `supabase/tests/_fixtures.sql`. Reuse these UUIDs when writing
a new test that needs known identities.

| Entity                    | UUID                                   |
| ------------------------- | -------------------------------------- |
| Alice (admin of Org A)    | `11111111-1111-1111-1111-111111111111` |
| Bob (admin of Org B)      | `22222222-2222-2222-2222-222222222222` |
| Charlie (coach of Org A)  | `33333333-3333-3333-3333-333333333333` |
| Org A                     | `a1111111-1111-1111-1111-111111111111` |
| Org B                     | `b2222222-2222-2222-2222-222222222222` |
| A-Team (Org A)            | `aaaaaaaa-0000-0000-0000-000000000001` |
| B-Team (Org B)            | `bbbbbbbb-0000-0000-0000-000000000002` |

## Wave 7a canonical suite

| Test                                               | Invariant                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `rls_cross_org_isolation.sql`                      | Alice (Org A) cannot SELECT Org B's teams.                                |
| `rls_anonymous_gate.sql`                           | `anon` role reads zero rows from organizations, teams, players, audit_log, organization_members. |
| `rls_admin_vs_coach.sql`                           | `audit_log` is readable by Alice (admin) and blocked for Charlie (coach). |
| `rls_service_role_bypass.sql`                      | `service_role` sees every team across every org.                          |
| `rls_import_efficiency_metrics_view.sql`           | The `security_invoker = on` view is org-scoped for its caller.            |

## When a test fails

**Do not weaken a test to make it pass.** A failing pgTAP assertion means
one of:

- The policy you're testing is weaker than the invariant expects → file
  a separate PR to fix the policy (with its own targeted test).
- The test is wrong → fix the test.
- The invariant itself was renegotiated → amend
  `docs/security/rls-policies.md` and update the assertion in the same PR.

Fix-in-follow-up discipline: Wave 7a ships the tests and the CI harness;
policy fixes land in their own PRs so the failing-test signal stays
visible in git history.

## Tooling

- pgTAP extension lives in `extensions` schema (see migration
  `supabase/migrations/20260423065246_enable_pgtap.sql`).
- Supabase CLI's `supabase test db` command auto-discovers every
  `supabase/tests/*.sql` file, so simply adding a file is sufficient —
  no test-registry update needed.
- Revert migration: `docs/sql/reverts/20260423065246_disable_pgtap.sql`.

## Related docs

- `docs/security/rls-policies.md` — the invariants this suite enforces.
- `supabase/tests/README.md` — in-directory quick reference.
- Wave 6a's `scripts/advisor-lint.js` — the static half of this belt-and-
  braces arrangement.
