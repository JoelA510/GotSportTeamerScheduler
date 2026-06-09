/plan

# PR 07: Change diagnostics and generation summaries

## Goal

Surface incremental teaming decisions in structured diagnostics so admins can understand what changed, what was preserved, what overflowed, and what needs manual review. This PR should focus on core output and summaries, not broad frontend UX.

## Required repo survey

Inspect:

- `packages/core/src/teamDiagnostics.js`
- `packages/core/src/teamGeneration.js`
- `packages/core/src/teamDelta.js`
- `packages/core/src/buddyLinking.js`
- `packages/core/src/coachContinuity.js`
- any existing `summarizeTeamGeneration` helper
- tests for diagnostics/summaries

## Target output

Add or finalize `changeDiagnosticsByDivision` in generation output:

```js
changeDiagnosticsByDivision: {
  [division]: {
    mode: 'draft' | 'review' | 'published' | 'locked',
    teamCountPolicy: string,
    existingTeamsPreserved: number,
    newTeamsCreated: number,
    teamCountChangeBlocked: boolean,
    lockedAssignmentsPreserved: number,
    manualAssignmentsPreserved: number,
    latePlayersAssigned: number,
    latePlayersOverflowed: number,
    droppedPlayersRemoved: number,
    coachDrops: [],
    coachReplacements: [],
    assistantBackfills: [],
    buddyTargetAssignments: [],
    capacityViolations: [],
    minRosterWarnings: [],
    structuralWarnings: [],
    manualReview: []
  }
}
```

Adjust exact shape to project conventions, but keep it structured and testable.

## Required behavior

1. Diagnostics must be stable enough for UI consumption.
2. Diagnostics must not rely on string parsing of human summaries.
3. Existing summary output remains backward-compatible where possible.
4. Overflow entries should carry actionable reason codes.
5. Manual-review cases should be distinguishable from hard errors.
6. Avoid unnecessary PII in diagnostics; use IDs and counts unless names are already used in current diagnostics.
7. No-snapshot generation should either omit incremental diagnostics or provide empty/default diagnostics without breaking callers.

## Tests

Add tests for diagnostics covering:

- preserved team count
- blocked team count shrink
- late assignment count
- late overflow count and reason
- dropped player count
- manual assignment preserved count
- coach needed diagnostic
- assistant backfill diagnostic
- historical buddy target assignment diagnostic
- no-snapshot backward compatibility

## Documentation

Update docs to include:

- diagnostic field descriptions
- example admin-facing interpretation
- manual-review reasons
- overflow reason codes

## Out of scope

- Full UI rendering of diagnostics.
- Persistence schema changes.
- New generation behavior beyond wiring diagnostics from already-implemented logic.

## Acceptance criteria

- Tests pass.
- Typecheck/lint pass.
- Diagnostics are documented.
- Existing consumers are not broken.
