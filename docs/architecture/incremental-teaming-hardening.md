[← Back to Documentation Index](../README.md)
---

# Incremental Teaming Hardening — Design & PR Sequence

> **Status:** Foundation / design document. This page is the design baseline for a phased
> hardening effort that adds **snapshot-aware, incremental** team generation on top of the
> current fresh allocator. It is introduced alongside characterization tests in the
> foundation PR and **describes no production behavior change by itself** — later PRs
> implement the phases below.

The current allocator (`packages/core/src/teamGeneration.js`) is a **fresh allocator**: every
run treats all players as unassigned and builds teams from scratch. That is correct for the
first teaming pass of a season, but it cannot safely re-run once rosters have been reviewed,
published, or locked — a re-run would discard existing team IDs, manual moves, and coach
assignments. This effort hardens the engine so it can **preserve an existing snapshot** and
reconcile only what changed (late registrations, drops, buddy/coach deltas) while leaving the
fresh path untouched when no snapshot is supplied.

See also: [`team-generation.md`](team-generation.md) (current algorithm design),
[`data-modeling.md`](data-modeling.md), and [`persistence-rpc-layer.md`](persistence-rpc-layer.md).

---

## 1. Current data flow (TeamAnalysisPage → persistence)

1. **Import → generator players.** `frontend/src/pages/TeamAnalysisPage.jsx` reads imported
   registration rows from the import context and maps each to an engine-shaped player via
   `toGeneratorPlayer()` (normalizes skill text → numeric, resolves division from age group,
   carries `coachId`).
2. **Coach linking & play-up.** `packages/core/src/teamingPipeline.js` (`prepareTeamingInput`)
   links volunteer coaches to their children (via `coachLinking.js`) and annotates play-up
   eligibility before generation.
3. **Generation.** `TeamAnalysisPage` calls `generateTeams({ players, divisionConfigs, seed })`
   (frontend uses `seed`; unit tests use an injected `random`). The allocator returns teams +
   diagnostics per division (see §3).
4. **Review snapshot.** `frontend/src/utils/teamReviewPersistence.js` (`buildTeamReviewSnapshot`)
   wraps the result with DB UUIDs and per-player metadata, including `assignment_source`
   (`'auto'` vs `'manual'`). `frontend/src/components/teaming/RosterManager.jsx` performs manual
   roster moves, marking moved players `assignment_source: 'manual'`.
5. **Persistence.** `packages/core/src/teamSupabase.js` (`buildTeamRows`, `buildTeamPlayerRows`)
   and `teamPersistenceSnapshot.js` produce the snake-case Supabase payload (`team_players` rows
   keyed by `team_id` / `player_id` / `source` / `run_id`). Conflict detection for buddies lives
   in `frontend/src/hooks/useConflicts.js`.

**Key seam:** today the persistence layer already understands team UUIDs and
`assignment_source`, but **the generator never receives them back** — there is no
`existingSnapshot` input. Closing that loop is the core of this effort.

---

## 2. Current generateTeams contract

Signature (`packages/core/src/teamGeneration.js:89`):

```js
export function generateTeams({
  players,
  divisionConfigs,
  random = Math.random,
  seed,
  featureFlags = {},
  dryRun: _dryRun = false,
  customWeights = {},
})
```

Return shape (per-division maps):

- `teamsByDivision[div]` — `Array<{ id, name, division, coachId, coachNeeded, assistantCoachIds, skillTotal, players }>`
- `overflowByDivision[div]` — `Array<{ players, reason, metadata? }>` (reasons today: `coach-capacity`, `insufficient-capacity`)
- `overflowSummaryByDivision[div]` — `{ totalUnits, totalPlayers, byReason }`
- `buddyDiagnosticsByDivision[div]` — `{ mutualPairs, unmatchedRequests }`
- `coachCoverageByDivision[div]` — `{ totalTeams, volunteerCoaches, teamsWithCoach, teamsWithoutCoach, coverageRate, needsAdditionalCoaches, additionalCoachesNeeded }`
- `rosterBalanceByDivision[div]` — `{ teamStats[], summary }`
- `skillBalanceByDivision[div]` — `{ teamStats[], summary }`

Team IDs are generated as `${division}-T{nn}` (e.g. `U10-T01`). Determinism comes from `seed`
(hashed to a `mulberry32` PRNG) or an injected `random`.

---

## 3. Current fresh-allocation assumptions

1. All input players start **unassigned**; no team identity is carried in.
2. Teams are **anchored per unique `coachId`** found in the player set, then additional coachless
   teams are created up to the required count.
3. Assignment **units** are atomic: a single player, or a confirmed **mutual** buddy pair.
   One-sided / self / cross-target buddy requests are reported, never paired.
4. Allocation source is always implicitly **auto**; there are no manual locks to honor.
5. Roster constraints (`maxRosterSize`, `minRosterSize`, `minTeams`, `maxTeams`, overrides) apply
   uniformly; units that cannot fit go to **overflow** with a reason.
6. Diagnostics (coach coverage, roster/skill balance, buddy, overflow) are computed from the
   freshly built teams only.

