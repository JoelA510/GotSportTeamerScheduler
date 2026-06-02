import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ImportProvider, useImport } from '../frontend/src/contexts/ImportContext.jsx';

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: () => ({
    currentOrganization: { id: 'org-1' },
    orgMember: { id: 'member-1' },
  }),
}));

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      send: vi.fn(),
    })),
    removeChannel: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

describe('ImportContext field_availability state hygiene', () => {
  it("resetImport('all') clears importedFieldAvailability", async () => {
    const wrapper = ({ children }) => <ImportProvider>{children}</ImportProvider>;
    const { result } = renderHook(() => useImport(), { wrapper });

    act(() => {
      result.current.setImportedFieldAvailability({ importJobId: 'fa-job-1' });
    });

    expect(result.current.importedFieldAvailability).toEqual({ importJobId: 'fa-job-1' });

    await act(async () => {
      await result.current.resetImport('all');
    });

    expect(result.current.importedFieldAvailability).toBeNull();
  });
});
