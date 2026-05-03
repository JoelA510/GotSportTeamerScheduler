import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImportPanel from '../frontend/src/components/ImportPanel.jsx';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  startImport: vi.fn(),
  applyDeferredImport: vi.fn(),
  cancelDeferredImport: vi.fn(),
  resetImport: vi.fn(),
  setNotifyOnComplete: vi.fn(),
  rollbackImport: vi.fn(),
}));

vi.mock('papaparse', () => ({
  default: {
    parse: mocks.parse,
  },
}));

vi.mock('../frontend/src/contexts/ImportContext.jsx', () => ({
  useImport: () => ({
    isImporting: false,
    progress: 0,
    importStatus: 'idle',
    startImport: mocks.startImport,
    applyDeferredImport: mocks.applyDeferredImport,
    cancelDeferredImport: mocks.cancelDeferredImport,
    resetImport: mocks.resetImport,
    notifyOnComplete: false,
    setNotifyOnComplete: mocks.setNotifyOnComplete,
    importedPlayers: null,
    importedCoaches: null,
    importedFields: null,
    rollbackImport: mocks.rollbackImport,
    telemetryLogs: [],
    activeJob: null,
  }),
}));

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: () => ({
    currentOrganization: { id: 'org-1' },
  }),
}));

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
  },
}));

describe('ImportPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parse.mockImplementation((_file, options) => {
      options.complete({
        data: [{ first_name: 'Alex', last_name: 'Smith', date_of_birth: '2016-01-01' }],
        meta: { fields: ['first_name', 'last_name', 'date_of_birth'] },
      });
    });
  });

  it('exposes smart mapping confidence tooltips to keyboard focus', async () => {
    render(<ImportPanel onImport={vi.fn()} />);

    const input = screen.getByLabelText(/browse files/i);
    const file = new File(
      ['first_name,last_name,date_of_birth\nAlex,Smith,2016-01-01'],
      'players.csv',
      {
        type: 'text/csv',
      }
    );

    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText('players.csv');
    const badges = screen.getAllByLabelText(/header match confidence/i);
    const firstBadge = badges[0];
    const tooltipId = firstBadge.getAttribute('aria-describedby');

    expect(firstBadge).toHaveAttribute('tabindex', '0');
    expect(tooltipId).toBeTruthy();

    const tooltip = document.getElementById(tooltipId);
    expect(tooltip).toHaveAttribute('role', 'tooltip');
    expect(tooltip).toHaveClass('group-focus-visible:opacity-100');

    firstBadge.focus();
    await waitFor(() => expect(firstBadge).toHaveFocus());
  });
});
