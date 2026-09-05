/**
 * The roster card's coach line, rendered.
 *
 * `RosterManager.TeamColumn` used to count only the *named* coaches to pick
 * "Coach" or "Coaches" while the text beside it counted every coach, so one
 * named coach with two id-only assistants read "Coach: Ada + 2 more". The
 * label now comes from `coachLabel()` in `utils/teamCoaches.js`, the same
 * producer the override picker uses; this file proves the card prints it.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';

import { TeamColumn } from '../frontend/src/components/teaming/RosterManager.jsx';

const column = (team) =>
  render(
    <DndContext>
      <TeamColumn team={team} players={[]} />
    </DndContext>
  );

describe('RosterManager :: the coach line counts every coach', () => {
  it('pluralises by every coach on file, not by the ones it can name', () => {
    column({
      id: 't1',
      name: 'Blue Bears',
      division: 'U10',
      coach_id: 'a',
      coachName: 'Ada',
      assistant_coach_ids: ['b', 'c'],
    });
    expect(screen.getByText('Coaches: Ada + 2 more (2 names not loaded)')).toBeInTheDocument();
    expect(screen.queryByText(/^Coach: /)).toBeNull();
  });

  it('POSITIVE CONTROL: one coach is "Coach", and none is "Coach: Vacant"', () => {
    column({ id: 't2', name: 'Red Foxes', division: 'U10', coach_id: 'a', coachName: 'Ada' });
    expect(screen.getByText('Coach: Ada')).toBeInTheDocument();
    column({ id: 't3', name: 'Green Owls', division: 'U10' });
    expect(screen.getByText('Coach: Vacant')).toBeInTheDocument();
  });
});
