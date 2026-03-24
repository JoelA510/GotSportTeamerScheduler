import { test, expect } from 'vitest';
import assert from 'node:assert/strict';
import {
  authorizePracticePersistenceRequest,
  handlePracticePersistence,
} from '../packages/core/src/practicePersistenceHandler.js';

test('authorizePracticePersistenceRequest checks role', () => {
  const result = authorizePracticePersistenceRequest({
    user: { role: 'coach' },
    allowedRoles: ['admin'],
  });
  assert.equal(result.status, 'forbidden');
});

test('authorizePracticePersistenceRequest allows admin', () => {
  const result = authorizePracticePersistenceRequest({
    user: { role: 'admin' },
    allowedRoles: ['admin'],
  });
  assert.equal(result.status, 'authorized');
});

test('handlePracticePersistence validates snapshot', () => {
  const result = handlePracticePersistence({
    snapshot: { lastRunId: 'run-1', payload: { assignmentRows: [] } },
    overrides: [],
    now: new Date(),
  });
  assert.equal(result.status, 'success');
});
