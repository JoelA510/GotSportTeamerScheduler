/plan

# PR 01: Foundation design and characterization tests

## Goal

Create the foundation for incremental/snapshot-aware teaming without changing production behavior. This PR should document the current data flow, lock down existing behavior with characterization tests, and create reusable fixtures for later PRs.

## Required repo survey

Use read-only exploration, preferably via subagents, to inspect at least:

- `packages/core/src/teamGeneration.js`
- `packages/core/src/teamingPipeline.js`
- `packages/core/src/rosterSizing.js`
- `packages/core/src/coachLinking.js`
- `packages/core/src/teamDiagnostics.js`
- `packages/core/src/teamPersistenceSnapshot.js`
- `packages/core/src/teamSupabase.js`
- `frontend/src/pages/TeamAnalysisPage.jsx`
- `frontend/src/utils/teamReviewPersistence.js`
- `frontend/src/components/teaming/RosterManager.jsx`
- `frontend/src/hooks/useConflicts.js`
- existing tests under `tests/`

## Implementation scope

Add or update documentation and tests only unless a tiny test helper export is unavoidable.

Recommended files:

- `docs/architecture/incremental-teaming-hardening.md`
- `docs/architecture/team-generation.md` only to add a short cross-link or current-state note
- `tests/fixtures/incrementalTeamingFixtures.js` or equivalent
- `tests/teamGeneration.characterization.test.js` or equivalent

## Documentation content

Document:

1. Current data flow from `TeamAnalysisPage` to persistence.
2. Current fresh-allocation assumptions.
3. Invariants that must remain true when no `existingSnapshot` is supplied.
4. Proposed phased target architecture:
   - snapshot normalization
   - delta reconciliation
   - typed assignment units
   - structural team-count policy
   - buddy normalization and historical buddy routing
   - coach/assistant continuity
   - change diagnostics
   - frontend/persistence integration
5. Data-shape sketches for:
   - `existingSnapshot`
   - typed assignment units
   - `changePolicy`
   - `changeDiagnosticsByDivision`
6. Risk register and PR sequence.

## Test content

Add non-failing characterization coverage for current behavior, including:

- `generateTeams` works without an `existingSnapshot`.
- Existing roster sizing behavior is preserved in draft/fresh generation.
- Existing mutual buddy handling still behaves as currently implemented.
- Existing coach anchoring still behaves as currently implemented.
- Existing overflow behavior still behaves as currently implemented.

Add future hardening scenarios as `test.todo` only if the repo's test runner supports that cleanly without causing failures. Future TODOs should include:

- preserving team count after player drops
- preserving team IDs from an existing snapshot
- late player routed to buddy's locked team
- full buddy target overflows with a specific reason
- assistant-only coach unit backfills an existing team
- dropped coach preserves roster and marks coach needed

## Out of scope

- Do not change `generateTeams` signature in this PR.
- Do not alter team allocation behavior.
- Do not touch Supabase persistence behavior beyond documentation.
- Do not introduce DB migrations.

## Acceptance criteria

- Full tests pass.
- Typecheck passes if present.
- Lint passes if present.
- Documentation clearly names the later PR boundaries.
- The PR body explains that this is a foundation/design/characterization PR with no production behavior change.
