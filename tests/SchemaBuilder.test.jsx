import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchemaBuilder } from '../frontend/src/components/settings/SchemaBuilder.jsx';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  log: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: () => ({
    currentOrganization: {
      id: 'org-1',
    },
  }),
}));

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    from: mocks.from,
  },
}));

vi.mock('../frontend/src/lib/logger.js', () => ({
  logger: {
    log: mocks.log,
    error: mocks.error,
  },
}));

describe('SchemaBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [
            {
              entity_type: 'player',
              schema_definition: {
                jersey_size: 'string',
              },
            },
          ],
          error: null,
        }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it('exposes entity tabs, labels form controls, and keeps delete controls focus-visible', async () => {
    render(<SchemaBuilder />);

    const tablist = screen.getByRole('tablist', { name: 'Schema entity tabs' });
    const playersTab = screen.getByRole('tab', { name: 'Players' });
    const coachesTab = screen.getByRole('tab', { name: 'Coaches' });

    expect(tablist).toContainElement(playersTab);
    expect(playersTab).toHaveAttribute('type', 'button');
    expect(playersTab).toHaveAttribute('aria-selected', 'true');
    expect(playersTab).toHaveAttribute('aria-controls', 'schema-panel');
    expect(playersTab).toHaveAttribute('tabindex', '0');
    expect(coachesTab).toHaveAttribute('aria-selected', 'false');
    expect(coachesTab).toHaveAttribute('tabindex', '-1');

    await screen.findByText('jersey_size');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'schema-panel');
    const deleteButton = screen.getByRole('button', {
      name: 'Remove jersey_size player attribute',
    });
    expect(deleteButton).toHaveAttribute('type', 'button');
    expect(deleteButton).toHaveClass('focus-visible:opacity-100');

    expect(screen.getByLabelText('Field Identity')).toHaveAttribute('id', 'schema-field-name');
    expect(screen.getByLabelText('Data Structure')).toHaveAttribute('id', 'schema-field-type');

    fireEvent.click(coachesTab);
    expect(coachesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'schema-tab-coach');

    coachesTab.focus();
    fireEvent.keyDown(coachesTab, { key: 'ArrowRight' });
    const teamsTab = screen.getByRole('tab', { name: 'Teams' });
    expect(teamsTab).toHaveAttribute('aria-selected', 'true');
    expect(teamsTab).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'schema-tab-team');

    fireEvent.keyDown(teamsTab, { key: 'Home' });
    expect(playersTab).toHaveAttribute('aria-selected', 'true');
    expect(playersTab).toHaveFocus();
  });

  it('adds and removes drafted attributes through labeled controls', async () => {
    render(<SchemaBuilder />);

    await screen.findByText('jersey_size');

    fireEvent.change(screen.getByLabelText('Field Identity'), {
      target: { value: 'Emergency Contact' },
    });
    fireEvent.change(screen.getByLabelText('Data Structure'), {
      target: { value: 'string' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draft Attribute' }));

    expect(screen.getByText('emergency_contact')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove emergency_contact player attribute' })
    );

    await waitFor(() => {
      expect(screen.queryByText('emergency_contact')).not.toBeInTheDocument();
    });
  });
});
