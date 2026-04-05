import React, { useState } from 'react';
import { useTheme } from '../../../contexts/ThemeContext.jsx';

export default function SeasonModule() {
  const { currentSeason, updateCurrentSeason, availableSeasons, timezone, updateTimezone } =
    useTheme();

  const [seasonFormat, setSeasonFormat] = useState('single');
  const [localCurrentSeason, setLocalCurrentSeason] = useState(currentSeason);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">
          Season Naming Format
        </label>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setSeasonFormat('single')}
            className={`p-4 rounded-lg border text-left transition-all ${
              seasonFormat === 'single'
                ? 'bg-brand-glow border-brand-400 text-text-primary'
                : 'bg-bg-surface border-border-subtle text-text-muted hover:bg-bg-surface-hover'
            }`}
          >
            <div className="font-medium mb-1">Single Year</div>
            <div className="text-xs opacity-70">e.g., "2025", "2026"</div>
          </button>
          <button
            onClick={() => setSeasonFormat('dual')}
            className={`p-4 rounded-lg border text-left transition-all ${
              seasonFormat === 'dual'
                ? 'bg-brand-glow border-brand-400 text-text-primary'
                : 'bg-bg-surface border-border-subtle text-text-muted hover:bg-bg-surface-hover'
            }`}
          >
            <div className="font-medium mb-1">Dual Year</div>
            <div className="text-xs opacity-70">e.g., "2025-2026"</div>
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
              onBlur={() => updateCurrentSeason(localCurrentSeason)}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
              placeholder={seasonFormat === 'single' ? '2025' : '2025-2026'}
            />
            {availableSeasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {availableSeasons.map((season) => (
                  <button
                    key={season}
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
            onChange={(e) => updateTimezone(e.target.value)}
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
