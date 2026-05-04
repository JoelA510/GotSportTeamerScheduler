import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarModal } from '../frontend/src/pages/TeamPortalPage.jsx';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

describe('CalendarModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fabricate a mock calendar token when a team has no token', () => {
    render(<CalendarModal team={{ id: 'team-1', calendar_token: null }} onClose={vi.fn()} />);

    const calendarLink = screen.getByLabelText(/copy this link to your calendar app/i);
    expect(calendarLink).toHaveValue('');
    expect(calendarLink).toHaveAttribute('placeholder', 'Regenerate a link before subscribing.');
    expect(calendarLink).not.toHaveValue(
      'webcal://localhost:3000/functions/v1/calendar-feed?token=mock-token'
    );

    expect(screen.getByText(/No calendar link is currently available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Link' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Regenerate Link' })).toHaveAttribute(
      'type',
      'button'
    );
  });

  it('uses the rotate token RPC result before enabling copy', async () => {
    mocks.rpc.mockResolvedValue({
      data: { status: 'ok', calendar_token: 'secure-calendar-token' },
      error: null,
    });

    render(<CalendarModal team={{ id: 'team-1', calendar_token: null }} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Link' }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('rotate_calendar_token', { p_team_id: 'team-1' });
    });

    const calendarLink = screen.getByLabelText(/copy this link to your calendar app/i);
    await waitFor(() => {
      expect(calendarLink).toHaveValue(
        'webcal://localhost:3000/functions/v1/calendar-feed?token=secure-calendar-token'
      );
    });
    expect(calendarLink).not.toHaveValue(
      'webcal://localhost:3000/functions/v1/calendar-feed?token=mock-token'
    );
    expect(screen.getByText(/New link generated/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Link' })).toBeEnabled();
  });
});
