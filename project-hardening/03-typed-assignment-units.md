/plan

# PR 03: Typed assignment units refactor

## Goal

Replace the implicit “assignment unit is just an array of players” model with explicit typed assignment units, while preserving current fresh-generation behavior when no snapshot/delta mode is used.

## Required repo survey

Inspect:

- `packages/core/src/teamGeneration.js`
- snapshot/delta helpers from PR 02
- current characterization tests from PR 01
- existing buddy, coach, assistant, overflow tests

## Implementation scope

Create or refactor into a helper module such as:

- `packages/core/src/assignmentUnits.js`

Use JSDoc types unless the package is already TypeScript.

## Target assignment-unit shape

Use a shape like this, adjusted to repo naming conventions:

```js
{
  id: string,
  type:
    | 'general'
    | 'mutual-buddy'
    | 'coach'
    | 'assistant'
    | 'targeted-buddy'
    | 'locked',
  players: Player[],
  targetTeamId: string | null,
  coachId: string | null,
  assistantCoachIds: string[],
  locked: boolean,
  hardConstraints: string[],
  softConstraints: string[],
  skillTotal: number,
  diagnostics: []
}
```

Keep a small adapter if needed so existing logic can transition incrementally.

## Required behavior

1. Current mutual buddy grouping must behave the same in fresh generation.
2. Current coach-child anchoring must behave the same in fresh generation.
3. Current assistant metadata must be carried forward explicitly.
4. Sorting and balancing must remain deterministic under the same seed/random inputs.
5. Unit-level diagnostics should be possible but not required to surface externally yet.
6. The refactor should make targeted placement possible for later PRs without implementing historical buddy routing yet.

## Tests

Add or update tests to cover:

- unit creation for single players
- unit creation for reciprocal buddy pairs
- one-sided buddy request remains non-paired under current policy
- coach unit includes `coachId`
- assistant unit includes `assistantCoachIds`
- generated teams are equivalent for representative no-snapshot scenarios before and after the refactor
- existing characterization tests still pass

If exact roster equivalence is too brittle due to deterministic tie ordering, assert the important invariants: player set, team count, roster size constraints, coach anchoring, buddy co-placement, and overflow reasons.

## Out of scope

- Do not add `existingSnapshot` integration in this PR.
- Do not add buddy-code normalization.
- Do not change assistant backfill behavior yet unless required to preserve existing behavior.
- Do not touch frontend or persistence.

## Acceptance criteria

- Existing behavior without snapshot is unchanged.
- Tests, typecheck, lint, and `git diff --check` pass.
- Docs are updated if the internal unit shape is documented.