---

## 4. Invariants that MUST hold when no `existingSnapshot` is supplied

These are locked in by `tests/teamGeneration.characterization.test.js` and must remain true as
the phases below land (they define backward compatibility for the fresh path):

- **Conservation:** every input player is assigned to exactly one team **or** present in overflow;
  no player appears twice.
- **Capacity:** no team exceeds `maxRosterSize`.
- **Buddy co-placement:** mutual buddies share a team, or overflow together as one unit.
- **Coach anchoring:** a player with `coachId` lands on that coach's team (or overflows under
  `coach-capacity`), and an anchored coach team has `coachNeeded === false`.
- **Overflow stability:** existing reason codes (`coach-capacity`, `insufficient-capacity`) and
  their `metadata` shapes are unchanged.
- **Param tolerance:** passing later incremental params (`existingSnapshot: null`,
  `generationMode: 'draft'`, `changePolicy: {}`, `teamCountPolicy: 'auto'`) produces **identical**
  output to omitting them.

---

## 5. Phased target architecture

Each phase is one PR (see §7). Phases are additive and preserve the fresh path.

1. **Snapshot normalization & delta reconciliation core** (PR 02) — pure helpers
   (`teamSnapshot.js`, `teamDelta.js`): normalize an existing snapshot and classify players as
   preserved / late / dropped / changed, with diagnostics. Not yet wired into `generateTeams`.
2. **Typed assignment units** (PR 03) — replace the implicit "array of players" unit with explicit
   typed units (`assignmentUnits.js`); preserve fresh behavior exactly.
3. **Structural stability & incremental generation** (PR 04) — integrate snapshot/delta into
   `generateTeams` behind new optional params; add team-count policies; preserve team IDs/shells.
4. **Buddy normalization & historical buddy routing** (PR 05) — canonicalize buddy fields
   (`buddyLinking.js`) and route valid late buddies to a preserved team or overflow with a reason.
5. **Coach continuity & assistant backfill** (PR 06) — handle dropped/late/replaced head coaches
   and fix assistant-only placement to backfill existing teams (`coachContinuity.js`).
6. **Change diagnostics & summaries** (PR 07) — emit structured `changeDiagnosticsByDivision`.
7. **Frontend & persistence integration** (PR 08) — build `existingSnapshot` from persisted teams,
   preserve UUIDs, send a full authoritative persistence payload.
8. **E2E hardening sweep, docs, interaction audit** (PR 09) — end-to-end regression scenarios and
   final documentation/interaction audit.

---

## 6. Proposed data shapes (target — not yet implemented)

These shapes are the agreed targets the phases will implement; exact names may be adjusted to
repo conventions during each PR. A canonical example snapshot lives in
`tests/fixtures/incrementalTeamingFixtures.js` (`makeExistingSnapshotFixture`).

**`existingSnapshot`** (input to PR 04, normalized by PR 02):

```js
{
  status: 'draft' | 'review' | 'published' | 'locked',
  runId: string | null,
  teamsByDivision: {
    [division]: [{
      id: string,            // persisted UUID — preserved, never remapped
      generatorId?: string,  // prior `${division}-T{nn}` label
      name?: string,
      division: string,
      coachId?: string | null,
      assistantCoachIds?: string[],
      locked?: boolean,
      players: [{ id: string, assignment_source?: 'auto' | 'manual', locked?: boolean }],
    }],
  },
}
```

**Typed assignment unit** (PR 03):

```js
{
  id: string,
  type: 'general' | 'mutual-buddy' | 'coach' | 'assistant' | 'targeted-buddy' | 'locked',
  players: Player[],
  targetTeamId: string | null,
  coachId: string | null,
  assistantCoachIds: string[],
  locked: boolean,
  hardConstraints: string[],
  softConstraints: string[],
  skillTotal: number,
  diagnostics: [],
}
```

**`changePolicy`** (PR 04/06):

```js
{
  teamCountPolicy: 'auto' | 'preserve-existing' | 'preserve-or-expand' | 'preserve-with-overflow',
  allowOverCapAssignments?: boolean,
  coachReplacementMap?: { [oldCoachId]: newCoachId },
  householdKeyField?: string,
  allowHouseholdCoachReplacement?: boolean,
  allowLateCoachAttachToChildTeam?: boolean,
}
```

**`changeDiagnosticsByDivision`** (PR 07):

```js
{
  [division]: {
    mode, teamCountPolicy,
    existingTeamsPreserved, newTeamsCreated, teamCountChangeBlocked,
    lockedAssignmentsPreserved, manualAssignmentsPreserved,
    latePlayersAssigned, latePlayersOverflowed, droppedPlayersRemoved,
    coachDrops: [], coachReplacements: [], assistantBackfills: [],
    buddyTargetAssignments: [], capacityViolations: [],
    minRosterWarnings: [], structuralWarnings: [], manualReview: [],
  }
}
```

---

## 6a. Implemented in PR 02 — snapshot & delta helpers

