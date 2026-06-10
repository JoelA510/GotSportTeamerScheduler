import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeBuddyLinks, getCanonicalBuddyId } from '../packages/core/src/buddyLinking.js';
import { prepareTeamingInput } from '../packages/core/src/teamingPipeline.js';

test('getCanonicalBuddyId reads buddyId then buddy_id', () => {
  assert.equal(getCanonicalBuddyId({ buddyId: 'b' }), 'b');
  assert.equal(getCanonicalBuddyId({ buddy_id: 'c' }), 'c');
  assert.equal(getCanonicalBuddyId({ buddyId: 'b', buddy_id: 'c' }), 'b');
  assert.equal(getCanonicalBuddyId({}), undefined);
  assert.equal(getCanonicalBuddyId(null), undefined);
  assert.equal(getCanonicalBuddyId({ buddyId: '  b  ' }), 'b');
});

test('normalizeBuddyLinks passes canonical buddyId through unchanged', () => {
  const players = [
    { id: 'a', division: 'U10', buddyId: 'b' },
    { id: 'b', division: 'U10', buddyId: 'a' },
  ];
  const { players: result, diagnostics } = normalizeBuddyLinks(players);
  assert.equal(result[0].buddyId, 'b');
  assert.equal(result[1].buddyId, 'a');
  assert.deepEqual(diagnostics, []);
  // Unchanged players keep identity (no needless copies).
  assert.equal(result[0], players[0]);
});

test('normalizeBuddyLinks canonicalizes buddy_id into buddyId', () => {
  const { players: result } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', buddy_id: 'b' },
    { id: 'b', division: 'U10', buddy_id: 'a' },
  ]);
  assert.equal(result[0].buddyId, 'b');
  assert.equal(result[1].buddyId, 'a');
});

test('normalizeBuddyLinks resolves a two-player mutual_buddy_code into reciprocal links', () => {
  const { players: result, diagnostics } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', mutual_buddy_code: 'PAIR-1' },
    { id: 'b', division: 'U10', mutual_buddy_code: 'PAIR-1' },
    { id: 'c', division: 'U10' },
  ]);
  assert.equal(result[0].buddyId, 'b');
  assert.equal(result[1].buddyId, 'a');
  assert.equal(result[2].buddyId, undefined);
  assert.deepEqual(diagnostics, []);
});

test('normalizeBuddyLinks resolves camelCase mutualBuddyCode too', () => {
  const { players: result } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', mutualBuddyCode: 'X' },
    { id: 'b', division: 'U10', mutualBuddyCode: 'X' },
  ]);
  assert.equal(result[0].buddyId, 'b');
  assert.equal(result[1].buddyId, 'a');
});

test('normalizeBuddyLinks diagnoses a code shared by more than two players and links none', () => {
  const { players: result, diagnostics } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', mutual_buddy_code: 'TRIO' },
    { id: 'b', division: 'U10', mutual_buddy_code: 'TRIO' },
    { id: 'c', division: 'U10', mutual_buddy_code: 'TRIO' },
  ]);
  assert.ok(result.every((p) => p.buddyId === undefined));
  const diag = diagnostics.find((d) => d.code === 'duplicate-buddy-code');
  assert.ok(diag);
  assert.deepEqual(diag.playerIds.sort(), ['a', 'b', 'c']);
});

test('normalizeBuddyLinks diagnoses an unmatched single-player code', () => {
  const { diagnostics } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', mutual_buddy_code: 'LONELY' },
  ]);
  assert.ok(diagnostics.some((d) => d.code === 'buddy-code-unmatched'));
});

test('normalizeBuddyLinks diagnoses a cross-division code pair and links none', () => {
  const { players: result, diagnostics } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', mutual_buddy_code: 'XD' },
    { id: 'b', division: 'U12', mutual_buddy_code: 'XD' },
  ]);
  assert.ok(result.every((p) => p.buddyId === undefined));
  assert.ok(diagnostics.some((d) => d.code === 'cross-division-buddy'));
});

test('normalizeBuddyLinks diagnoses one-sided, missing, self, and cross-division direct requests', () => {
  const { diagnostics } = normalizeBuddyLinks([
    { id: 'one-sided', division: 'U10', buddyId: 'silent' },
    { id: 'silent', division: 'U10' },
    { id: 'orphan', division: 'U10', buddyId: 'ghost' },
    { id: 'narcissist', division: 'U10', buddyId: 'narcissist' },
    { id: 'crosser', division: 'U10', buddyId: 'other-div' },
    { id: 'other-div', division: 'U12', buddyId: 'crosser' },
  ]);
  assert.ok(diagnostics.some((d) => d.code === 'one-sided-buddy'));
  assert.ok(diagnostics.some((d) => d.code === 'missing-buddy-target'));
  assert.ok(diagnostics.some((d) => d.code === 'self-buddy-reference'));
  assert.ok(diagnostics.some((d) => d.code === 'cross-division-buddy'));
});

