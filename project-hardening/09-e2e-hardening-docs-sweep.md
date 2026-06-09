/plan

# PR 09: End-to-end hardening sweep, docs, and interaction audit

## Goal

Perform a final cross-cutting audit after the incremental teaming feature is implemented. This PR should close gaps, add end-to-end regression coverage, update docs, and verify interactions across changed code. Avoid major new architecture unless a serious bug is found.

## Required repo survey

Use subagents for parallel read-only review where useful:

1. Core generation and helpers.
2. Frontend integration and review snapshot flow.
3. Persistence helpers/RPC payload shape.
4. Tests and fixtures.
5. Documentation.

Inspect all files changed by PRs 01-08 plus any call sites discovered by `rg`.

## Required audit commands

Use commands appropriate for the repo, including at least:

```bash
git log --oneline --decorate -20
rg "generateTeams|existingSnapshot|generationMode|changePolicy|teamCountPolicy|changeDiagnosticsByDivision|buddyId|mutual_buddy_code|coachReplacement|assistant" .
npm test
npm run typecheck
npm run lint
git diff --check
```

If package scripts differ, inspect `package.json` and use the repo-equivalent commands.

## Required E2E-style regression scenarios

Add focused tests, fixtures, or integration-style tests for the full flow where possible:

1. Existing published 3-team division, one player drops, team count remains 3.
2. Existing reviewed teams with a manual admin move, late player added, manual assignment remains untouched.
3. Late player has valid buddy request to a locked player; lands on buddy's team when capacity allows.
4. Same scenario with full target team; late player overflows with clear reason.
5. Head coach drops; roster remains, team is marked coach-needed.
6. Late coach whose child is already on coachless team attaches to that team.
7. Assistant-only registration backfills an existing team instead of creating ghost shell.
8. Frontend review snapshot preserves persisted UUIDs and includes full authoritative persistence payload.
9. No-snapshot draft generation still behaves like the original fresh generator.

## Documentation sweep

Update or verify:

- architecture docs
- admin/team-generation docs, if present
- developer docs for core helper shapes
- test fixture docs, if present
- any CLAUDE.md or contributor instructions only if the workflow changed

Docs should answer:

- when to use fresh generation vs incremental generation
- what policies exist and what defaults apply
- how late registrations and drops are handled
- how buddy requests into existing teams are handled
- how coach/assistant changes are handled
- what diagnostics admins should expect
- what persistence invariants must be preserved

## Interaction audit

Before committing, explicitly check:

- all changed exports have updated call sites
- all UI consumers tolerate absent/empty incremental diagnostics
- all old `generateTeams` calls still work
- persistence still sends full team/player payloads
- no new duplicate player/team ID path exists
- no accidental dependency from core to frontend/Supabase exists
- no large untested branch remains
- no prompt files under `hardening-plan/` are staged

## Out of scope

- New major features.
- Database migrations unless required to fix a correctness bug.
- Large UI redesign.

## Acceptance criteria

- Full suite passes.
- Final docs are coherent and not contradictory.
- PR body includes the interaction audit checklist and results.
- Any remaining limitations are documented as explicit follow-up issues, not hidden TODOs.
