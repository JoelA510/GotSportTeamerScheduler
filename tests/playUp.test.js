import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  applyPlayUpEligibility,
  classifyPlayerPlacement,
  PLACEMENT,
} from '../packages/core/src/playUp.js';

const MODE = 'birth_year'; // exact ages: age = 2026 - birthYear
const SEASON = 2026;

const divisions = [
  { id: 'U9B', name: 'U9 Boys', minAge: 9, maxAge: 9, gender_policy: 'boys' },
  { id: 'U10B', name: 'U10 Boys', minAge: 10, maxAge: 10, gender_policy: 'boys' },
  { id: 'U12B', name: 'U11 - U12 Boys', minAge: 11, maxAge: 12, gender_policy: 'boys' },
];

function run(players, opts = {}) {
  return applyPlayUpEligibility({
    players,
    divisions,
    seasonYear: SEASON,
    cutoffMode: MODE,
    ...opts,
  });
}

test('in-band player is unchanged', () => {
  const { players, diagnostics } = run([{ id: 'p1', division: 'U10B', dob: '2016-04-01' }]);
  assert.equal(players[0].placement, PLACEMENT.IN_BAND);
  assert.equal(players[0].division, 'U10B');
  assert.equal(players[0].needsReview, false);
  assert.equal(diagnostics.counts.inBand, 1);
});

test('unsanctioned play-up is blocked and remapped to natural division', () => {
  // age 9 registered in U10B with no coaching parent / buddy
  const { players, diagnostics } = run([{ id: 'p1', division: 'U10B', dob: '2017-04-01' }]);
  assert.equal(players[0].placement, PLACEMENT.PLAY_UP_BLOCKED);
  assert.equal(players[0].division, 'U9B'); // remapped down to natural
  assert.equal(players[0].registeredDivision, 'U10B');
  assert.equal(players[0].needsReview, true);
  assert.equal(diagnostics.blockedPlayUps.length, 1);
});

test('play-up sanctioned because the parent coaches the division (coach-child)', () => {
  const { players, diagnostics } = run([
    { id: 'p1', division: 'U10B', dob: '2017-04-01', isCoachChild: true },
  ]);
  assert.equal(players[0].placement, PLACEMENT.PLAY_UP_SANCTIONED);
  assert.equal(players[0].division, 'U10B'); // stays up
  assert.equal(players[0].playUpSanctioned, true);
  assert.equal(diagnostics.sanctionedPlayUps[0].via, 'coach-child');
});

test('play-up sanctioned via a buddy who legitimately belongs to the division', () => {
  const players = [
    // coach child, legitimately in U10B (age 10)
    { id: 'anchor', division: 'U10B', dob: '2016-04-01', isCoachChild: true },
    // age 9, wants to play up, buddied with the coach's child
    { id: 'buddy', division: 'U10B', dob: '2017-04-01', buddyId: 'anchor' },
  ];
  const { players: out } = run(players);
  const buddy = out.find((p) => p.id === 'buddy');
  assert.equal(buddy.placement, PLACEMENT.PLAY_UP_SANCTIONED);
  assert.equal(buddy.division, 'U10B');
});

test('play-down is always blocked and remapped up to the natural division', () => {
  // age 11 registered in U10B (too old)
  const { players, diagnostics } = run([{ id: 'p1', division: 'U10B', dob: '2015-04-01' }]);
  assert.equal(players[0].placement, PLACEMENT.PLAY_DOWN_BLOCKED);
  assert.equal(players[0].division, 'U12B'); // remapped up to natural band
  assert.equal(players[0].needsReview, true);
  assert.equal(diagnostics.blockedPlayDowns.length, 1);
});

test('remapBlocked=false keeps the registered division but flags review', () => {
  const { players } = run([{ id: 'p1', division: 'U10B', dob: '2015-04-01' }], {
    remapBlocked: false,
  });
  assert.equal(players[0].division, 'U10B');
  assert.equal(players[0].needsReview, true);
  assert.equal(players[0].placement, PLACEMENT.PLAY_DOWN_BLOCKED);
});

test('classifyPlayerPlacement honors the sanctioned flag', () => {
  const bounds = { minAge: 10, maxAge: 10 };
  assert.equal(
    classifyPlayerPlacement({ naturalAge: 9, bounds, sanctioned: true }),
    PLACEMENT.PLAY_UP_SANCTIONED
  );
  assert.equal(
    classifyPlayerPlacement({ naturalAge: 9, bounds, sanctioned: false }),
    PLACEMENT.PLAY_UP_BLOCKED
  );
  assert.equal(classifyPlayerPlacement({ naturalAge: 11, bounds }), PLACEMENT.PLAY_DOWN_BLOCKED);
  assert.equal(classifyPlayerPlacement({ naturalAge: 10, bounds }), PLACEMENT.IN_BAND);
});
