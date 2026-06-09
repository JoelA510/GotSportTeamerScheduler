/plan

# PR 05: Buddy normalization and historical buddy resolution

## Goal

Normalize buddy fields before generation and support late players whose valid buddy target is already assigned to a preserved team. This PR should route valid late buddy requests to the buddy's existing team when capacity and policy allow, and overflow with a clear diagnostic when they do not.

## Required repo survey

Inspect:

- `packages/core/src/teamingPipeline.js`
- `packages/core/src/teamGeneration.js`
- `packages/core/src/assignmentUnits.js`
- `packages/core/src/teamSnapshot.js`
- `packages/core/src/teamDelta.js`
- `frontend/src/pages/TeamAnalysisPage.jsx`
- `frontend/src/hooks/useConflicts.js`
- tests touching buddy behavior

## Implementation scope

Add a pure buddy normalization helper, likely:

- `packages/core/src/buddyLinking.js`

Integrate it into the core/pipeline layer where player data is prepared for generation. Avoid DB-specific logic in core.

## Buddy normalization target

Support canonicalizing buddy links from fields such as:

- `buddyId`
- `buddy_id`
- `mutual_buddy_code`
- `mutualBuddyCode`
- any existing project-specific imported buddy field found during repo survey

Output should set canonical `buddyId` or an equivalent canonical field used by `generateTeams`.

## Required buddy diagnostics

Emit diagnostics for:

- missing buddy target
- one-sided request when reciprocal buddy is required
- duplicate buddy code with more than two players
- self-reference
- cross-division buddy request
- buddy target already assigned to a full team
- buddy target not eligible under generation policy

## Historical buddy routing behavior

1. Build a buddy lookup across both incoming players and preserved snapshot players.
2. If a late/unassigned player has a valid buddy already preserved on a team, create a `targeted-buddy` assignment unit with `targetTeamId`.
3. If target team has capacity and policy permits, assign the late player to that team.
4. If the target team is full, over cap, locked against additions, or otherwise invalid, put the player in overflow with a specific reason such as `buddy-target-capacity` or `buddy-target-locked`.
5. Do not reshuffle existing published/review rosters to satisfy a late buddy request.
6. Preserve current fresh-generation buddy behavior when no snapshot is supplied.

## Conflict hook alignment

Update or prepare `useConflicts` so it uses the same canonical buddy field. Do not duplicate normalization logic in React if the core helper can be reused safely.

## Tests

Add tests for:

- normalizing `buddyId`
- normalizing `buddy_id`
- normalizing `mutual_buddy_code`
- duplicate code diagnostic
- one-sided buddy diagnostic
- cross-division diagnostic
- late player routed to buddy's preserved team
- late player overflows when buddy target team is full
- no reshuffle of existing locked players for late buddy request
- no-snapshot mutual buddy behavior still works
- `useConflicts` or equivalent conflict code sees canonical buddy links

## Out of scope

- Coach continuity and assistant backfill.
- Frontend fetch of persisted existing teams unless needed for a small mapping fix.
- DB migrations.

## Acceptance criteria

- Existing and new tests pass.
- Docs explain canonical buddy fields and historical buddy behavior.
- Typecheck/lint pass.
