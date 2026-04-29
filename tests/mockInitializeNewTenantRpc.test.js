import { describe, it, expect } from 'vitest';
import { mockSupabase as supabase, getMockData } from '../frontend/src/lib/mockSupabaseClient.js';

describe('mock initialize_new_tenant rpc', () => {
  it('creates org/member/season and returns new org id', async () => {
    const beforeCount = getMockData('organizations').length;
    const { data, error } = await supabase.rpc('initialize_new_tenant', {
      p_name: 'New Org',
      p_slug: 'new-org',
      p_timezone: 'UTC',
      p_season_year: 2026,
    });
    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    expect(getMockData('organizations').length).toBe(beforeCount + 1);
    expect(
      getMockData('organization_members').some(
        (m) => m.organization_id === data && m.role === 'admin'
      )
    ).toBe(true);
  });

  it('rejects duplicate slug without side effects', async () => {
    await supabase.rpc('initialize_new_tenant', {
      p_name: 'Seed Org',
      p_slug: 'seed-org',
      p_timezone: 'UTC',
      p_season_year: 2026,
    });
    const beforeCount = getMockData('organizations').length;
    const { error } = await supabase.rpc('initialize_new_tenant', {
      p_name: 'Dupe Org',
      p_slug: 'seed-org',
      p_timezone: 'UTC',
      p_season_year: 2026,
    });
    expect(error).toBeTruthy();
    expect(getMockData('organizations').length).toBe(beforeCount);
  });
});
