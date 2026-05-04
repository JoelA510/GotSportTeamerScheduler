import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFields } from '../frontend/src/hooks/useFields.js';
import { supabase } from '../frontend/src/lib/supabaseClient.js';
import { useOrganization } from '../frontend/src/contexts/OrganizationContext.jsx';

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../frontend/src/lib/logger.js', () => ({
  logger: { error: vi.fn() },
}));

function createReadBuilder(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

describe('useFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error [MOCK] - partial organization context is enough for this hook.
    vi.mocked(useOrganization).mockReturnValue({
      currentOrganization: { id: 'org-1' },
    });

    const locationsBuilder = createReadBuilder({
      data: [{ id: 'location-1', organization_id: 'org-1', name: 'Park' }],
      error: null,
    });
    const fieldsBuilder = createReadBuilder({
      data: [
        {
          id: 'field-1',
          organization_id: 'org-1',
          location_id: 'location-1',
          name: 'North Field',
        },
      ],
      error: null,
    });

    vi.mocked(supabase.from).mockImplementation((table) => {
      const builder = table === 'locations' ? locationsBuilder : fieldsBuilder;
      return /** @type {any} */ (builder);
    });
    // @ts-expect-error [MOCK] - partial RPC response is enough for mutation assertions.
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { id: 'rpc-id' }, error: null });
  });

  it('routes facility mutations through org-scoped RPCs', async () => {
    const { result } = renderHook(() => useFields());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addLocation('  New Park  ');
    });

    expect(supabase.rpc).toHaveBeenCalledWith('admin_create_location', {
      p_organization_id: 'org-1',
      p_name: '  New Park  ',
    });

    await act(async () => {
      await result.current.addField({
        location_id: 'location-1',
        name: 'South Field',
        surface_type: 'Turf',
        size: '7v7',
        supports_halves: true,
        priority_rating: 3,
        active: true,
      });
    });

    expect(supabase.rpc).toHaveBeenCalledWith('admin_create_field', {
      p_organization_id: 'org-1',
      p_location_id: 'location-1',
      p_name: 'South Field',
      p_surface_type: 'Turf',
      p_size: '7v7',
      p_supports_halves: true,
      p_priority_rating: 3,
      p_active: true,
    });

    await act(async () => {
      await result.current.updateField('field-1', {
        location_id: 'location-1',
        name: 'Renamed Field',
        surface_type: 'Grass',
        size: '11v11',
        supports_halves: false,
        priority_rating: 2,
        active: false,
      });
    });

    expect(supabase.rpc).toHaveBeenCalledWith('admin_update_field', {
      p_organization_id: 'org-1',
      p_field_id: 'field-1',
      p_location_id: 'location-1',
      p_name: 'Renamed Field',
      p_surface_type: 'Grass',
      p_size: '11v11',
      p_supports_halves: false,
      p_priority_rating: 2,
      p_active: false,
    });

    await act(async () => {
      await result.current.deleteField('field-1');
    });

    expect(supabase.rpc).toHaveBeenCalledWith('admin_delete_field', {
      p_organization_id: 'org-1',
      p_field_id: 'field-1',
    });
  });
});
