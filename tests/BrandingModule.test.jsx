import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BrandingModule from '../frontend/src/components/settings/modules/BrandingModule.jsx';

const mocks = vi.hoisted(() => ({
  updateClubColors: vi.fn(),
  updateClubLogo: vi.fn(),
  updateClubMode: vi.fn(),
  updateExtractedColors: vi.fn(),
  rpc: vi.fn(),
  theme: {
    clubLogo: null,
  },
}));

vi.mock('../frontend/src/contexts/ThemeContext.jsx', () => ({
  useTheme: () => ({
    clubColors: {
      primaryAccent: '#3366ff',
      secondaryAccent: '#ff6633',
      background1: '#111827',
      background2: '#1f2937',
    },
    updateClubColors: mocks.updateClubColors,
    clubLogo: mocks.theme.clubLogo,
    updateClubLogo: mocks.updateClubLogo,
    clubMode: 'dark',
    updateClubMode: mocks.updateClubMode,
    extractedColors: ['#112233'],
    updateExtractedColors: mocks.updateExtractedColors,
  }),
}));

vi.mock('../frontend/src/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'admin@example.com',
      profile: { id: 'profile-1', organization_id: 'org-1' },
    },
    isImpersonating: false,
  }),
}));

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

describe('BrandingModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.theme.clubLogo = null;
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it('labels logo upload, color suggestions, and base theme choices', () => {
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');

    render(<BrandingModule />);

    const logoButton = screen.getByRole('button', { name: 'Club Logo Upload logo' });
    expect(logoButton).toHaveAttribute('type', 'button');
    expect(logoButton).toHaveAccessibleDescription('PNG, JPG up to 2MB');

    fireEvent.click(logoButton);

    expect(inputClickSpy).toHaveBeenCalled();

    const colorGroup = screen.getByRole('group', { name: 'Apply detected color #112233' });
    const primaryAccentButton = within(colorGroup).getByRole('button', {
      name: 'Apply #112233 as Primary Accent',
    });

    expect(primaryAccentButton).toHaveAttribute('type', 'button');

    fireEvent.click(primaryAccentButton);

    expect(mocks.updateClubColors).toHaveBeenCalledWith({ primaryAccent: '#112233' });

    const themeGroup = screen.getByRole('group', { name: 'Base Theme Mode (for Club Theme)' });
    const lightButton = within(themeGroup).getByRole('button', { name: 'Light Base' });
    const darkButton = within(themeGroup).getByRole('button', { name: 'Dark Base' });

    expect(lightButton).toHaveAttribute('type', 'button');
    expect(lightButton).toHaveAttribute('aria-pressed', 'false');
    expect(darkButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(lightButton);

    expect(mocks.updateClubMode).toHaveBeenCalledWith('light');

    inputClickSpy.mockRestore();
  });

  it('keeps an existing logo preview decorative inside the named upload button', () => {
    mocks.theme.clubLogo = 'data:image/png;base64,logo';

    render(<BrandingModule />);

    const logoButton = screen.getByRole('button', { name: 'Club Logo Change logo' });
    const previewImage = logoButton.querySelector('img');

    expect(previewImage).toHaveAttribute('alt', '');
  });
});
