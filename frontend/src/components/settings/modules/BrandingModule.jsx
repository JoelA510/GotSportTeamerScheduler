import React, { useRef } from 'react';
import { Upload, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext.jsx';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { supabase } from '../../../lib/supabaseClient.js';
import { extractColorsFromImage } from '../../../utils/colorUtils.js';
import { logger } from '../../../lib/logger.js';

export default function BrandingModule() {
  const {
    clubColors,
    updateClubColors,
    clubLogo,
    updateClubLogo,
    clubMode,
    updateClubMode,
    extractedColors,
    updateExtractedColors,
  } = useTheme();
  const { user, isImpersonating } = useAuth();

  const fileInputRef = useRef(null);

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target.result;
      if (typeof dataUrl !== 'string') return;
      updateClubLogo(dataUrl);

      try {
        const colors = await extractColorsFromImage(dataUrl);
        updateExtractedColors(colors);

        // Audit logo change
        const orgId = user?.profile?.organization_id;
        if (orgId) {
          await supabase.rpc('record_audit_event', {
            p_organization_id: orgId,
            p_action: 'settings.logo_updated',
            p_metadata: { 
              user_id: user.id,
              is_impersonating: isImpersonating
            }
          });
        }
      } catch (error) {
        logger.error('Failed to extract colors', error);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleColorSuggestionClick = (color, type) => {
    updateClubColors({ [type]: color });
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-4">Club Branding</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label
                htmlFor="primary-accent"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                Primary Accent
              </label>
              <div className="flex gap-3 items-center">
                <input
                  id="primary-accent"
                  type="color"
                  value={clubColors.primaryAccent}
                  onChange={(e) => updateClubColors({ primaryAccent: e.target.value })}
                  className="w-12 h-12 rounded cursor-pointer bg-transparent border-0 p-0"
                />
                <span className="text-text-muted font-mono">{clubColors.primaryAccent}</span>
              </div>
            </div>
            {/* Background and Secondary Accent inputs omitted for brevity, but they'll be here */}
            {/* actually I should include them all since I'm decomposing the original file */}
            <div>
              <label
                htmlFor="secondary-accent"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                Secondary Accent
              </label>
              <div className="flex gap-3 items-center">
                <input
                  id="secondary-accent"
                  type="color"
                  value={clubColors.secondaryAccent}
                  onChange={(e) => updateClubColors({ secondaryAccent: e.target.value })}
                  className="w-12 h-12 rounded cursor-pointer bg-transparent border-0 p-0"
                />
                <span className="text-text-muted font-mono">{clubColors.secondaryAccent}</span>
              </div>
            </div>
            <div>
              <label
                htmlFor="background-1"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                Background 1 (Gradient Start)
              </label>
              <div className="flex gap-3 items-center">
                <input
                  id="background-1"
                  type="color"
                  value={clubColors.background1}
                  onChange={(e) => updateClubColors({ background1: e.target.value })}
                  className="w-12 h-12 rounded cursor-pointer bg-transparent border-0 p-0"
                />
                <span className="text-text-muted font-mono">{clubColors.background1}</span>
              </div>
            </div>
            <div>
              <label
                htmlFor="background-2"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                Background 2 (Gradient End)
              </label>
              <div className="flex gap-3 items-center">
                <input
                  id="background-2"
                  type="color"
                  value={clubColors.background2}
                  onChange={(e) => updateClubColors({ background2: e.target.value })}
                  className="w-12 h-12 rounded cursor-pointer bg-transparent border-0 p-0"
                />
                <span className="text-text-muted font-mono">{clubColors.background2}</span>
              </div>
            </div>
          </div>
          <div>
            <label
              htmlFor="club-logo-upload"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Club Logo
            </label>
            <div
              className="border-2 border-dashed border-border-subtle rounded-lg p-6 text-center hover:bg-bg-surface-hover transition-colors cursor-pointer h-full flex flex-col items-center justify-center relative overflow-hidden"
              onClick={() => fileInputRef.current?.click()}
            >
              {clubLogo ? (
                <img src={clubLogo} alt="Club Logo" className="max-h-32 object-contain mb-2" />
              ) : (
                <Upload className="mx-auto h-8 w-8 text-text-muted mb-2" />
              )}
              <p className="text-sm text-text-muted">
                {clubLogo ? 'Click to change logo' : 'Click to upload logo'}
              </p>
              <p className="text-xs text-text-muted mt-1">PNG, JPG up to 2MB</p>
              <input
                id="club-logo-upload"
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleLogoUpload}
              />
            </div>
          </div>
        </div>

        {/* Color Suggestions */}
        {extractedColors.length > 0 && (
          <div className="mt-6 p-4 bg-bg-surface rounded-lg border border-border-subtle">
            <h4 className="text-sm font-medium text-text-primary mb-3">
              Detected Colors from Logo
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {extractedColors.map((color, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-2 rounded-lg border border-white/5 bg-white/5"
                >
                  <div
                    className="w-12 h-12 rounded-lg shadow-sm shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <div className="flex flex-col gap-1 w-full">
                    <div className="text-xs font-mono text-text-muted mb-1">{color}</div>
                    <div className="grid grid-cols-2 gap-1 w-full mt-1">
                      {['background1', 'background2', 'primaryAccent', 'secondaryAccent'].map(
                        (type) => (
                          <button
                            key={type}
                            onClick={() => handleColorSuggestionClick(color, type)}
                            className="px-1 py-1 text-[10px] font-medium rounded bg-bg-surface hover:bg-brand-500 hover:text-white transition-colors border border-white/10 text-center truncate"
                          >
                            {type === 'background1'
                              ? 'BG 1'
                              : type === 'background2'
                                ? 'BG 2'
                                : type === 'primaryAccent'
                                  ? 'Acc 1'
                                  : 'Acc 2'}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-white/10 pt-6">
        <h3 className="text-lg font-medium text-text-primary mb-4">Theme Configuration</h3>
        <div className="mb-6">
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Base Theme Mode (for Club Theme)
          </label>
          <div className="flex gap-4">
            <button
              onClick={() => updateClubMode('light')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                clubMode === 'light'
                  ? 'bg-brand-glow border-brand-400 text-text-primary'
                  : 'bg-bg-surface border-border-subtle text-text-muted hover:bg-bg-surface-hover'
              }`}
            >
              <Sun size={16} /> Light Base
            </button>
            <button
              onClick={() => updateClubMode('dark')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                clubMode === 'dark'
                  ? 'bg-brand-glow border-brand-400 text-text-primary'
                  : 'bg-bg-surface border-border-subtle text-text-muted hover:bg-bg-surface-hover'
              }`}
            >
              <Moon size={16} /> Dark Base
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
