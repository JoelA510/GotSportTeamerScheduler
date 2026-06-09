/plan

# PR 06: Coach continuity and assistant backfill

## Goal

Handle realistic coach deltas without destabilizing teams: dropped head coaches, late head coaches, explicit household replacements, and assistant-only backfill. Fix assistant-only placement so it backfills existing teams needing assistant coverage before creating any new unmanaged team shell.

## Required repo survey

Inspect:

- `packages/core/src/teamGeneration.js`
- `packages/core/src/coachLinking.js`
- `packages/core/src/teamSnapshot.js`
- `packages/core/src/teamDelta.js`
- `packages/core/src/assignmentUnits.js`
- frontend coach/team mapping code
- tests touching coach and assistant behavior

## Implementation scope

Add a pure continuity helper if appropriate:

- `packages/core/src/coachContinuity.js`

Update generation logic only as required for this PR.

## Coach replacement policy

Use explicit/evidence-based replacement only. Do not blindly canonicalize distinct adult IDs.

Support one or more of these inputs if available in project data, with clear precedence:

```js
changePolicy: {
  coachReplacementMap: {
    [oldCoachId]: newCoachId
  },
  householdKeyField: 'householdId',
  allowHouseholdCoachReplacement: true,
  allowLateCoachAttachToChildTeam: true
}
```

Adjust shape to match project conventions.

## Required behavior

1. Dropped head coach: preserve team shell and roster; clear or flag coach as inactive; emit `coachNeeded` diagnostic.
2. Late head coach whose child is already on a coachless preserved team: attach coach to that team if policy allows.
3. Explicit household replacement: update the existing team from old coach ID to new coach ID when `coachReplacementMap` or a reliable household key confirms replacement.
4. Ambiguous household match: do not mutate team coach; emit manual-review diagnostic.
5. Same adult coaching multiple teams: do not collapse distinct team requests solely by `coachId`. Use an explicit team-request anchor if the repo has one; otherwise document and diagnose ambiguity.
6. Assistant-only unit placement order:
   - existing team that already has that assistant
   - existing team with head coach but no assistant
   - coachless team needing adult coverage
   - new assistant-anchored/unmanaged shell only if policy explicitly allows it
7. Do not reshuffle existing published/review rosters to satisfy late coach changes.

## Tests

Add tests for:

- dropped head coach preserves roster and marks team as needing coach
- late head coach attaches to child's preserved coachless team
- explicit `coachReplacementMap` updates same team coach ID
- ambiguous household replacement emits diagnostic without changing coach ID
- assistant-only unit backfills a team with head coach and no assistant
- assistant-only unit does not create ghost team by default
- same coach with multiple explicit team anchors can still create/anchor multiple teams if supported
- no-snapshot current coach anchoring remains compatible

## Documentation

Update architecture docs with:

- coach continuity semantics
- assistant backfill policy
- distinction between adult identity and team-request anchor
- manual-review cases

## Out of scope

- Frontend UI for entering replacement maps unless a minimal existing field already supports it.
- DB migrations unless absolutely necessary.
- Major redesign of coach registration.

## Acceptance criteria

- Existing tests pass.
- New coach/assistant tests pass.
- Diagnostics are clear enough for later UI surfacing.
- Typecheck/lint pass.
