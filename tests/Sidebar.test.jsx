import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../frontend/src/components/Sidebar.jsx';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock('../frontend/src/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    signOut: mocks.signOut,
    isAdmin: false,
    isCoach: true,
    isImpersonating: false,
    user: {
      email: 'coach@example.com',
      profile: {
        first_name: 'Casey',
        last_name: 'Coach',
        full_name: 'Casey Coach',
      },
    },
  }),
}));

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: () => ({
    organizations: [
      {
        organization_id: 'org-1',
        organizations: { id: 'org-1', name: 'North League' },
      },
    ],
    currentOrganization: { id: 'org-1', name: 'North League' },
    availableSeasons: [{ id: 'season-1', name: 'Spring 2026' }],
    currentSeasonSetting: { id: 'season-1', name: 'Spring 2026' },
    switchOrganization: vi.fn(),
    switchSeason: vi.fn(),
  }),
}));

vi.mock('../frontend/src/config.js', () => ({
  IS_MOCK_MODE: false,
}));

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a keyboard-operable user menu with account settings and sign out actions', () => {
    render(
      <MemoryRouter>
        <Sidebar isOpen toggleSidebar={vi.fn()} />
      </MemoryRouter>
    );

    const menuButton = screen.getByRole('button', { name: /casey coach/i });
    expect(menuButton).toHaveAttribute('aria-haspopup', 'menu');
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(menuButton);

    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'User account menu' });
    expect(menu).toBeInTheDocument();

    const accountLink = screen.getByRole('menuitem', { name: 'Account Settings' });
    expect(accountLink).toHaveAttribute('href', '/account');

    fireEvent.keyDown(menuButton, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'User account menu' })).not.toBeInTheDocument();

    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign Out' }));
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it('supports arrow-key navigation and Escape dismissal inside the user menu', async () => {
    render(
      <MemoryRouter>
        <Sidebar isOpen toggleSidebar={vi.fn()} />
      </MemoryRouter>
    );

    const menuButton = screen.getByRole('button', { name: /casey coach/i });
    fireEvent.keyDown(menuButton, { key: 'ArrowDown' });

    const menu = await screen.findByRole('menu', { name: 'User account menu' });
    const accountLink = screen.getByRole('menuitem', { name: 'Account Settings' });
    const signOutButton = screen.getByRole('menuitem', { name: 'Sign Out' });

    await waitFor(() => expect(accountLink).toHaveFocus());

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(signOutButton).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(accountLink).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'End' });
    expect(signOutButton).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(accountLink).toHaveFocus();

    fireEvent.keyDown(accountLink, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: 'User account menu' })).not.toBeInTheDocument()
    );
    expect(menuButton).toHaveFocus();
  });
});