PR 02 landed the two pure helpers below in `packages/core/src` (no `generateTeams` change). They
implement §5 phase 1 against the real persisted shapes: the design `existingSnapshot` in §6 and the
relational persistence/review payload (`{ payload: { teamRows, teamPlayerRows } }`) are both accepted,
and `null`/malformed input yields diagnostics rather than throwing.

```js
normalizeExistingSnapshot(existingSnapshot, options?) => {
  status, runId,
  teamsByDivision,   // canonical NormalizedTeam[] per division (camelCase; assistants flattened)
  orphanedPlayers,   // [{ playerId, teamId }] — player rows with no resolvable team
  diagnostics,       // [{ code, severity, message }]
}

indexTeamSnapshot(normalized) => { teamsById, playersById, teamIdByPlayerId, divisions }

reconcileTeamDeltas({ players, existingSnapshot, generationMode, changePolicy?, divisionConfigs? }) => {
  preservedTeamsByDivision,     // team shells kept (even if empty); rosters reduced to active players
  activeLockedPlayerIds,        // per-player lock OR manual assignment in review/published/locked
  unassignedPlayersByDivision,  // late arrivals + players who moved divisions (need placement here)
  droppedPlayersByDivision,     // in snapshot, no longer registered
  changedDivisionPlayers,       // [{ playerId, fromDivision, toDivision }]
  orphanedSnapshotPlayers,
  coachDeltas,                  // [{ teamId, division, coachId, coachDropped, droppedAssistantCoachIds }]
  diagnostics,
}
```

These are not wired into `generateTeams` yet (PR 04). `coachDeltas` is **detection only** —
continuity and backfill land in PR 06.

---

## 6b. Implemented in PR 03 — typed assignment units

PR 03 extracted the generator's implicit "a unit is an array of players" model into a typed
`packages/core/src/assignmentUnits.js` (no behavior change — the characterization and existing
generation tests pass unchanged):

```js
buildAssignmentUnits(players) => { units: AssignmentUnit[], buddyDiagnostics }
createAssignmentUnit(init)   => AssignmentUnit   // factory with defaults
getSkillRating(player) / calculateUnitSkill(players)
```

Each `AssignmentUnit` is `{ id, type, players, targetTeamId, coachId, assistantCoachIds, locked,
hardConstraints, softConstraints, skillTotal, diagnostics }`. Fresh generation emits only
`'general' | 'mutual-buddy' | 'coach' | 'assistant'` units; `'targeted-buddy'` and `'locked'` are
reserved for snapshot-aware placement (PR 04/05). `generateTeams` partitions units by `type` and
feeds `unit.players` into the unchanged placement / scoring helpers.

---

## 7. PR sequence

| PR  | Title                                       | New modules (core)                        | Touches `generateTeams`? |
| --- | ------------------------------------------- | ----------------------------------------- | ------------------------ |
| 01  | Foundation & characterization               | — (docs + tests + fixtures)               | No                       |
| 02  | Snapshot normalization & delta core         | `teamSnapshot.js`, `teamDelta.js`         | No (exports only)        |
| 03  | Typed assignment units                      | `assignmentUnits.js`                       | Internal refactor only   |
| 04  | Structural stability & incremental gen      | —                                          | Yes (additive params)    |
| 05  | Buddy normalization & historical routing    | `buddyLinking.js`                          | Yes                      |
| 06  | Coach continuity & assistant backfill       | `coachContinuity.js`                       | Yes                      |
| 07  | Change diagnostics & summaries              | —                                          | Yes (output only)        |
| 08  | Frontend & persistence integration          | — (frontend + persistence)                 | No (consumer side)       |
| 09  | E2E hardening sweep, docs, interaction audit| —                                          | No                       |

---

## 8. Risk register

| Risk                                                                   | Mitigation                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Re-run silently discards manual moves or published team IDs            | Preserve UUIDs end-to-end (PR 08); honor `assignment_source: 'manual'` as locked.            |
| Fresh-path regression while adding incremental branches                | Characterization suite (§4) + `auto`/no-snapshot defaults; assert byte-identical fresh runs. |
| Partial persistence payload deletes preserved `team_players` rows      | PR 08 sends a **full authoritative** snapshot; add tests asserting no preserved rows dropped.|
| Core picks up Supabase/React imports during integration                | Keep snapshot/delta/buddy/coach helpers pure; integration lives in frontend/persistence.     |
| Coach identity collapsed across distinct team requests                 | Explicit replacement evidence only (`coachReplacementMap` / household key); diagnose ambiguity.|
| Buddy field name drift (`buddyId` / `buddy_id` / `mutual_buddy_code`)  | Canonicalize once in `buddyLinking.js`; reuse in `useConflicts` (PR 05).                     |
| Late buddy/coach changes reshuffle published rosters                   | Never reshuffle locked/published players; route to capacity or overflow with a reason.        |

---

## 9. Definition of done for the effort

- Fresh (no-snapshot) generation is provably unchanged (characterization suite stays green).
- Incremental generation preserves team IDs, shells, manual locks, and coach assignments.
- Structured diagnostics describe every preserved / late / dropped / overflowed decision.
- Core remains free of frontend/Supabase imports.
- Each phase ships with tests and updated docs.
