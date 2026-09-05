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
    // 8.2: a co-coach with an address of their own gets their own draft; one
    // with none is counted and reported rather than silently skipped.
    assistantCoachIds: ['coach-2', 'coach-3'],
    assistantCoaches: ['Robin Coach', 'Sam Coach'],
    assistantCoachEmails: ['robin@example.com', ''],
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
  it('generates CSV output and uses explicit button controls', async () => {
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

    expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled();
    expect(screen.getByText('Generating CSVs...')).toBeInTheDocument();
    expect(await screen.findByText('Generated Files')).toBeInTheDocument();
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

    expect(
      screen.getByText(
        'Generated 2 email drafts, one per coach. 1 coach(es) have no name or address on file and were not written to.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/To: Alex Coach <alex@example\.com>/)).toBeInTheDocument();
    // The co-coach who used to get nothing.
    expect(screen.getByText(/To: Robin Coach <robin@example\.com>/)).toBeInTheDocument();
    // …and the one with no address is named in the count, not dropped in silence.
    expect(screen.queryByText(/To: Sam Coach/)).toBeNull();
    expect(screen.getAllByText(/Your assigned practice schedule is:/).length).toBe(2);
  });
});
