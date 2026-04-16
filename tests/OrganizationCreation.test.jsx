import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrganizationCreation from '../frontend/src/pages/OrganizationCreation.jsx';
import { supabase } from '../frontend/src/lib/supabaseClient.js';
import { useOrganization } from '../frontend/src/contexts/OrganizationContext.jsx';

// Since App.jsx imports heavy components, we simulate the routing interception logic
// identical to how App.jsx uses it:
const AppSimulatedInterceptor = () => {
    const { organizations, loading } = useOrganization();
    
    if (loading) return <div>Loading...</div>;

    const hasNoOrgs = organizations.length === 0;

    if (hasNoOrgs) {
        return <OrganizationCreation />;
    }

    return <div>Dashboard Loaded</div>;
};

describe('OrganizationCreation Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('interception mounts OrganizationCreation when no organizations exist', () => {
    // Mock the hook to return empty organizations arrays
    useOrganization.mockReturnValue({
        organizations: [],
        loading: false
    });

    render(
      <MemoryRouter>
        <AppSimulatedInterceptor />
      </MemoryRouter>
    );

    // Verify Dashboard bypassed and setup mounts
    expect(screen.queryByText('Dashboard Loaded')).not.toBeInTheDocument();
    expect(screen.getByText(/New Frontier/i)).toBeInTheDocument();
  });

  it('triggers UI error states and prevents RPC call on improperly formatted slug', async () => {
    render(
      <MemoryRouter>
        <OrganizationCreation />
      </MemoryRouter>
    );

    const nameInput = screen.getByPlaceholderText('e.g. Galaxy Strikers');
    const slugInput = screen.getByPlaceholderText('galaxy-strikers');
    const submitBtn = screen.getByRole('button', { name: /Establish Organization/i });

    // Fill form
    fireEvent.change(nameInput, { target: { value: 'Test Org' } });
    
    // Simulate invalid slug (contains spaces)
    fireEvent.change(slugInput, { target: { name: 'slug', value: 'invalid slug with spaces' } });
    
    fireEvent.click(submitBtn);

    // Assert UI shows error message validation based on our implemented Regex
    await waitFor(() => {
        expect(screen.getByText(/Only lowercase letters, numbers, and hyphens are allowed./i)).toBeInTheDocument();
    });

    // Assert supabase.rpc was prevented
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('optimistic transition: invokes RPC and redirects upon success', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: 'mock-uuid', error: null });

    render(
      <MemoryRouter>
        <OrganizationCreation />
      </MemoryRouter>
    );

    const nameInput = screen.getByPlaceholderText('e.g. Galaxy Strikers');
    const slugInput = screen.getByPlaceholderText('galaxy-strikers');
    
    fireEvent.change(nameInput, { target: { name: 'name', value: 'Perfect Org' } });
    fireEvent.change(slugInput, { target: { name: 'slug', value: 'perfect-org' } });
    
    const submitBtn = screen.getByRole('button', { name: /Establish Organization/i });
    fireEvent.click(submitBtn);

    // Verify it transitions to success UI immediately
    await waitFor(() => {
        expect(screen.getByText(/Identity Locked/i)).toBeInTheDocument();
    });

    // Verify RPC was called with expected mapped values
    expect(supabase.rpc).toHaveBeenCalledWith('initialize_new_tenant', expect.objectContaining({
        p_name: 'Perfect Org',
        p_slug: 'perfect-org'
    }));
  });
});
