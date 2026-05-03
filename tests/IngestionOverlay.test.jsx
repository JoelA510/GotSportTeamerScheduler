import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IngestionOverlay } from '../frontend/src/components/ui/IngestionOverlay.jsx';

const mocks = vi.hoisted(() => ({
  importState: {
    isImporting: true,
    progress: 42,
    activeJob: {
      job_type: 'players',
      efficiency_metadata: {
        efficiency: '94',
        latency: 12.4,
      },
    },
    importStatus: 'importing',
  },
}));

vi.mock('../frontend/src/contexts/ImportContext.jsx', () => ({
  useImport: () => mocks.importState,
}));

describe('IngestionOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.importState = {
      isImporting: true,
      progress: 42,
      activeJob: {
        job_type: 'players',
        efficiency_metadata: {
          efficiency: '94',
          latency: 12.4,
        },
      },
      importStatus: 'importing',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels overlay controls and exposes import progress', () => {
    render(<IngestionOverlay />);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const minimizeButton = screen.getByRole('button', { name: 'Minimize import status' });
    expect(minimizeButton).toHaveAttribute('type', 'button');
    expect(minimizeButton).toHaveAttribute('aria-expanded', 'true');

    expect(screen.getByRole('button', { name: 'Dismiss import status' })).toHaveAttribute(
      'type',
      'button'
    );
    expect(screen.getByRole('progressbar', { name: 'Registration Sync progress' })).toHaveAttribute(
      'aria-valuenow',
      '42'
    );

    fireEvent.click(minimizeButton);

    const expandButton = screen.getByRole('button', { name: 'Expand import status' });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('progressbar', { name: 'Registration Sync progress' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss import status' }));
    expect(screen.queryByText('Registration Sync')).not.toBeInTheDocument();
  });
});
