import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildAssignmentUnits,
  createAssignmentUnit,
  calculateUnitSkill,
  getSkillRating,
} from '../packages/core/src/assignmentUnits.js';

test('createAssignmentUnit fills defaults and derives an id from player ids', () => {
  const unit = createAssignmentUnit({ players: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(unit.id, 'a+b');
  assert.equal(unit.type, 'general');
  assert.equal(unit.coachId, null);
  assert.deepEqual(unit.assistantCoachIds, []);
  assert.equal(unit.locked, false);
  assert.deepEqual(unit.hardConstraints, []);
  assert.deepEqual(unit.softConstraints, []);
  assert.equal(unit.targetTeamId, null);
  assert.equal(unit.skillTotal, 0);
  assert.deepEqual(unit.diagnostics, []);
});

test('getSkillRating and calculateUnitSkill sum finite skillRatings, defaulting to 0', () => {
  assert.equal(getSkillRating({ skillRating: 4 }), 4);
  assert.equal(getSkillRating({ skillRating: 'x' }), 0);
  assert.equal(getSkillRating({}), 0);
  assert.equal(calculateUnitSkill([{ skillRating: 3 }, { skillRating: 2 }, {}]), 5);
});

test('buildAssignmentUnits creates a general unit for a single player', () => {
  const { units } = buildAssignmentUnits([{ id: 'solo', division: 'U10', skillRating: 3 }]);
  assert.equal(units.length, 1);
  assert.equal(units[0].type, 'general');
  assert.deepEqual(
    units[0].players.map((p) => p.id),
    ['solo']
  );
  assert.equal(units[0].skillTotal, 3);
});

test('buildAssignmentUnits pairs reciprocal buddies into one mutual-buddy unit', () => {
  const { units, buddyDiagnostics } = buildAssignmentUnits([
    { id: 'a', division: 'U10', buddyId: 'b' },
    { id: 'b', division: 'U10', buddyId: 'a' },
  ]);

  assert.equal(units.length, 1);
  assert.equal(units[0].type, 'mutual-buddy');
  assert.deepEqual(
    units[0].players.map((p) => p.id),
    ['a', 'b']
  );
  assert.deepEqual(buddyDiagnostics.mutualPairs, [{ playerIds: ['a', 'b'] }]);
});

test('buildAssignmentUnits leaves a one-sided buddy request unpaired and diagnoses it', () => {
  const { units, buddyDiagnostics } = buildAssignmentUnits([
    { id: 'a', division: 'U10', buddyId: 'b' },
    { id: 'b', division: 'U10' },
  ]);

  assert.equal(units.length, 2);
  assert.ok(units.every((u) => u.type === 'general'));
  assert.deepEqual(buddyDiagnostics.unmatchedRequests, [
    { playerId: 'a', requestedBuddyId: 'b', reason: 'not-reciprocated' },
  ]);
});

test('buildAssignmentUnits creates a coach unit carrying coachId', () => {
  const { units } = buildAssignmentUnits([{ id: 'a', division: 'U10', coachId: 'coach-1' }]);
  assert.equal(units.length, 1);
  assert.equal(units[0].type, 'coach');
  assert.equal(units[0].coachId, 'coach-1');
});

test('buildAssignmentUnits creates an assistant unit carrying assistantCoachIds', () => {
  const { units } = buildAssignmentUnits([
    { id: 'a', division: 'U10', assistantCoachId: 'asst-1' },
  ]);
  assert.equal(units.length, 1);
  assert.equal(units[0].type, 'assistant');
  assert.equal(units[0].coachId, null);
  assert.deepEqual(units[0].assistantCoachIds, ['asst-1']);
});

test('buildAssignmentUnits throws on a buddy pair with conflicting head coaches', () => {
  assert.throws(
    () =>
      buildAssignmentUnits([
        { id: 'a', division: 'U10', buddyId: 'b', coachId: 'coach-1' },
        { id: 'b', division: 'U10', buddyId: 'a', coachId: 'coach-2' },
      ]),
    /Conflicting coach assignments/
  );
});
