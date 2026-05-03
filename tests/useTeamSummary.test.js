import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTeamSummary } from '../frontend/src/hooks/useTeamSummary.js';
import { supabase } from '../frontend/src/lib/supabaseClient.js';
import { useOrganization } from '../frontend/src/contexts/OrganizationContext.jsx';

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../frontend/src/lib/logger.js', () => ({
  logger: { error: vi.fn() },
}));

function createQueryBuilder(resolvedValue) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    or: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(resolvedValue)),
  };
  return builder;
}

describe('useTeamSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error [MOCK] - partial organization context is enough for this hook.
    vi.mocked(useOrganization).mockReturnValue({
      currentOrganization: { id: 'org-1' },
      currentSeasonSetting: { id: 'season-1' },
    });
  });

  it('scopes team scheduler reads to the active organization and season', async () => {
    const runBuilder = createQueryBuilder({
      data: {
        id: 'team-run-1',
        status: 'completed',
        completed_at: '2026-05-01T00:00:00Z',
        metrics: { progress: 100 },
        results: {
          teamsByDivision: {
            U10: [{ id: 'team-1', name: 'Team One' }],
          },
          rosterBalanceByDivision: {
            U10: { summary: { totalPlayers: 10, totalCapacity: 12 } },
          },
          coachCoverageByDivision: {
            U10: { totalTeams: 1, teamsWithCoach: 1, coverageRate: 1 },
          },
        },
      },
      error: null,
    });

    // @ts-expect-error [MOCK] - query builder only implements methods exercised by this hook.
    vi.mocked(supabase.from).mockReturnValue(runBuilder);

    const { result, unmount } = renderHook(() => useTeamSummary());

    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();

    expect(result.current.summary.runId).toBe('team-run-1');
    expect(runBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(runBuilder.eq).toHaveBeenCalledWith('run_type', 'team');
    expect(runBuilder.in).toHaveBeenCalledWith('status', ['completed', 'running']);
    expect(runBuilder.or).toHaveBeenCalledWith(
      'season_settings_id.eq.season-1,season_id.eq.season-1'
    );
  });
});
