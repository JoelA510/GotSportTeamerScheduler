/**
 * formatChangeNote (teaming follow-ups PR): the admin-facing one-line summary of a
 * snapshot-aware re-run, shared between the staged-review banner and any future consumer.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatChangeNote } from '../packages/core/src/teamDiagnostics.js';

test('returns an empty string when there are no change diagnostics (fresh generation)', () => {
  assert.equal(formatChangeNote(null), '');
  assert.equal(formatChangeNote(undefined), '');
  assert.equal(formatChangeNote(/** @type {any} */ ('nope')), '');
});

test('formats counts with pluralization', () => {
  assert.equal(
    formatChangeNote({
      existingTeamsPreserved: 3,
      latePlayersAssigned: 1,
      droppedPlayersRemoved: 2,
      manualReview: [],
    }),
    'Incremental rerun: 3 teams preserved, 1 late player seated, 2 dropped.'
  );
  assert.equal(
    formatChangeNote({
      existingTeamsPreserved: 1,
      latePlayersAssigned: 0,
      droppedPlayersRemoved: 0,
    }),
    'Incremental rerun: 1 team preserved, 0 late players seated, 0 dropped.'
  );
});

test('appends the manual-review suffix only when entries exist', () => {
  assert.equal(
    formatChangeNote({
      existingTeamsPreserved: 2,
      latePlayersAssigned: 2,
      droppedPlayersRemoved: 1,
      manualReview: [{ code: 'x' }, { code: 'y' }],
    }),
    'Incremental rerun: 2 teams preserved, 2 late players seated, 1 dropped, 2 need manual review.'
  );
});

test('tolerates missing fields (defaults to zero)', () => {
  assert.equal(
    formatChangeNote({}),
    'Incremental rerun: 0 teams preserved, 0 late players seated, 0 dropped.'
  );
});
