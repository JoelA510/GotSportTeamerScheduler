import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DndContext } from '@dnd-kit/core';
import GameScheduleGrid from '../frontend/src/components/scheduling/GameScheduleGrid.jsx';

function DndWrapper({ children }) {
  return <DndContext>{children}</DndContext>;
}

const FIELDS = [
  { id: 'v1', name: 'Field A', surface_type: 'Grass', size: '11v11' },
  { id: 'v2', name: 'Field B', surface_type: 'Turf', size: '7v7' },
];

const TIME_SLOTS = [
  { id: 'gs-1', label: '8:00 AM', start: '2026-04-04T08:00:00Z' },
  { id: 'gs-2', label: '9:30 AM', start: '2026-04-04T09:30:00Z' },
];

const ASSIGNMENTS = [
  {
    id: 'ga-1',
    slotId: 'gs-1',
    fieldId: 'v1',
    homeTeamId: 'team-1',
    awayTeamId: 'team-2',
    start: '2026-04-04T08:00:00Z',
    end: '2026-04-04T09:00:00Z',
    division: 'U10',
    assignmentSource: 'auto',
  },
  {
    id: 'ga-2',
    slotId: 'gs-2',
    fieldId: 'v2',
    homeTeamId: 'team-3',
    awayTeamId: 'team-4',
    start: '2026-04-04T09:30:00Z',
    end: '2026-04-04T10:30:00Z',
    division: 'U10',
    assignmentSource: 'auto',
  },
];

describe('GameScheduleGrid', () => {
  test('renders the grid container with correct testid', () => {
    render(
      <DndWrapper>
        <GameScheduleGrid fields={FIELDS} timeSlots={TIME_SLOTS} assignments={ASSIGNMENTS} />
      </DndWrapper>
    );
    expect(screen.getByTestId('game-schedule-grid')).toBeInTheDocument();
  });

  test('renders a FieldColumn for each field', () => {
    render(
      <DndWrapper>
        <GameScheduleGrid fields={FIELDS} timeSlots={TIME_SLOTS} assignments={ASSIGNMENTS} />
      </DndWrapper>
    );
    expect(screen.getByTestId('field-column-v1')).toBeInTheDocument();
    expect(screen.getByTestId('field-column-v2')).toBeInTheDocument();
  });

  test('renders field names', () => {
    render(
      <DndWrapper>
        <GameScheduleGrid fields={FIELDS} timeSlots={TIME_SLOTS} assignments={ASSIGNMENTS} />
      </DndWrapper>
    );
    expect(screen.getByText('Field A')).toBeInTheDocument();
    expect(screen.getByText('Field B')).toBeInTheDocument();
  });

  test('renders TimeSlotDropZones for each field × slot combination', () => {
    render(
      <DndWrapper>
        <GameScheduleGrid fields={FIELDS} timeSlots={TIME_SLOTS} assignments={ASSIGNMENTS} />
      </DndWrapper>
    );
    // 2 fields × 2 slots = 4 drop zones
    expect(screen.getByTestId('drop-zone-v1:gs-1')).toBeInTheDocument();
    expect(screen.getByTestId('drop-zone-v1:gs-2')).toBeInTheDocument();
    expect(screen.getByTestId('drop-zone-v2:gs-1')).toBeInTheDocument();
    expect(screen.getByTestId('drop-zone-v2:gs-2')).toBeInTheDocument();
  });

  test('places assignments in the correct field+slot cells', () => {
    render(
      <DndWrapper>
        <GameScheduleGrid fields={FIELDS} timeSlots={TIME_SLOTS} assignments={ASSIGNMENTS} />
      </DndWrapper>
    );
    // ga-1 should be in v1:gs-1
    expect(screen.getByTestId('game-card-ga-1')).toBeInTheDocument();
    // ga-2 should be in v2:gs-2
    expect(screen.getByTestId('game-card-ga-2')).toBeInTheDocument();
    // v1:gs-2 and v2:gs-1 should be empty
    expect(screen.getByTestId('empty-slot-v1:gs-2')).toBeInTheDocument();
    expect(screen.getByTestId('empty-slot-v2:gs-1')).toBeInTheDocument();
  });

  test('shows empty state when no fields provided', () => {
    render(
      <DndWrapper>
        <GameScheduleGrid fields={[]} timeSlots={TIME_SLOTS} assignments={ASSIGNMENTS} />
      </DndWrapper>
    );
    expect(screen.getByTestId('grid-empty')).toBeInTheDocument();
    expect(screen.getByText(/No fields configured/)).toBeInTheDocument();
  });

  test('renders with empty assignments (all slots empty)', () => {
    render(
      <DndWrapper>
        <GameScheduleGrid fields={FIELDS} timeSlots={TIME_SLOTS} assignments={[]} />
      </DndWrapper>
    );
    // All 4 slots should show empty placeholders
    expect(screen.getByTestId('empty-slot-v1:gs-1')).toBeInTheDocument();
    expect(screen.getByTestId('empty-slot-v1:gs-2')).toBeInTheDocument();
    expect(screen.getByTestId('empty-slot-v2:gs-1')).toBeInTheDocument();
    expect(screen.getByTestId('empty-slot-v2:gs-2')).toBeInTheDocument();
  });

  test('grid columns match number of fields', () => {
    render(
      <DndWrapper>
        <GameScheduleGrid fields={FIELDS} timeSlots={TIME_SLOTS} assignments={ASSIGNMENTS} />
      </DndWrapper>
    );
    const grid = screen.getByTestId('game-schedule-grid');
    expect(grid.style.gridTemplateColumns).toContain('repeat(2');
  });
});
