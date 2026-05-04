import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InvitesSettings from '../frontend/src/components/settings/InvitesSettings.jsx';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  invites: [],
}));

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: () => ({
    currentOrganization: { id: 'org-1' },
  }),
}));

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

const makeInviteQuery = () => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: mocks.invites, error: null })),
  };
  return query;
};

describe('InvitesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invites = [
      {
        id: 'invite-1',
        code: 'ABCD-1234',
        organization_id: 'org-1',
        role: 'coach',
        created_at: '2026-05-01T00:00:00.000Z',
        expires_at: '2099-05-08T00:00:00.000Z',
        used_at: null,
      },
    ];
    mocks.from.mockImplementation(() => makeInviteQuery());
    mocks.rpc.mockResolvedValue({ data: 'invite-1', error: null });
  });

  it('revokes active invites through the org-scoped RPC', async () => {
    let resolveRpc = (_value) => {};
    mocks.rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        })
    );
    render(<InvitesSettings />);

    const revokeButton = await screen.findByRole('button', { name: 'Revoke invite' });
    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('revoke_org_invite', {
        p_organization_id: 'org-1',
        p_invite_id: 'invite-1',
      });
    });
    expect(revokeButton).toBeDisabled();

    resolveRpc({ data: 'invite-1', error: null });
    await waitFor(() => expect(revokeButton).not.toBeDisabled());
  });
});
