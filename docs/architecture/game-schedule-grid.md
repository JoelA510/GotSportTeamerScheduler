[← Back to Documentation Index](docs/README.md)
---

# Phase 2: GameScheduleGrid — Component Architecture Design

> [!NOTE]
> **STATUS: IMPLEMENTED** — All components described in this architecture document have been built and are live. This document is preserved as an Architecture Decision Record (ADR) capturing the design rationale and component strategy.

**Date:** March 30, 2026
**Task:** 2.1 (Opus 4.6)
**Prerequisite:** Phase 1 CI/CD complete — all changes validated by GitHub Actions pipeline

---

## 1. Implementation Status

All 5 planned components have been built and are operational in `frontend/src/components/scheduling/`:

| Component            | File                     | Status         |
| -------------------- | ------------------------ | -------------- |
| `GameConflictBanner` | `GameConflictBanner.jsx` | ✅ Implemented |
| `GameScheduleGrid`   | `GameScheduleGrid.jsx`   | ✅ Implemented |
| `FieldColumn`        | `FieldColumn.jsx`        | ✅ Implemented |
| `TimeSlotDropZone`   | `TimeSlotDropZone.jsx`   | ✅ Implemented |
| `GameCard`           | `GameCard.jsx`           | ✅ Implemented |

`GameSchedulingPage.jsx` has been extended with the full DndContext integration, edit mode toggle, and real-time validation. Unit tests exist for all new components.

**Existing infrastructure we build on:**

| Asset                                   | Location                             | What it gives us                                                                                                                      |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `gameScheduling.js` (778 lines)         | `packages/core/src/`                 | Round-robin generation, slot allocation, coach conflict detection                                                                     |
| `gameMetrics.js` (444 lines)            | `packages/core/src/`                 | `evaluateGameSchedule()` — field overlap, coach conflict, team double-booking detection                                               |
| `RosterManager.jsx` (329 lines)         | `frontend/src/components/teaming/`   | Proven `@dnd-kit` pattern: DndContext + closestCorners + SortableContext + DragOverlay + cross-container moves + Supabase persistence |
| `PracticeSchedulingPage.jsx` (64 lines) | `frontend/src/pages/`                | Read-only ↔ edit mode toggle pattern                                                                                                  |
| `useGameAssignments.js` (45 lines)      | `frontend/src/hooks/`                | Fetches `game_assignments` by `run_id`, maps to camelCase                                                                             |
| `TeamScheduleView.jsx` (68 lines)       | `frontend/src/components/`           | Per-team game list (becomes the read-only fallback)                                                                                   |
| Mock Supabase client                    | `frontend/src/lib/supabaseClient.js` | In-memory CRUD with sessionStorage isolation for E2E                                                                                  |

---

## 2. Target Component Tree

```
GameSchedulingPage.jsx (EXTEND — add edit mode toggle + grid view)
├── GameReadinessPanel (EXISTING — no changes needed)
├── GameConflictBanner (NEW)
│   └── ConflictItem (NEW — individual conflict row)
├── GameScheduleGrid (NEW — main interactive area, shown in edit mode)
│   ├── FieldColumn (NEW — one droppable column per field)
│   │   ├── TimeSlotDropZone (NEW — droppable zone per time slot within a field)
│   │   │   └── GameCard (NEW — draggable card for a single game assignment)
│   │   └── EmptySlotIndicator (inline — dashed border placeholder)
│   └── DragOverlay → GameCardPreview (NEW — ghost card during drag)
└── TeamScheduleView (EXISTING — read-only fallback, shown when not in edit mode)
```

---

## 3. Data Flow

### 3.1 State Ownership

`GameSchedulingPage` owns all scheduling state. Child components are stateless renderers + event emitters.

