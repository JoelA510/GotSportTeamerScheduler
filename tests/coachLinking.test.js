import { test } from 'vitest';
import assert from 'node:assert/strict';
import { linkCoachesToPlayers } from '../packages/core/src/coachLinking.js';

test('links a coach to their child via player_id', () => {
  const players = [
    { id: 'p1', division: 'U10B' },
    { id: 'p2', division: 'U10B' },
  ];
  const coaches = [{ id: 'coachA', player_id: 'p1' }];
  const { players: out, diagnostics } = linkCoachesToPlayers({ players, coaches });
  assert.equal(out.find((p) => p.id === 'p1').coachId, 'coachA');
  assert.equal(out.find((p) => p.id === 'p2').coachId, undefined);
  assert.equal(diagnostics.linkedPlayers, 1);
  assert.equal(diagnostics.linkedCoaches.length, 1);
});

test('imported coach link overrides a willing_to_coach-derived coachId', () => {
  const players = [{ id: 'p1', division: 'U10B', coachId: 'coach-p1' }];
  const coaches = [{ id: 'coachA', player_id: 'p1' }];
  const { players: out } = linkCoachesToPlayers({ players, coaches });
  assert.equal(out[0].coachId, 'coachA');
});

test('overrideExisting=false preserves an existing coachId', () => {
  const players = [{ id: 'p1', division: 'U10B', coachId: 'coach-p1' }];
  const coaches = [{ id: 'coachA', player_id: 'p1' }];
  const { players: out } = linkCoachesToPlayers({ players, coaches, overrideExisting: false });
  assert.equal(out[0].coachId, 'coach-p1');
});

test('multi-team coach with two children links both and is flagged', () => {
  const players = [
    { id: 'p1', division: 'U10B' },
    { id: 'p2', division: 'U12B' },
  ];
  const coaches = [
    {
      id: 'coachA',
      can_coach_multiple_teams: true,
      children: [{ player_id: 'p1' }, { player_id: 'p2' }],
    },
  ];
  const { players: out, diagnostics } = linkCoachesToPlayers({ players, coaches });
  assert.equal(out.find((p) => p.id === 'p1').coachId, 'coachA');
  assert.equal(out.find((p) => p.id === 'p2').coachId, 'coachA');
  assert.equal(diagnostics.multiTeamCoaches.length, 1);
});

test('coach whose child is not in the roster is reported as unlinked', () => {
  const players = [{ id: 'p1', division: 'U10B' }];
  const coaches = [{ id: 'coachA', player_id: 'ghost' }];
  const { players: out, diagnostics } = linkCoachesToPlayers({ players, coaches });
  assert.equal(out[0].coachId, undefined);
  assert.equal(diagnostics.unlinkedCoaches.length, 1);
});

test('preferred co-coach is attached as the assistant coach', () => {
  const players = [{ id: 'p1', division: 'U10B' }];
  const coaches = [{ id: 'coachA', player_id: 'p1', preferred_co_coach_id: 'coachB' }];
  const { players: out } = linkCoachesToPlayers({ players, coaches });
  assert.equal(out[0].coachId, 'coachA');
  assert.equal(out[0].assistantCoachId, 'coachB');
});
