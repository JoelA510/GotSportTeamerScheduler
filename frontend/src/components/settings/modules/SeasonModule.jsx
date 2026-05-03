import React, { useState } from 'react';
import { useTheme } from '../../../contexts/ThemeContext.jsx';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { supabase } from '../../../lib/supabaseClient.js';

export default function SeasonModule() {
  const { currentSeason, updateCurrentSeason, availableSeasons, timezone, updateTimezone } =
    useTheme();
  const { user, isImpersonating } = useAuth();

  const [seasonFormat, setSeasonFormat] = useState('single');
  const [localCurrentSeason, setLocalCurrentSeason] = useState(currentSeason);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <p id="season-format-label" className="block text-sm font-medium text-text-secondary mb-2">
          Season Naming Format
        </p>
        <div className="grid grid-cols-2 gap-4" role="group" aria-labelledby="season-format-label">
          <button
            type="button"
            aria-pressed={seasonFormat === 'single'}
            onClick={async () => {
              setSeasonFormat('single');
              const orgId = user?.profile?.organization_id;
              if (orgId) {
                await supabase.rpc('record_audit_event', {
                  p_organization_id: orgId,
                  p_action: 'settings.season_format_updated',
                  p_metadata: {
                    format: 'single',
                    ...(isImpersonating && {
                      target_user_id: user.profile.id,
                      impersonated_by: user.id,
                      admin_email: user.email,
                    }),
                  },
                });
              }
            }}
            className={`p-4 rounded-lg border text-left transition-all ${
              seasonFormat === 'single'
                ? 'bg-brand-glow border-brand-400 text-text-primary'
                : 'bg-bg-surface border-border-subtle text-text-muted hover:bg-bg-surface-hover'
            }`}
          >
            <div className="font-medium mb-1">Single Year</div>
            <div className="text-xs opacity-70">e.g., &quot;2025&quot;, &quot;2026&quot;</div>
          </button>
          <button
            type="button"
            aria-pressed={seasonFormat === 'dual'}
            onClick={async () => {
              setSeasonFormat('dual');
              const orgId = user?.profile?.organization_id;
              if (orgId) {
                await supabase.rpc('record_audit_event', {
                  p_organization_id: orgId,
                  p_action: 'settings.season_format_updated',
                  p_metadata: {
                    format: 'dual',
                    ...(isImpersonating && {
                      target_user_id: user.profile.id,
                      impersonated_by: user.id,
                      admin_email: user.email,
                    }),
                  },
                });
              }
            }}
            className={`p-4 rounded-lg border text-left transition-all ${
              seasonFormat === 'dual'
                ? 'bg-brand-glow border-brand-400 text-text-primary'
                : 'bg-bg-surface border-border-subtle text-text-muted hover:bg-bg-surface-hover'
            }`}
          >
            <div className="font-medium mb-1">Dual Year</div>
            <div className="text-xs opacity-70">e.g., &quot;2025-2026&quot;</div>
          </button>
        </div>
      </div>

      <div>
        <label
          htmlFor="current-season-label"
          className="block text-sm font-medium text-text-secondary mb-2"
        >
          Current Season Label
        </label>
        <div className="space-y-3">
          <div className="relative">
            <input
              id="current-season-label"
              type="text"
              value={localCurrentSeason}
              onChange={(e) => setLocalCurrentSeason(e.target.value)}
              onBlur={async () => {
                updateCurrentSeason(localCurrentSeason);
                const orgId = user?.profile?.organization_id;
                if (orgId) {
                  await supabase.rpc('record_audit_event', {
                    p_organization_id: orgId,
                    p_action: 'settings.season_updated',
                    p_metadata: {
                      season: localCurrentSeason,
                      ...(isImpersonating && {
                        target_user_id: user.profile.id,
                        impersonated_by: user.id,
                        admin_email: user.email,
                      }),
                    },
                  });
                }
              }}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
              placeholder={seasonFormat === 'single' ? '2025' : '2025-2026'}
            />
            {availableSeasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {availableSeasons.map((season) => (
                  <button
                    key={season}
                    type="button"
                    aria-pressed={localCurrentSeason === season}
                    aria-label={`Select ${season} as current season`}
                    onClick={() => {
                      setLocalCurrentSeason(season);
                      updateCurrentSeason(season);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      localCurrentSeason === season
                        ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                        : 'bg-bg-surface text-text-muted border-border-subtle hover:bg-bg-surface-hover'
                    }`}
                  >
                    {season}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label
            htmlFor="season-timezone"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            Timezone
          </label>
          <select
            id="season-timezone"
            value={timezone}
            onChange={async (e) => {
              const newVal = e.target.value;
              updateTimezone(newVal);
              const orgId = user?.profile?.organization_id;
              if (orgId) {
                await supabase.rpc('record_audit_event', {
                  p_organization_id: orgId,
                  p_action: 'settings.timezone_updated',
                  p_metadata: {
                    timezone: newVal,
                    ...(isImpersonating && {
                      target_user_id: user.profile.id,
                      impersonated_by: user.id,
                      admin_email: user.email,
                    }),
                  },
                });
              }
            }}
            className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
          >
            <option value="America/Los_Angeles">Pacific Time (US & Canada)</option>
            <option value="America/Denver">Mountain Time (US & Canada)</option>
            <option value="America/Chicago">Central Time (US & Canada)</option>
            <option value="America/New_York">Eastern Time (US & Canada)</option>
            <option value="UTC">UTC</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="school-day-end"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            School Day End (Earliest Practice)
          </label>
          <input
            id="school-day-end"
            type="time"
            defaultValue="16:00"
            className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
          />
        </div>
      </div>
    </div>
  );
}
