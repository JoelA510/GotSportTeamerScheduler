import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  buildCoachLeadPayload,
  getExternalRegistrationId,
  hasCoachLeadIntent,
  isCoachIntent,
} from '../frontend/src/utils/coachLeads.js';

const organizationId = 'a1111111-1111-1111-1111-111111111111';
const divisions = [
  { id: 'division-u10', name: 'Org A U10' },
  { id: 'division-u12', name: 'Org A U12' },
];
const players = [
  {
    id: 'player-riley',
    external_registration_id: 'GS-123',
    division_id: 'division-u10',
  },
];

describe('coach lead import payloads', () => {
  it('detects the same coach intent values accepted by the database finalizer', () => {
    assert.equal(isCoachIntent(true), true);
    assert.equal(isCoachIntent('Head Coach'), true);
    assert.equal(isCoachIntent(' volunteer '), true);
    assert.equal(isCoachIntent('no'), false);
    assert.equal(isCoachIntent(''), false);
  });

  it('builds org-scoped leads from willing player import rows', () => {
    const rows = [
      {
        first_name: 'Riley',
        last_name: 'Reyes',
        external_registration_id: 'GS-123',
        division_name: 'Org A U10',
        guardian_name: 'Morgan Reyes',
        guardian_email: 'Morgan.Reyes@Example.com',
        willing_to_coach: 'yes',
      },
    ];

    assert.deepEqual(buildCoachLeadPayload(rows, { organizationId, divisions, players }), [
      {
        email: 'morgan.reyes@example.com',
        full_name: 'Morgan Reyes',
        organization_id: organizationId,
        division_id: 'division-u10',
        player_id: 'player-riley',
      },
    ]);
  });

  it('deduplicates the same adult, division, and player lead', () => {
    const rows = [
      {
        external_registration_id: 'GS-123',
        guardian_name: 'Morgan Reyes',
        guardian_email: 'morgan.reyes@example.com',
        willing_to_coach: 'yes',
      },
      {
        external_registration_id: 'GS-123',
        parent_name: 'Morgan Reyes',
        parent_email: 'MORGAN.REYES@example.com',
        willing_to_coach: 'Head Coach',
      },
    ];

    const payload = buildCoachLeadPayload(rows, { organizationId, divisions, players });

    assert.equal(payload.length, 1);
    assert.equal(payload[0].player_id, 'player-riley');
  });

  it('skips rows without adult contact details or positive intent', () => {
    const rows = [
      {
        guardian_email: 'parent@example.com',
        willing_to_coach: 'yes',
      },
      {
        guardian_name: 'Taylor Smith',
        guardian_email: 'taylor@example.com',
        willing_to_coach: 'no',
      },
      {
        guardian_name: 'Alex Parent',
        guardian_email: 'not-an-email',
        willing_to_coach: 'yes',
      },
    ];

    assert.deepEqual(buildCoachLeadPayload(rows, { organizationId, divisions, players }), []);
  });

  it('does not trust division ids outside the supplied organization divisions', () => {
    const rows = [
      {
        guardian_name: 'Casey Lee',
        guardian_email: 'casey@example.com',
        division_id: 'division-from-another-org',
        willing_to_coach: 'yes',
      },
    ];

    assert.deepEqual(buildCoachLeadPayload(rows, { organizationId, divisions, players }), [
      {
        email: 'casey@example.com',
        full_name: 'Casey Lee',
        organization_id: organizationId,
        division_id: null,
        player_id: null,
      },
    ]);
  });

  it('reads external registration ids from supported GotSport aliases', () => {
    assert.equal(getExternalRegistrationId({ gotsport_id: 'GS-999' }), 'GS-999');
    assert.equal(hasCoachLeadIntent({ coach_volunteer: 'willing' }), true);
  });
});
