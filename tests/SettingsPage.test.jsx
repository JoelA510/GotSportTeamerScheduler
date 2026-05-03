import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsPage from '../frontend/src/pages/SettingsPage.jsx';

vi.mock('../frontend/src/contexts/OrganizationContext.jsx', () => ({
  useOrganization: () => ({
    permissions: ['manage_global_settings', 'manage_organization'],
  }),
}));

vi.mock('../frontend/src/components/settings/GeneralSettings.jsx', () => ({
  default: () => <div>General Settings Panel</div>,
}));

vi.mock('../frontend/src/components/settings/InvitesSettings.jsx', () => ({
  default: () => <div>Invites Settings Panel</div>,
}));

vi.mock('../frontend/src/components/settings/FeatureFlagSettings.jsx', () => ({
  default: () => <div>Feature Flags Settings Panel</div>,
}));

vi.mock('../frontend/src/components/settings/AuditLogSettings.jsx', () => ({
  default: () => <div>Audit Log Settings Panel</div>,
}));

describe('SettingsPage', () => {
  it('exposes organization settings sections as keyboard-navigable tabs', () => {
    render(<SettingsPage />);

    const tablist = screen.getByRole('tablist', { name: 'Organization settings tabs' });
    const generalTab = screen.getByRole('tab', { name: 'General' });
    const invitesTab = screen.getByRole('tab', { name: 'Invites' });
    const featureFlagsTab = screen.getByRole('tab', { name: 'Feature Flags' });
    const auditLogTab = screen.getByRole('tab', { name: 'Audit Log' });

    expect(tablist).toContainElement(generalTab);
    expect(generalTab).toHaveAttribute('type', 'button');
    expect(generalTab).toHaveAttribute('aria-selected', 'true');
    expect(invitesTab).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(generalTab, { key: 'ArrowRight' });

    expect(invitesTab).toHaveAttribute('aria-selected', 'true');
    expect(invitesTab).toHaveFocus();

    fireEvent.keyDown(invitesTab, { key: 'End' });

    expect(auditLogTab).toHaveAttribute('aria-selected', 'true');
    expect(auditLogTab).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Audit Log' })).toHaveTextContent(
      'Audit Log Settings Panel'
    );

    fireEvent.keyDown(auditLogTab, { key: 'Home' });

    expect(generalTab).toHaveAttribute('aria-selected', 'true');
    expect(generalTab).toHaveFocus();

    fireEvent.keyDown(generalTab, { key: 'ArrowLeft' });

    expect(auditLogTab).toHaveAttribute('aria-selected', 'true');
    expect(auditLogTab).toHaveFocus();

    fireEvent.keyDown(auditLogTab, { key: 'ArrowRight' });

    expect(generalTab).toHaveAttribute('aria-selected', 'true');
    expect(generalTab).toHaveFocus();

    fireEvent.click(featureFlagsTab);

    expect(featureFlagsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Feature Flags' })).toHaveTextContent(
      'Feature Flags Settings Panel'
    );
  });
});
