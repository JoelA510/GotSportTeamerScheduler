import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OutputGenerationPanel from '../frontend/src/components/OutputGenerationPanel.jsx';

const teams = [
  {
    id: 'team-1',
    name: 'Blue Bears',
    division: 'U10',
    coachName: 'Alex Coach',
    coachEmail: 'alex@example.com',
  },
];

const practiceAssignments = [
  {
    teamId: 'team-1',
    start: '2026-04-06T17:30:00Z',
    end: '2026-04-06T18:30:00Z',
    day: 'Monday',
    fieldId: 'Field 1',
    slotId: 'practice_17:30',
    notes: 'Half field',
  },
];

describe('OutputGenerationPanel', () => {
  it('generates CSV output immediately and uses explicit button controls', () => {
    render(
      <OutputGenerationPanel
        teams={teams}
        practiceAssignments={practiceAssignments}
        supabaseClient={null}
      />
    );

    const generateButton = screen.getByRole('button', { name: 'Generate CSVs' });
    expect(generateButton).toHaveAttribute('type', 'button');

    fireEvent.click(generateButton);

    expect(screen.getByText('Generated Files')).toBeInTheDocument();
    expect(screen.getByText('Master Schedule: 1 rows')).toBeInTheDocument();
    expect(screen.getByText('Team Schedules: 1 files')).toBeInTheDocument();
    expect(screen.getByText('CSVs generated successfully.')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Upload to Storage' })).toHaveAttribute(
      'type',
      'button'
    );
    expect(screen.getByRole('button', { name: 'Download Master CSV' })).toHaveAttribute(
      'type',
      'button'
    );
  });

  it('generates coach email drafts from the available team schedule', () => {
    render(
      <OutputGenerationPanel
        teams={teams}
        practiceAssignments={practiceAssignments}
        supabaseClient={null}
      />
    );

    const emailButton = screen.getByRole('button', { name: 'Generate Draft Welcome Emails' });
    expect(emailButton).toHaveAttribute('type', 'button');

    fireEvent.click(emailButton);

    expect(screen.getByText('Generated 1 email drafts.')).toBeInTheDocument();
    expect(screen.getByText(/To: Alex Coach <alex@example\.com>/)).toBeInTheDocument();
    expect(screen.getByText(/Your assigned practice schedule is:/)).toBeInTheDocument();
  });
});
