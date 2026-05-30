import { test } from 'vitest';
import assert from 'node:assert/strict';
import { prepareTeamingInput } from '../packages/core/src/teamingPipeline.js';
import { PLACEMENT } from '../packages/core/src/playUp.js';

const SEASON = 2026;
const MODE = 'birth_year';

const divisions = [
  { id: 'U9B', name: 'U9 Boys', minAge: 9, maxAge: 9, gender_policy: 'boys' },
  { id: 'U10B', name: 'U10 Boys', minAge: 10, maxAge: 10, gender_policy: 'boys' },
];

test('links coaches and sanctions a coach-child play-up in one pass', () => {
  const players = [
    // coach's child, age 9, registered up into U10B
    { id: 'p_child', division: 'U10B', dob: '2017-05-01' },
    // unrelated age-9 player registered up into U10B with no sanction
    { id: 'p_other', division: 'U10B', dob: '2017-05-01' },
    // a normal in-band U10 player
    { id: 'p_inband', division: 'U10B', dob: '2016-05-01' },
  ];
  const coaches = [{ id: 'coachA', player_id: 'p_child' }];

  const { players: out, diagnostics } = prepareTeamingInput({
    players,
    coaches,
    divisions,
    seasonYear: SEASON,
    cutoffMode: MODE,
  });

  const child = out.find((p) => p.id === 'p_child');
  const other = out.find((p) => p.id === 'p_other');
  const inband = out.find((p) => p.id === 'p_inband');

  // Coach linking anchored the coach's team around the child.
  assert.equal(child.coachId, 'coachA');
  assert.equal(diagnostics.coachLinking.linkedPlayers, 1);

  // Coach child playing up is sanctioned (route A).
  assert.equal(child.placement, PLACEMENT.PLAY_UP_SANCTIONED);
  assert.equal(child.division, 'U10B');

  // The unrelated play-up is blocked.
  assert.equal(other.placement, PLACEMENT.PLAY_UP_BLOCKED);

  // In-band player untouched.
  assert.equal(inband.placement, PLACEMENT.IN_BAND);

  assert.equal(diagnostics.playUp.counts.playUpSanctioned, 1);
  assert.equal(diagnostics.playUp.counts.playUpBlocked, 1);
});

test('remapBlocked=false keeps players in their registered division (single-division flow)', () => {
  const players = [{ id: 'p_other', division: 'U10B', dob: '2017-05-01' }];
  const { players: out } = prepareTeamingInput({
    players,
    coaches: [],
    divisions,
    seasonYear: SEASON,
    cutoffMode: MODE,
    remapBlocked: false,
  });
  assert.equal(out[0].division, 'U10B');
  assert.equal(out[0].needsReview, true);
});
