/plan

# PR 04: Structural stability and incremental generation

## Goal

Integrate snapshot/delta helpers into `generateTeams` so existing team shells and IDs can be preserved when rosters are in review/published/locked modes. Implement structural team-count policies and basic late/drop handling. Do not implement buddy-code normalization or coach replacement logic yet.

## Required repo survey

Inspect:

- `packages/core/src/teamGeneration.js`
- `packages/core/src/teamSnapshot.js`
- `packages/core/src/teamDelta.js`
- `packages/core/src/assignmentUnits.js`
- `packages/core/src/rosterSizing.js`
- current generation tests
- design doc from PR 01

## Public API target

Extend `generateTeams` in a backward-compatible way:

```js
export function generateTeams({
  players,
  divisionConfigs,
  random = Math.random,
  seed,
  featureFlags = {},
  dryRun = false,
  customWeights = {},
  existingSnapshot = null,
  generationMode = 'draft',
  changePolicy = {},
})
```

If the codebase uses a different argument convention, adapt while preserving all existing call sites.

## Team-count policy

Add normalized support for:

```js
teamCountPolicy:
  | 'auto'
  | 'preserve-existing'
  | 'preserve-or-expand'
  | 'preserve-with-overflow'
```

Semantics:

- `auto`: existing fresh-generation behavior.
- `preserve-existing`: initialize from existing team shells; do not create or delete teams; overflow new players that cannot fit.
- `preserve-or-expand`: initialize from existing team shells; create the minimum necessary new teams if capacity requires it.
- `preserve-with-overflow`: initialize from existing team shells; do not create teams; overflow excess late players with specific reasons.

Default policy:

- no snapshot: `auto`
- snapshot with `generationMode` of `review`, `published`, or `locked`: `preserve-existing` unless explicitly overridden
- snapshot with `generationMode` of `draft`: `preserve-or-expand` unless explicitly overridden

## Required behavior

1. With no `existingSnapshot`, all current behavior remains unchanged.
2. With a snapshot, team IDs, names, division, coach ID, and assistant IDs are preserved where available.
3. Incoming players already assigned in the snapshot stay on their existing teams unless explicitly dropped or invalid.
4. Dropped players are removed from active rosters, but team shells remain.
5. Empty teams remain when policy requires preservation.
6. Team count does not shrink in review/published/locked mode.
7. New players are assigned only into available capacity or overflow according to policy.
8. Existing teams that are already over cap are preserved but flagged in diagnostics; do not add more players to them unless `allowOverCapAssignments` is explicitly true.
9. `minRosterSize` should become a warning in review/published/locked mode, not a reason to collapse preserved teams.
10. Divisions present only in the snapshot must remain in output.

## Tests

Add tests for:

- no-snapshot backward compatibility
- preserving existing team count after player drop
- preserving existing team IDs and names
- preserving an empty team shell after all players drop
- late player assigned into available preserved capacity
- late player overflows when all preserved teams are full under `preserve-existing`
- `preserve-or-expand` creates a new team only when required
- `preserve-with-overflow` overflows instead of expanding
- underfilled published teams produce diagnostics instead of collapsing
- over-cap preserved teams produce diagnostics and do not accept more players by default
- division present only in snapshot is returned

## Out of scope

- Buddy-code normalization.
- Historical buddy targeting beyond preserving already-assigned players.
- Coach household replacement.
- Assistant backfill fix.
- Frontend and persistence integration.

## Acceptance criteria

- Existing tests pass.
- New incremental tests pass.
- Public API is documented.
- Design doc is updated with actual policy behavior.
- Typecheck/lint pass.