```
GameSchedulingPage
│
├── State:
│   ├── assignments: GameAssignment[]     ← from useGameAssignments(runId)
│   ├── conflicts: Conflict[]             ← computed via evaluateGameSchedule()
│   ├── isEditMode: boolean               ← toggle (mirrors PracticeSchedulingPage)
│   ├── activeGame: GameAssignment | null  ← currently dragged game
│   └── validationResult: { valid, reason } | null  ← real-time dragOver feedback
│
├── Derived:
│   ├── assignmentsByFieldAndSlot: Map<fieldId, Map<slotKey, GameAssignment[]>>
│   └── conflictSet: Set<assignmentId>    ← quick lookup for red-border styling
│
└── Callbacks:
    ├── handleDragStart(event)  → set activeGame
    ├── handleDragOver(event)   → validate target slot, set validationResult
    ├── handleDragEnd(event)    → persist move or rollback
    └── handleToggleMode()      → flip isEditMode
```

### 3.2 Assignment Shape

```typescript
interface GameAssignment {
  id: string; // assignment UUID
  slotId: string; // game_slot FK
  weekIndex: number;
  start: string; // ISO datetime
  end: string; // ISO datetime
  homeTeamId: string;
  awayTeamId: string;
  fieldId: string;
  division: string;
  assignmentSource: 'auto' | 'manual'; // manual flag for overrides
}
```

### 3.3 Grid Layout Model

