import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import FieldColumn from './FieldColumn.jsx';

/**
 * GameScheduleGrid — the main interactive scheduling surface.
 *
 * Renders a horizontal grid of FieldColumns (one per field), each containing
 * a vertical stack of TimeSlotDropZones. The DndContext lives in the parent
 * GameSchedulingPage (following the RosterManager pattern where DndContext
 * wraps the grid and DragOverlay is a sibling).
 *
 * This component's primary job is:
 * 1. Derive `assignmentsBySlot` per field from the flat assignments array
 * 2. Extract unique time slots from assignments for the row structure
 * 3. Route validation state to the correct FieldColumn/cell
 */
export default function GameScheduleGrid({
  assignments = [],
  fields = [],
  timeSlots = [],
  teams = [],
  conflictSet = undefined,
  validationResult = undefined,
  activeGameId = undefined,
  isDragDisabled = false,
  timezone = undefined,
}) {
  /**
   * Build a lookup: { [fieldId]: { [slotId]: assignment } }
   * Each field+slot holds at most one game.
   */
  const assignmentsByField = useMemo(() => {
    const map = {};
    for (const field of fields) {
      map[field.id] = {};
    }
    for (const a of assignments) {
      const fieldId = String(a.fieldId);
      if (!map[fieldId]) map[fieldId] = {};
      map[fieldId][a.slotId] = a;
    }
    return map;
  }, [assignments, fields]);

  if (fields.length === 0) {
    return (
      <div
        className="text-center text-text-muted py-12 bg-bg-surface rounded-lg border border-border-subtle border-dashed"
        data-testid="grid-empty"
      >
        No fields configured. Add fields in Field Management to enable the schedule grid.
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 min-w-[800px]"
      style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(220px, 1fr))` }}
      data-testid="game-schedule-grid"
    >
      {fields.map((field) => (
        <FieldColumn
          key={field.id}
          field={field}
          timeSlots={timeSlots}
          assignmentsBySlot={assignmentsByField[field.id] || {}}
          conflictSet={conflictSet}
          validationResult={validationResult}
          activeGameId={activeGameId}
          isDragDisabled={isDragDisabled}
          timezone={timezone}
        />
      ))}
    </div>
  );
}

GameScheduleGrid.propTypes = {
  assignments: PropTypes.array,
  fields: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
    })
  ),
  timeSlots: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string,
    })
  ),
  teams: PropTypes.array,
  conflictSet: PropTypes.instanceOf(Set),
  validationResult: PropTypes.shape({
    valid: PropTypes.bool,
    reason: PropTypes.string,
    targetFieldId: PropTypes.string,
    targetSlotId: PropTypes.string,
  }),
  activeGameId: PropTypes.string,
  isDragDisabled: PropTypes.bool,
  timezone: PropTypes.string,
};
