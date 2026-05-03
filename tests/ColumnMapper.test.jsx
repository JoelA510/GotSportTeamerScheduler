import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ColumnMapper from '../frontend/src/components/ColumnMapper.jsx';

const rawHeaders = ['First Name', 'Last Name', 'Email', 'Phone'];
const sampleRows = [
  {
    'First Name': 'Alex',
    'Last Name': 'Smith',
    Email: 'alex@example.com',
    Phone: '555-1212',
  },
];
const autoMatches = {
  'First Name': 'first_name',
  'Last Name': 'last_name',
  Email: 'email',
};

describe('ColumnMapper', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes composite mapping mode as a pressed segmented control', () => {
    render(
      <ColumnMapper
        importType="coaches"
        rawHeaders={rawHeaders}
        sampleRows={sampleRows}
        autoMatches={autoMatches}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const modeGroup = screen.getByRole('group', { name: 'Full Name mapping mode' });
    const singleButton = screen.getByRole('button', { name: 'Single' });
    const combineButton = screen.getByRole('button', { name: 'Combine' });

    expect(modeGroup).toContainElement(singleButton);
    expect(modeGroup).toContainElement(combineButton);
    expect(singleButton).toHaveAttribute('aria-pressed', 'false');
    expect(combineButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Full Name first source column')).toHaveValue('First Name');
    expect(screen.getByLabelText('Full Name second source column')).toHaveValue('Last Name');
  });

  it('labels source column selects after switching back to single-column mode', () => {
    render(
      <ColumnMapper
        importType="coaches"
        rawHeaders={rawHeaders}
        sampleRows={sampleRows}
        autoMatches={autoMatches}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const singleButton = screen.getByRole('button', { name: 'Single' });
    fireEvent.click(singleButton);

    expect(singleButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Combine' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByLabelText('Full Name source column')).toHaveValue('');
    expect(screen.getByLabelText('Email source column')).toHaveValue('Email');
  });
});
