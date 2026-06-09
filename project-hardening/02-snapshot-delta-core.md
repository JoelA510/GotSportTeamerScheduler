/plan

# PR 02: Snapshot normalization and delta reconciliation core

## Goal

Add pure core helpers for representing existing teams and computing deltas between current registrations and an existing roster snapshot. Do not integrate them into `generateTeams` yet except for exports if needed.

## Required repo survey

Inspect the design doc added in PR 01 and the current core files:

- `packages/core/src/teamGeneration.js`
- `packages/core/src/teamPersistenceSnapshot.js`
- `packages/core/src/teamSupabase.js`
- `packages/core/src/teamingPipeline.js`
- relevant tests and fixtures

## Implementation scope

Add pure helper modules with JSDoc types and tests.

Recommended modules:

- `packages/core/src/teamSnapshot.js`
- `packages/core/src/teamDelta.js`

Export them only through existing package conventions after inspecting the repo structure.

## Required helper behavior

Implement helpers similar to these, adjusting names to repo conventions:

```js
normalizeExistingSnapshot(existingSnapshot, options)
indexTeamSnapshot(normalizedSnapshot)
reconcileTeamDeltas({
  players,
  existingSnapshot,
  generationMode,
  changePolicy,
  divisionConfigs,
})
```

The normalized snapshot should support at least:

```js
{
  status: 'draft' | 'review' | 'published' | 'locked',
  runId: string | null,
  teamsByDivision: {
    [division]: [
      {
        id: string,
        generatorId?: string,
        name?: string,
        division: string,
        coachId?: string | null,
        assistantCoachIds?: string[],
        locked?: boolean,
        players: [
          {
            id: string,
            assignment_source?: 'auto' | 'manual',
            locked?: boolean
          }
        ]
      }
    ]
  }
}
```

The reconciliation output should separate:

```js
{
  preservedTeamsByDivision,
  activeLockedPlayerIds,
  unassignedPlayersByDivision,
  droppedPlayersByDivision,
  changedDivisionPlayers,
  orphanedSnapshotPlayers,
  coachDeltas,
  diagnostics
}
```

## Required semantics

1. Player exists in incoming active registration data and snapshot: preserve assignment metadata.
2. Player exists in incoming data but not snapshot: classify as unassigned/late delta.
3. Player exists in snapshot but not incoming data: classify as dropped, remove from active team roster in the reconciled view, but preserve the team shell.
4. Manual assignments are locked in `review`, `published`, and `locked` modes.
5. Team shells survive even if all players are dropped.
6. Divisions present only in the snapshot still appear in preserved output.
7. Invalid or incomplete snapshot rows produce diagnostics, not crashes, unless the shape is unrecoverable.

## Tests

Add focused tests for the new helpers:

- normalizes a minimal valid snapshot
- indexes teams by ID and players by ID
- classifies late players
- classifies dropped players
- preserves empty team shells
- preserves divisions that appear only in snapshot
- marks manual assignments locked in review/published/locked modes
- emits diagnostics for duplicate player IDs across teams
- emits diagnostics for team division mismatch
- handles null/undefined snapshot as empty without breaking callers

## Out of scope

- Do not change allocation behavior.
- Do not modify frontend.
- Do not modify persistence RPCs.
- Do not implement buddy or coach continuity yet.

## Acceptance criteria

- Existing tests still pass.
- New helper tests pass.
- Typecheck/lint pass.
- Docs from PR 01 are updated if helper shapes differ from the initial design.
