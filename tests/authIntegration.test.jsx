import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from '../frontend/src/contexts/AuthContext.jsx';
import {
  OrganizationProvider,
  useOrganization,
} from '../frontend/src/contexts/OrganizationContext.jsx';
import { supabase } from '../frontend/src/lib/supabaseClient.js';

// Mock Supabase
vi.mock('../frontend/src/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(),
  },
}));

const TestComponent = () => {
  const { user } = useAuth();
  const { currentOrganization, loading } = useOrganization();

  if (loading) return <div>Loading Orgs...</div>;

  return (
    <div>
      <div data-testid="user-email">{user?.email}</div>
      <div data-testid="org-name">{currentOrganization?.name || 'No Org'}</div>
    </div>
  );
};

describe('Auth & Organization Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load user and fetch organizations', async () => {
    // Setup Mock Data
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    const mockProfile = { id: 'user-123', full_name: 'Test Users' };
    const mockOrgMember = {
      organization_id: 'org-1',
      role: 'admin',
      organizations: { id: 'org-1', name: 'Test Club' },
    };

    // 1. Mock Auth State Change
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((callback) => {
      // Evaluate immediately
      /** @type {any} */
      const mockSession = { 
        user: mockUser,
        access_token: 'abc',
        refresh_token: 'def',
        expires_in: 3600,
        token_type: 'bearer'
      };
      callback('SIGNED_IN', mockSession);
      return { data: { subscription: { id: 'sub-123', callback: () => {}, unsubscribe: vi.fn() } } };
    });

    // 2. Mock Profile Fetch (AuthContext)
    const profileSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: mockProfile }),
      }),
    });

    // 3. Mock Org Member Fetch (OrganizationContext)
    // supabase.from().select() returns the builder that has .eq()
    const orgSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [mockOrgMember], error: null }),
    });

    // Handle separate .from() calls
    // @ts-ignore
    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'profiles') return { select: profileSelect };
      if (table === 'organization_members') return { select: orgSelect };
      return { select: vi.fn() };
    });

    render(
      <AuthProvider>
        <OrganizationProvider>
          <TestComponent />
        </OrganizationProvider>
      </AuthProvider>
    );

    // Assert User Loaded
    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
    });

    // Assert Org Loaded
    await waitFor(() => {
      expect(screen.getByTestId('org-name')).toHaveTextContent('Test Club');
    });

    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(supabase.from).toHaveBeenCalledWith('organization_members');
  });
});
