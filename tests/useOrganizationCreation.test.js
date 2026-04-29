import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from '../frontend/src/lib/supabaseClient.js';
import { useOrganizationCreation } from '../frontend/src/hooks/useOrganizationCreation.js';

describe('useOrganizationCreation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates fields before rpc', async () => {
    const { result } = renderHook(() => useOrganizationCreation());
    await act(async () => {
      await result.current.createOrganization({
        name: 'ab',
        slug: 'bad slug',
        timezone: '',
        seasonYear: 2019,
      });
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(result.current.fieldErrors?.name).toContain('at least 3');
    expect(result.current.fieldErrors?.slug).toBeTruthy();
    expect(result.current.fieldErrors?.seasonYear).toContain('2020');
  });

  it('maps duplicate slug rpc error to slug field', async () => {
    /** @type {any} */ (supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint' },
    });
    const { result } = renderHook(() => useOrganizationCreation());
    await act(async () => {
      await result.current.createOrganization({
        name: 'Club Name',
        slug: 'club-name',
        timezone: 'UTC',
        seasonYear: 2026,
      });
    });
    expect(result.current.fieldErrors?.slug).toContain('taken');
  });
});