test('normalizeBuddyLinks does not flag one-sided when reciprocation arrives via a code', () => {
  const { players: result, diagnostics } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', buddyId: 'b', mutual_buddy_code: 'P2' },
    { id: 'b', division: 'U10', mutual_buddy_code: 'P2' },
  ]);
  // a→b directly; b→a via the shared code: fully mutual, no one-sided diagnostic.
  assert.equal(result[1].buddyId, 'a');
  assert.ok(!diagnostics.some((d) => d.code === 'one-sided-buddy'));
});

test('normalizeBuddyLinks diagnoses a 2-player code group with an unusable id', () => {
  const { diagnostics } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', mutual_buddy_code: 'BROKEN' },
    { division: 'U10', mutual_buddy_code: 'BROKEN' }, // malformed row: no id
  ]);
  assert.ok(
    diagnostics.some((d) => d.code === 'buddy-code-unmatched' && d.message.includes('BROKEN'))
  );
});

test('normalizeBuddyLinks lets an explicit buddyId win over a code and breaks the code pair', () => {
  const { players: result, diagnostics } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', buddyId: 'c', mutual_buddy_code: 'PAIR' },
    { id: 'b', division: 'U10', mutual_buddy_code: 'PAIR' },
    { id: 'c', division: 'U10', buddyId: 'a' },
  ]);
  assert.equal(result[0].buddyId, 'c', 'explicit reference wins');
  // b's code partner (a) explicitly chose someone else: no silent one-sided link.
  assert.equal(result[1].buddyId, undefined, 'broken code pair links nobody');
  assert.ok(
    diagnostics.some((d) => d.code === 'buddy-code-unmatched' && d.playerIds.includes('b')),
    'the broken code pair is diagnosed'
  );
});

test('normalizeBuddyLinks still pairs via code when one partner self-references', () => {
  const { players: result } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', buddyId: 'a', mutual_buddy_code: 'P' },
    { id: 'b', division: 'U10', mutual_buddy_code: 'P' },
  ]);
  // The self-reference cannot link, so the code pair holds symmetrically.
  assert.equal(result[0].buddyId, 'b');
  assert.equal(result[1].buddyId, 'a');
});

test('normalizeBuddyLinks groups buddy codes case-insensitively', () => {
  const { players: result } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', mutual_buddy_code: 'FamilyA' },
    { id: 'b', division: 'U10', mutual_buddy_code: 'familya' },
  ]);
  assert.equal(result[0].buddyId, 'b');
  assert.equal(result[1].buddyId, 'a');
});

test('normalizeBuddyLinks resolves buddy_request via external registration ids', () => {
  const { players: result, diagnostics } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', external_registration_id: 'GS-A', buddy_request: 'GS-B' },
    { id: 'b', division: 'U10', external_registration_id: 'GS-B', buddy_request: 'GS-A' },
    { id: 'c', division: 'U10', buddy_request: 'GS-GHOST' },
  ]);
  assert.equal(result[0].buddyId, 'b');
  assert.equal(result[1].buddyId, 'a');
  assert.equal(result[2].buddyId, undefined);
  assert.ok(
    diagnostics.some((d) => d.code === 'missing-buddy-target' && d.message.includes('GS-GHOST'))
  );
});

test('normalizeBuddyLinks stores the trimmed canonical value over a padded raw buddyId', () => {
  const { players: result } = normalizeBuddyLinks([
    { id: 'a', division: 'U10', buddyId: ' b ' },
    { id: 'b', division: 'U10', buddyId: 'a' },
  ]);
  assert.equal(result[0].buddyId, 'b', 'padded reference is canonicalized for strict matching');
});

test('normalizeBuddyLinks does not mutate its input', () => {
  const players = [
    { id: 'a', division: 'U10', mutual_buddy_code: 'P' },
    { id: 'b', division: 'U10', mutual_buddy_code: 'P' },
  ];
  const frozen = players.map((p) => Object.freeze({ ...p }));
  const { players: result } = normalizeBuddyLinks(frozen);
  assert.equal(/** @type {any} */ (frozen[0]).buddyId, undefined);
  assert.equal(result[0].buddyId, 'b');
});

test('prepareTeamingInput canonicalizes buddy codes and reports buddyLinking diagnostics', () => {
  const { players, diagnostics } = prepareTeamingInput({
    players: [
      { id: 'a', division: 'U10', mutual_buddy_code: 'PAIR-9' },
      { id: 'b', division: 'U10', mutual_buddy_code: 'PAIR-9' },
      { id: 'c', division: 'U10', buddy_id: 'ghost' },
    ],
    seasonYear: 2026,
  });

  const byId = new Map(players.map((p) => [p.id, p]));
  assert.equal(byId.get('a').buddyId, 'b');
  assert.equal(byId.get('b').buddyId, 'a');
  assert.equal(byId.get('c').buddyId, 'ghost', 'direct reference canonicalized');
  assert.ok(diagnostics.buddyLinking.some((d) => d.code === 'missing-buddy-target'));
});
