import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { supabase } from '../frontend/src/lib/supabaseClient.js';
import { persistGameScheduleReview } from '../frontend/src/utils/gamePersistenceClient.js';

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('requires an authenticated session before applying game schedule changes', async () => {
  vi.mocked(supabase.auth.getSession).mockResolvedValue(
    /** @type {any} */ ({ data: { session: null }, error: null })
  );
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  await assert.rejects(
    () => persistGameScheduleReview({ assignments: [] }),
    /Authentication required to apply game schedule changes/
  );
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('posts Supabase-ready game rows and org metadata to the persistence endpoint', async () => {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: /** @type {any} */ ({ access_token: 'token-123' }) },
    error: null,
  });

  /** @type {string | undefined} */
  let capturedUrl;
  /** @type {any} */
  let capturedOptions;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', runId: 'run-game-1' }),
      };
    })
  );

  const result = await persistGameScheduleReview({
    assignments: [
      {
        division: 'U10',
        weekIndex: 1,
        slotId: 'slot-1',
        start: '2026-04-04T08:00:00Z',
        end: '2026-04-04T09:00:00Z',
        fieldId: 'field-1',
        homeTeamId: 'team-1',
        awayTeamId: 'team-2',
        source: 'locked',
      },
    ],
    runMetadata: {
      organizationId: 'org-1',
      seasonSettingsId: 'season-1',
      parameters: { generationMode: 'round-robin' },
    },
  });

  assert.match(capturedUrl, /\/functions\/v1\/game-persistence$/);
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer token-123');

  const body = JSON.parse(capturedOptions.body);
  assert.deepEqual(body.runMetadata, {
    organizationId: 'org-1',
    seasonSettingsId: 'season-1',
    parameters: { generationMode: 'round-robin' },
  });
  assert.equal(body.snapshot.lastRunId, null);
  assert.deepEqual(body.snapshot.payload.assignmentRows, [
    {
      division: 'U10',
      week_index: 1,
      game_slot_id: 'slot-1',
      slot_id: 'slot-1',
      start: '2026-04-04T08:00:00.000Z',
      end: '2026-04-04T09:00:00.000Z',
      field_id: 'field-1',
      home_team_id: 'team-1',
      away_team_id: 'team-2',
      assignment_source: 'manual',
      run_id: null,
    },
  ]);
  assert.equal(result.runId, 'run-game-1');
});

test('surfaces game persistence errors from the edge function', async () => {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: /** @type {any} */ ({ access_token: 'token-123' }) },
    error: null,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Access denied: data belongs to a different organization' }),
    }))
  );

  await assert.rejects(
    () =>
      persistGameScheduleReview({
        assignments: [
          {
            division: 'U10',
            weekIndex: 1,
            slotId: 'slot-1',
            start: '2026-04-04T08:00:00Z',
            end: '2026-04-04T09:00:00Z',
            homeTeamId: 'team-1',
            awayTeamId: 'team-2',
          },
        ],
      }),
    /Access denied/
  );
});
