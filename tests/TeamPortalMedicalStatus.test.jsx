import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamPortalPage from '../frontend/src/pages/TeamPortalPage.jsx';

const mocks = vi.hoisted(() => ({
  portalState: null,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ teamId: 'team-1' }),
}));

vi.mock('../frontend/src/hooks/useTeamPortal.js', () => ({
  useTeamPortal: () => mocks.portalState,
}));

describe('TeamPortalPage medical clearance', () => {
  beforeEach(() => {
    mocks.portalState = {
      loading: false,
      error: null,
      team: {
        name: 'Tigers',
        division: {
          name: 'U10',
          season: { season_label: 'Fall', season_year: 2026 },
        },
      },
      roster: [
        {
          id: 'cleared-player',
          first_name: 'Avery',
          last_name: 'Adams',
          medical_cleared: true,
          medical_clearance_visible: true,
        },
        {
          id: 'pending-player',
          first_name: 'Blair',
          last_name: 'Bennett',
          medical_cleared: false,
          medical_clearance_visible: true,
        },
        {
          id: 'hidden-player',
          first_name: 'Casey',
          last_name: 'Chen',
          medical_cleared: true,
          medical_clearance_visible: false,
        },
      ],
      events: [],
      rsvps: [],
      messages: [],
      myPlayers: [],
      updateRsvp: vi.fn(),
      sendMessage: vi.fn(),
    };
  });

  it('renders medical clearance from registration state instead of hardcoded player ids', () => {
    render(<TeamPortalPage />);

    expect(screen.getByText('Avery Adams')).toBeInTheDocument();
    expect(screen.getByText('Blair Bennett')).toBeInTheDocument();
    expect(screen.getByText('Casey Chen')).toBeInTheDocument();
    expect(screen.getByText('Medical Clearance: Yes')).toHaveClass('text-status-success');
    expect(screen.getByText('Medical Clearance: Pending')).toHaveClass('text-status-warning');
    expect(screen.getAllByText(/Medical Clearance:/)).toHaveLength(2);
  });
});
