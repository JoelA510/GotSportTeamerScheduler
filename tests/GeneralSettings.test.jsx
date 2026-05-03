import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GeneralSettings from '../frontend/src/components/settings/GeneralSettings.jsx';

vi.mock('../frontend/src/contexts/ThemeContext.jsx', () => ({
  useTheme: () => ({
    leagueName: 'Demo League',
    updateLeagueName: vi.fn(),
  }),
}));

vi.mock('../frontend/src/components/settings/modules/AccountModule.jsx', () => ({
  default: () => <div>Account module content</div>,
}));

vi.mock('../frontend/src/components/settings/modules/BrandingModule.jsx', () => ({
  default: () => <div>Branding module content</div>,
}));

vi.mock('../frontend/src/components/settings/modules/SeasonModule.jsx', () => ({
  default: () => <div>Season module content</div>,
}));

describe('GeneralSettings', () => {
  it('exposes settings sections as keyboard-navigable tabs', () => {
    render(<GeneralSettings />);

    const tablist = screen.getByRole('tablist', { name: 'General settings sections' });
    const identityTab = screen.getByRole('tab', { name: 'League Identity' });
    const accountTab = screen.getByRole('tab', { name: 'Account & Security' });

    expect(tablist).toContainElement(identityTab);
    expect(identityTab).toHaveAttribute('type', 'button');
    expect(identityTab).toHaveAttribute('aria-selected', 'true');
    expect(identityTab).toHaveAttribute('aria-controls', 'general-settings-panel');
    expect(accountTab).toHaveAttribute('aria-selected', 'false');
    expect(accountTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'general-settings-tab-identity'
    );

    fireEvent.click(accountTab);

    expect(accountTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Account module content')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'general-settings-tab-account'
    );

    accountTab.focus();
    fireEvent.keyDown(accountTab, { key: 'ArrowRight' });

    const brandingTab = screen.getByRole('tab', { name: 'Branding & Theme' });
    expect(brandingTab).toHaveAttribute('aria-selected', 'true');
    expect(brandingTab).toHaveFocus();
    expect(screen.getByText('Branding module content')).toBeInTheDocument();

    fireEvent.keyDown(brandingTab, { key: 'End' });

    const seasonTab = screen.getByRole('tab', { name: 'Season & Calendar' });
    expect(seasonTab).toHaveAttribute('aria-selected', 'true');
    expect(seasonTab).toHaveFocus();
    expect(screen.getByText('Season module content')).toBeInTheDocument();
  });
});
