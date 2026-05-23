import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FieldManagementPage from '../frontend/src/pages/FieldManagementPage.jsx';

vi.mock('../frontend/src/hooks/useFields.js', () => ({ useFields: vi.fn() }));

import { useFields } from '../frontend/src/hooks/useFields.js';

const baseHook = {
  locations: [{ id: 'loc-1', name: 'Main Complex' }],
  fields: [{
    id: 'field-1', location_id: 'loc-1', name: 'North Field', active: true,
    surface_type: 'Grass', size: '11v11', priority_rating: 1, supports_halves: false,
    field_subunits: [], practice_slots: [{ id: 'ps-1', day_of_week: 'mon', start_time: '17:00:00', end_time: '18:00:00' }],
  }],
  availabilityProfiles: [],
  loading: false,
  addLocation: vi.fn(), addField: vi.fn(), updateField: vi.fn(), deleteField: vi.fn(),
};

describe('FieldManagementPage seasonal availability panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useFields).mockReturnValue(baseHook);
  });

  it('renders empty seasonal state and keeps slot grid', () => {
    render(<FieldManagementPage />);
    expect(screen.getByText('No seasonal availability profiles imported yet.')).toBeInTheDocument();
    expect(screen.getByText('North Field')).toBeInTheDocument();
    expect(screen.getByText('mon')).toBeInTheDocument();
  });

  it('renders imported seasonal profiles and badge text content', () => {
    vi.mocked(useFields).mockReturnValue({
      ...baseHook,
      availabilityProfiles: [{
        id: 'ap-1', season_label: 'Fall 2026', location: 'Canyon', field_name: 'Turf 11v11 Pods',
        record_status: 'potential', approval_status: 'pending',
        available_from: '2026-08-01', available_until: '2026-11-30', blackout_months: 'Aug, Sep',
        teams_per_hour: 2, aggregate_teams_per_hour: 8,
        day_constraints: 'Sat/Sun', move_to_location: 'Vannoy', lighted: true, restroom: false, potty: true,
        field_availability_profile_formats: [{ id: 'f1', format_code: '11v11', format_quantity: 4 }],
        field_blackout_windows: [{ id: 'b1', blackout_from: '2026-09-01', blackout_until: '2026-09-30', reason: 'Maintenance' }],
        field_equipment_requirements: [{ id: 'e1', goal_equipment: 'sturdy goals', requirement_status: 'required' }],
      }],
    });

    render(<FieldManagementPage />);
    expect(screen.getByText('Fall 2026')).toBeInTheDocument();
    expect(screen.getByText('Status: potential')).toBeInTheDocument();
    expect(screen.getByText('Approval: pending')).toBeInTheDocument();
    expect(screen.getByText('Potential state')).toBeInTheDocument();
    expect(screen.getByText(/Blackouts: 2026-09-01 to 2026-09-30/)).toBeInTheDocument();
    expect(screen.getByText(/Equipment flags: sturdy goals \(required\)/)).toBeInTheDocument();
    expect(screen.getByText('Aug: Yes')).toBeInTheDocument();
  });

  it('shows conditional and excluded state badges', () => {
    vi.mocked(useFields).mockReturnValue({
      ...baseHook,
      availabilityProfiles: [
        { id: 'ap-2', season_label: 'Fall 2026', location: 'A', field_name: 'B', record_status: 'conditional', field_availability_profile_formats: [], field_blackout_windows: [], field_equipment_requirements: [] },
        { id: 'ap-3', season_label: 'Fall 2026', location: 'C', field_name: 'D', record_status: 'excluded', field_availability_profile_formats: [], field_blackout_windows: [], field_equipment_requirements: [] },
      ],
    });

    render(<FieldManagementPage />);
    expect(screen.getByText('Conditional state')).toBeInTheDocument();
    expect(screen.getByText('Excluded state')).toBeInTheDocument();
  });
});
