/plan

# PR 08: Frontend and persistence integration for incremental teaming

## Goal

Wire snapshot-aware generation into the Team Analysis / roster review flow and ensure persistence receives a complete authoritative snapshot that preserves existing team IDs and team-player rows. This PR should connect the core behavior to actual admin workflows without DB-specific logic leaking into core generation.

## Required repo survey

Inspect:

- `frontend/src/pages/TeamAnalysisPage.jsx`
- `frontend/src/utils/teamReviewPersistence.js`
- `frontend/src/components/teaming/RosterManager.jsx`
- `frontend/src/hooks/useConflicts.js`
- `packages/core/src/teamSupabase.js`
- `packages/core/src/teamPersistenceSnapshot.js`
- `packages/core/src/teamGeneration.js`
- Supabase RPC usage and tests, if any

## Required behavior

1. Before snapshot-aware generation, fetch or derive existing persisted teams/team players for the selected league/division when available.
2. Build an `existingSnapshot` for core generation using persisted team IDs, team names, coach IDs, assistant IDs, players, and assignment source.
3. Pass `existingSnapshot`, `generationMode`, and appropriate `changePolicy` into `generateTeams`.
4. Preserve persisted UUID team IDs in review snapshots. Do not remap existing persisted IDs to new UUIDs.
5. Continue generating UUIDs only for newly-created team shells that do not already exist in persistence.
6. Ensure the persistence payload remains a full authoritative snapshot for all teams that should survive. Do not send partial team/player rows that would delete preserved assignments.
7. Preserve `assignment_source: 'manual'` for manual roster moves and ensure manual assignments are treated as locked in review/published modes.
8. Surface incremental diagnostics in a minimal admin-visible way if there is an existing diagnostics surface. If no suitable UI exists, add the smallest safe warning panel or document why UI rendering is deferred.
9. Keep core generation free of Supabase imports.

## Persistence safety checks

Before implementing, confirm how current persistence deletes or replaces `team_players`. Then ensure this PR cannot accidentally delete preserved team-player rows due to a partial payload.

Add tests or helper tests for:

- existing team ID preservation through review snapshot build
- new generated teams get new IDs while existing teams keep persisted IDs
- manual assignment source remains manual
- full authoritative snapshot includes preserved teams and players
- dropped players are omitted intentionally while their team shell remains if policy requires it
- no duplicate team IDs
- no duplicate player IDs across teams

## Frontend tests

Use the repo's existing frontend test tooling if present. If component tests are not established, prefer pure helper tests around snapshot construction and review snapshot building rather than adding brittle browser tests.

## Documentation

Update docs with:

- admin flow for rerunning teaming after rosters are reviewed/published
- persistence safety invariants
- how existing team IDs are preserved
- what happens to late players, dropped players, and manual moves

## Out of scope

- DB migrations unless an existing schema cannot represent the required data.
- Large UX redesign.
- New schedule-generation behavior.

## Acceptance criteria

- Full test/typecheck/lint suite passes.
- Core remains independent of Supabase/frontend imports.
- Existing persisted IDs are preserved in the snapshot path.
- Persistence receives full authoritative data.
- Docs describe the integration behavior.
