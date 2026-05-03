import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SeasonModule from '../frontend/src/components/settings/modules/SeasonModule.jsx';

const mocks = vi.hoisted(() => ({
  updateCurrentSeason: vi.fn(),
  updateTimezone: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../frontend/src/contexts/ThemeContext.jsx', () => ({
  useTheme: () => ({
    currentSeason: '2025',
    updateCurrentSeason: mocks.updateCurrentSeason,
    availableSeasons: ['2025', '2026'],
    timezone: 'America/Los_Angeles',
    updateTimezone: mocks.updateTimezone,
  }),
}));

vi.mock('../frontend/src/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'admin@example.com',
      profile: { id: 'profile-1', organization_id: 'org-1' },
    },
    isImpersonating: false,
  }),
}));

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

describe('SeasonModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it('exposes season format and quick-select choices with pressed state', () => {
    render(<SeasonModule />);

    const formatGroup = screen.getByRole('group', { name: 'Season Naming Format' });
    const singleYear = screen.getByRole('button', { name: /Single Year/ });
    const dualYear = screen.getByRole('button', { name: /Dual Year/ });

    expect(formatGroup).toContainElement(singleYear);
    expect(singleYear).toHaveAttribute('type', 'button');
    expect(singleYear).toHaveAttribute('aria-pressed', 'true');
    expect(dualYear).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(dualYear);

    expect(dualYear).toHaveAttribute('aria-pressed', 'true');
    expect(singleYear).toHaveAttribute('aria-pressed', 'false');

    const season2026 = screen.getByRole('button', { name: 'Select 2026 as current season' });
    expect(season2026).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(season2026);

    expect(season2026).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.updateCurrentSeason).toHaveBeenCalledWith('2026');
  });
});
