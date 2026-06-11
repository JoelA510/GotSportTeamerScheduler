import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SetupChecklist from '../frontend/src/components/setup/SetupChecklist.jsx';

const mocks = vi.hoisted(() => ({
  progress: null,
}));

vi.mock('../frontend/src/hooks/useSetupProgress.js', () => ({
  useSetupProgress: () => mocks.progress,
}));

const steps = [
  {
    id: 'features',
    title: 'Choose your tools',
    description: 'Pick features.',
    route: '/setup/features',
    done: true,
    count: 'Configured',
  },
  {
    id: 'import',
    title: 'Import registrations',
    description: 'Upload the CSV.',
    route: '/import',
    done: false,
    count: 'Not started',
  },
  {
    id: 'teams',
    title: 'Generate & balance teams',
    description: 'Auto-allocate players.',
    route: '/teams',
    done: false,
    count: 'Not started',
  },
];

describe('SetupChecklist', () => {
  beforeEach(() => {
    mocks.progress = {
      steps,
      doneCount: 1,
      total: 3,
      percent: 33,
      nextStep: steps[1],
      loaded: true,
    };
  });

  it('renders the resumable checklist with done/next states', () => {
    render(
      <MemoryRouter>
        <SetupChecklist />
      </MemoryRouter>
    );
    expect(screen.getByRole('progressbar', { name: 'Season setup progress' })).toHaveAttribute(
      'aria-valuenow',
      '33'
    );
    expect(screen.getByText(/nothing resets when you go back/i)).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Up next')).toBeInTheDocument();
    // done → Review, next → Continue, later → Open
    expect(screen.getByRole('button', { name: /Review/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open/ })).toBeInTheDocument();
  });

  it('navigates when a step action is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <SetupChecklist onNavigate={onNavigate} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(onNavigate).toHaveBeenCalledWith('/import');
  });
});