The grid is **Fields (columns) × Time Slots (rows)**. This matches the physical reality (admin is looking at Saturday's fields and deciding which games go where).

```
              Field A          Field B          Field C
  ┌──────────────────┬──────────────────┬──────────────────┐
  │  8:00–9:00       │  8:00–9:00       │  8:00–9:00       │
  │  [GameCard]      │  [GameCard]      │  [empty]         │
  ├──────────────────┼──────────────────┼──────────────────┤
  │  9:30–10:30      │  9:30–10:30      │  9:30–10:30      │
  │  [GameCard]      │  [empty]         │  [GameCard]       │
  ├──────────────────┼──────────────────┼──────────────────┤
  │  11:00–12:00     │  11:00–12:00     │  11:00–12:00     │
  │  [GameCard] ⚠️   │  [GameCard] ⚠️   │  [empty]         │
  └──────────────────┴──────────────────┴──────────────────┘
                       ⚠️ = conflict (same coach)
```

Each cell is uniquely identified by `fieldId:slotKey` (e.g., `"v1:2026-04-05T08:00"`). This composite key is the `@dnd-kit` droppable container ID.

---

## 4. @dnd-kit Integration Strategy

### 4.1 Why closestCorners (Not rectIntersection)

RosterManager uses `closestCorners` and it works well for proximity-based targeting. For the grid layout, `closestCorners` also performs correctly because each `TimeSlotDropZone` is a distinct bounded rectangle — the drag pointer naturally hits the nearest cell corner. No custom collision detection needed.

### 4.2 Container Strategy

Unlike RosterManager (where each column is both a `SortableContext` and items are sortable within), the game grid is simpler: **games don't need to be sortable within a slot** (each slot holds at most one game per field). This means we use `useDroppable` for `TimeSlotDropZone` rather than `SortableContext`.

```
DndContext (closestCorners)
├── FieldColumn (presentational wrapper, not droppable itself)
│   ├── TimeSlotDropZone (useDroppable, id = "v1:2026-04-05T08:00")
│   │   └── GameCard (useDraggable, id = assignment.id)
│   ├── TimeSlotDropZone (useDroppable, id = "v1:2026-04-05T09:30")
│   │   └── GameCard (useDraggable, id = assignment.id)
│   └── ...
├── FieldColumn
│   └── ...
└── DragOverlay
    └── GameCardPreview (static preview of activeGame)
```

### 4.3 Drag Lifecycle

**`handleDragStart(event)`**

1. Find the assignment matching `event.active.id`
2. Set `activeGame` → triggers DragOverlay to show GameCardPreview
3. Add `dragging` CSS class to source card (opacity reduction, like RosterManager)

**`handleDragOver(event)`**
Real-time validation as the user hovers over potential drop targets:

1. Parse `event.over.id` → extract `targetFieldId` and `targetSlotKey`
2. Call validation functions from `gameMetrics.js`:
   - `isFieldAvailable(targetFieldId, targetSlotKey, assignments, activeGame.id)` — is another game already there?
   - `hasCoachConflict(activeGame, targetSlotKey, assignments)` — does this team's coach have an overlapping game?
3. Set `validationResult = { valid: true/false, reason: string }`
4. `TimeSlotDropZone` reads validationResult and shows:
   - Green border + checkmark if valid
   - Red border + X if invalid
   - No indicator for cells not being hovered

**`handleDragEnd(event)`**

1. Clear `activeGame` and `validationResult`
2. If `!event.over` or validation failed → no-op (card snaps back via @dnd-kit default)
3. If valid drop:
   a. **Optimistic UI:** Immediately update local `assignments` state (move game to new slot)
   b. **Persist:** Call `supabase.from('game_assignments').update({ slot_id, field_id, start, end, assignment_source: 'manual' }).eq('id', assignment.id)`
   c. **On error:** Roll back local state to pre-drag snapshot, show toast notification
4. Recompute conflicts via `evaluateGameSchedule()`

### 4.4 Validation Functions (New, in packages/core)

These are thin wrappers around `gameMetrics.js` logic, extracted for drag-time use:

```javascript
// packages/core/src/gameValidation.js

/**
 * Check if a field+slot combination is available for a game assignment.
 * Excludes the assignment being moved (so it doesn't conflict with itself).
 */
export function isSlotAvailable(fieldId, slotKey, assignments, excludeAssignmentId) {
  return !assignments.some(
    (a) => a.id !== excludeAssignmentId && a.fieldId === fieldId && a.slotId === slotKey
  );
}

/**
 * Check if moving a game to a new slot would create a coach conflict.
 * A coach conflict exists when the same coach has two games with overlapping times.
 */
export function hasCoachConflict(game, targetStart, targetEnd, assignments, teams) {
  const homeTeam = teams.find((t) => t.id === game.homeTeamId);
  const awayTeam = teams.find((t) => t.id === game.awayTeamId);
  const coachIds = [homeTeam?.coachId, awayTeam?.coachId].filter(Boolean);

  return assignments.some((a) => {
    if (a.id === game.id) return false;
    const aHome = teams.find((t) => t.id === a.homeTeamId);
    const aAway = teams.find((t) => t.id === a.awayTeamId);
    const aCoachIds = [aHome?.coachId, aAway?.coachId].filter(Boolean);

    const hasSharedCoach = coachIds.some((c) => aCoachIds.includes(c));
    if (!hasSharedCoach) return false;

    // Check time overlap
    const aStart = new Date(a.start).getTime();
    const aEnd = new Date(a.end).getTime();
    const tStart = new Date(targetStart).getTime();
    const tEnd = new Date(targetEnd).getTime();
    return tStart < aEnd && tEnd > aStart;
  });
}
```

---

## 5. New Components — Specification

### 5.1 GameConflictBanner

**File:** `frontend/src/components/GameConflictBanner.jsx`
**Props:** `{ conflicts: Conflict[], onConflictClick?: (assignmentId) => void }`

Mirrors the RosterManager conflict banner pattern (red bg, ShieldAlert icon, expandable list). Each conflict row shows:

- Conflict type badge (field-overlap / coach-conflict / team-double-booking)
- Affected teams and time slots
- Severity indicator (red for hard conflicts, amber for warnings)

Optional `onConflictClick` scrolls the grid to highlight the conflicting game card.

### 5.2 GameScheduleGrid

**File:** `frontend/src/components/scheduling/GameScheduleGrid.jsx`
**Props:** `{ assignments, fields, timeSlots, teams, onAssignmentMove, conflicts }`

The grid container. Computes `assignmentsByFieldAndSlot` from the flat assignments array. Renders `FieldColumn` for each field. Contains no @dnd-kit code itself — that lives in the parent page (following the RosterManager pattern where DndContext wraps the grid).

### 5.3 FieldColumn

**File:** `frontend/src/components/scheduling/FieldColumn.jsx`
**Props:** `{ field, timeSlots, assignments, conflictSet, validationResult, activeGameId }`

Presentational column with the field name header and a vertical stack of `TimeSlotDropZone`s.

### 5.4 TimeSlotDropZone

**File:** `frontend/src/components/scheduling/TimeSlotDropZone.jsx`
**Props:** `{ slotId, fieldId, assignment?, isValidTarget, isInvalidTarget }`

Uses `useDroppable({ id: \`${fieldId}:${slotId}\` })`. Shows:

- The contained `GameCard` if an assignment exists
- An empty dashed placeholder otherwise
- Green border when `isValidTarget` (valid drop hover)
- Red border + reason tooltip when `isInvalidTarget`

### 5.5 GameCard

**File:** `frontend/src/components/scheduling/GameCard.jsx`
**Props:** `{ assignment, hasConflict, isDragging }`

Uses `useDraggable({ id: assignment.id, data: assignment })`. Displays:

- Home team vs Away team
- Time range
- Division badge
- Manual override badge (if `assignmentSource === 'manual'`)
- Red border glow if `hasConflict`
- `data-testid={`game-card-${assignment.id}`}` for E2E targeting

### 5.6 GameCardPreview

**File:** Inline within `GameScheduleGrid.jsx` or separate
**Used in:** `<DragOverlay>` — the ghost card shown during drag

Simplified version of GameCard with slight rotation and shadow (same visual treatment as RosterManager's drag overlay: `opacity-90 scale-105 rotate-2`).

---

## 6. GameSchedulingPage Modifications

The existing 59-line page gets extended with the edit mode toggle and DndContext:

```jsx
export default function GameSchedulingPage() {
  // Existing state
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const { game, team } = useDashboardData();
  const { timezone } = useTheme();

  // NEW state
  const [isEditMode, setIsEditMode] = useState(false);
  const [assignments, setAssignments] = useState(game.assignments || []);
  const [activeGame, setActiveGame] = useState(null);
  const [validationResult, setValidationResult] = useState(null);

  // NEW derived
  const teams = team.teams || [];
  const fields = /* from useDashboardData or separate hook */;
  const timeSlots = /* unique slots derived from assignments */;
  const { warnings: conflicts } = evaluateGameSchedule({ assignments, teams, ... });
  const conflictSet = new Set(conflicts.flatMap(c => c.assignmentIds || []));

  // NEW sensors (same as RosterManager)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  return (
    <div>
      {/* Header with edit toggle (mirrors PracticeSchedulingPage) */}
      {/* GameReadinessPanel (existing) */}
      {/* GameConflictBanner (NEW - shown when conflicts exist) */}

      {isEditMode ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <GameScheduleGrid ... />
          <DragOverlay>{activeGame && <GameCardPreview game={activeGame} />}</DragOverlay>
        </DndContext>
      ) : (
        /* Existing team selector + TeamScheduleView */
      )}
    </div>
  );
}
```

---

## 7. Mock Data Requirements

The mock Supabase client needs two additions for E2E testing:

1. **`game_slots` seed data** — A set of time slots across multiple fields for one Saturday:

   ```javascript
   { id: 'gs-1', field_id: 'v1', start: '2026-04-04T08:00', end: '2026-04-04T09:00', capacity: 1 }
   { id: 'gs-2', field_id: 'v1', start: '2026-04-04T09:30', end: '2026-04-04T10:30', capacity: 1 }
   // ... more slots across v1, v2, v3
   ```

2. **`game_assignments` with a deliberate conflict** — Two games assigned to the same field+slot:
   ```javascript
   { id: 'ga-1', slot_id: 'gs-1', field_id: 'v1', home_team_id: 't1', away_team_id: 't2', start: '...', assignment_source: 'auto' }
   { id: 'ga-2', slot_id: 'gs-1', field_id: 'v1', home_team_id: 't3', away_team_id: 't4', start: '...', assignment_source: 'auto' }
   // ^^ Both on gs-1/v1 = field overlap conflict
   ```

---

## 8. E2E Test Strategy (Task 2.5 Preview)

The `@skipped` scenario becomes:

```gherkin
Scenario: Resolving game schedule conflicts
  Given I am on the Game Scheduling page viewing an identified conflict
  When I drag a game to a new time slot to resolve the conflict
  Then the system validates the new slot against field availability and coach schedules
  And updates the game schedule if the selected slot is valid
```

**Step implementation approach:**

1. **Given** — Navigate to Game Scheduling, enter edit mode, assert `GameConflictBanner` shows ≥1 conflict
2. **When** — Use `page.locator('[data-testid="game-card-ga-2"]').dragTo(page.locator('[data-testid="drop-zone-v2:gs-3"]'))` to move the conflicting game to an open slot on Field B
3. **Then (validates)** — Assert the green validation indicator appeared during drag (or assert no error toast)
4. **And (updates)** — Assert the conflict banner count decreased, the GameCard now appears in the new slot, and the mock DB was updated with `assignment_source: 'manual'`

---

## 9. File Creation Order (Build Sequence)

This ordering ensures each step is independently testable:

| Step | File(s)                                   | Depends On                 | Testable                               |
| ---- | ----------------------------------------- | -------------------------- | -------------------------------------- |
| 1    | `packages/core/src/gameValidation.js`     | gameMetrics.js             | Unit tests (pure functions)            |
| 2    | `GameConflictBanner.jsx` + `ConflictItem` | evaluateGameSchedule       | Unit test (render with mock conflicts) |
| 3    | `GameCard.jsx`                            | —                          | Unit test (render with props)          |
| 4    | `TimeSlotDropZone.jsx`                    | @dnd-kit/core              | Unit test (droppable state)            |
| 5    | `FieldColumn.jsx`                         | TimeSlotDropZone, GameCard | Unit test (renders slots)              |
| 6    | `GameScheduleGrid.jsx`                    | FieldColumn                | Unit test (grid assembly)              |
| 7    | `GameSchedulingPage.jsx` (extend)         | All above + DndContext     | E2E test (full drag flow)              |
| 8    | Mock data seed                            | supabaseClient.js          | E2E test (conflict scenario)           |
| 9    | Unskip + implement E2E scenario           | All above                  | `npx playwright test` → 58/58          |

---

## 10. Risks & Mitigations

| Risk                                                | Mitigation                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@dnd-kit` drag simulation unreliable in Playwright | Use `page.locator().dragTo()` with explicit `{ targetPosition }` offsets; fallback to manual `page.dispatchEvent()` sequence                         |
| Grid layout breaks on mobile/small screens          | Not a Phase 2 concern — admin scheduling is desktop-only. Add `min-w-[800px]` with horizontal scroll wrapper                                         |
| Large slot counts cause performance issues          | Unlikely for youth soccer (3-5 fields × 4-6 slots = max 30 cells). If needed, virtualize later                                                       |
| `useDraggable` vs `useSortable` confusion           | We use `useDraggable` for GameCards (no within-slot ordering) and `useDroppable` for TimeSlotDropZones. This is simpler than RosterManager's pattern |
| Optimistic UI rollback edge cases                   | Snapshot assignments before drag, restore on persistence failure. Simple since we're updating one row                                                |

---

## 11. Decision Log

| Decision                                            | Rationale                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Fields as columns, time as rows                     | Matches physical field layout admins think in. Columns scale horizontally (3-5 fields typical) |
| `useDroppable` not `SortableContext` for slots      | Each slot holds 0 or 1 game per field — no intra-slot sorting needed                           |
| Validation on `dragOver` not `dragEnd`              | Immediate visual feedback prevents wasted drops. User sees green/red before releasing          |
| `evaluateGameSchedule()` for conflict recomputation | Already built, battle-tested, and covers all three conflict types                              |
| DndContext on page, not inside grid                 | Follows RosterManager pattern. DragOverlay must be a sibling of the grid, not nested inside it |
| Keep TeamScheduleView as read-only fallback         | Zero-risk path for users who just want to see their team's games without editing               |
| New `gameValidation.js` in core package             | Keeps drag-time validation logic pure and unit-testable, separate from UI                      |
