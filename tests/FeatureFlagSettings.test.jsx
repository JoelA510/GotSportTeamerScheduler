import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FeatureFlagSettings from '../frontend/src/components/settings/FeatureFlagSettings.jsx';

const mocks = vi.hoisted(() => ({
  updateFeatureFlags: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: () => ({
    featureFlags: {
      advanced_fairness: true,
      coach_overlap_strict: false,
    },
    updateFeatureFlags: mocks.updateFeatureFlags,
    loading: false,
    currentOrganization: { id: 'org-1' },
  }),
}));

vi.mock('../frontend/src/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 'user-1', profile: { id: 'profile-1' }, email: 'admin@example.com' },
    isImpersonating: false,
  }),
}));

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

describe('FeatureFlagSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateFeatureFlags.mockResolvedValue({ success: true });
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it('exposes feature toggles as named switches with checked state', () => {
    render(<FeatureFlagSettings />);

    const fairnessSwitch = screen.getByRole('switch', {
      name: 'Advanced Fairness Evaluation Enterprise',
    });
    const coachConflictSwitch = screen.getByRole('switch', {
      name: 'Strict Coach Conflict Enforcement',
    });

    expect(fairnessSwitch).toHaveAttribute('type', 'button');
    expect(fairnessSwitch).toHaveAttribute('aria-checked', 'true');
    expect(fairnessSwitch).toHaveAccessibleDescription(
      'Enables multi-weighted metrics for team balancing including commute time and coach experience.'
    );
    expect(coachConflictSwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(coachConflictSwitch);

    expect(coachConflictSwitch).toHaveAttribute('aria-checked', 'true');
  });
});
