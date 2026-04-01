import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DndContext } from '@dnd-kit/core';
import TimeSlotDropZone from '../frontend/src/components/scheduling/TimeSlotDropZone.jsx';

function DndWrapper({ children }) {
  return <DndContext>{children}</DndContext>;
}

const ASSIGNMENT = {
  id: 'ga-1',
  slotId: 'gs-1',
  homeTeamId: 'team-1',
  awayTeamId: 'team-2',
  start: '2026-04-04T08:00:00Z',
  end: '2026-04-04T09:00:00Z',
  fieldId: 'v1',
  division: 'U10',
  assignmentSource: 'auto',
};

describe('TimeSlotDropZone', () => {
  test('renders with correct data-testid', () => {
    render(
      <DndWrapper>
        <TimeSlotDropZone fieldId="v1" slotId="gs-1" />
      </DndWrapper>
    );
    expect(screen.getByTestId('drop-zone-v1:gs-1')).toBeInTheDocument();
  });

  test('shows empty placeholder when no assignment', () => {
    render(
      <DndWrapper>
        <TimeSlotDropZone fieldId="v1" slotId="gs-1" />
      </DndWrapper>
    );
    expect(screen.getByTestId('empty-slot-v1:gs-1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  test('renders GameCard when assignment is provided', () => {
    render(
      <DndWrapper>
        <TimeSlotDropZone fieldId="v1" slotId="gs-1" assignment={ASSIGNMENT} />
      </DndWrapper>
    );
    expect(screen.getByTestId('game-card-ga-1')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-slot-v1:gs-1')).not.toBeInTheDocument();
  });

  test('renders slot label when provided', () => {
    render(
      <DndWrapper>
        <TimeSlotDropZone fieldId="v1" slotId="gs-1" slotLabel="8:00 AM" />
      </DndWrapper>
    );
    expect(screen.getByText('8:00 AM')).toBeInTheDocument();
  });

  test('does not render slot label when empty', () => {
    const { container } = render(
      <DndWrapper>
        <TimeSlotDropZone fieldId="v1" slotId="gs-1" />
      </DndWrapper>
    );
    // No label div should be rendered
    const labelDivs = container.querySelectorAll('.font-mono.uppercase');
    expect(labelDivs.length).toBe(0);
  });

  test('passes hasConflict to GameCard when assignment is in conflictSet', () => {
    const conflictSet = new Set(['ga-1']);
    render(
      <DndWrapper>
        <TimeSlotDropZone
          fieldId="v1"
          slotId="gs-1"
          assignment={ASSIGNMENT}
          conflictSet={conflictSet}
        />
      </DndWrapper>
    );
    const card = screen.getByTestId('game-card-ga-1');
    expect(card.className).toContain('border-status-error');
  });

  test('GameCard has no conflict styling when not in conflictSet', () => {
    const conflictSet = new Set(['ga-other']);
    render(
      <DndWrapper>
        <TimeSlotDropZone
          fieldId="v1"
          slotId="gs-1"
          assignment={ASSIGNMENT}
          conflictSet={conflictSet}
        />
      </DndWrapper>
    );
    const card = screen.getByTestId('game-card-ga-1');
    expect(card.className).not.toContain('border-status-error');
  });

  test('shows valid indicator styling when isValidTarget', () => {
    // Note: isOver from useDroppable won't be true in unit tests without actual drag,
    // but we can still verify the props are accepted without error.
    // Full drag validation is tested in E2E.
    render(
      <DndWrapper>
        <TimeSlotDropZone fieldId="v1" slotId="gs-1" isValidTarget={true} />
      </DndWrapper>
    );
    // Component renders without error
    expect(screen.getByTestId('drop-zone-v1:gs-1')).toBeInTheDocument();
  });

  test('passes isDragDisabled to child GameCard', () => {
    render(
      <DndWrapper>
        <TimeSlotDropZone
          fieldId="v1"
          slotId="gs-1"
          assignment={ASSIGNMENT}
          isDragDisabled={true}
        />
      </DndWrapper>
    );
    const card = screen.getByTestId('game-card-ga-1');
    expect(card.className).toContain('cursor-default');
  });
});
