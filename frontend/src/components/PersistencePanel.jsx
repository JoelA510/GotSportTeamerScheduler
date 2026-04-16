import React from 'react';
import PropTypes from 'prop-types';
import { PERSISTENCE_THEMES } from '../utils/themes.js';

export default function PersistencePanel({
  status,
  lastSync,
  theme: themeKey = 'blue',
  onSync,
}) {
  const theme = PERSISTENCE_THEMES[themeKey] || PERSISTENCE_THEMES.blue;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${theme.gradientFrom} ${theme.gradientTo} p-6`}
    >
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
            <div className={`h-3 w-3 rounded-full ${theme.dotColor} ${theme.shadowColor}`} />
            <div
              className={`absolute inset-0 animate-ping rounded-full ${theme.dotColor} opacity-20`}
            />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Supabase Persistence</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-sm font-medium ${theme.statusText}`}>
                {status === 'syncing' ? 'Syncing active...' : 'System Ready'}
              </span>
              <span className="text-white/20">•</span>
              <span className="text-sm text-white/50">
                {lastSync ? `Last updated ${lastSync}` : 'No recent sync'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onSync}
            disabled={status === 'syncing'}
            className="glass-button relative z-20"
          >
            {status === 'syncing' ? 'Syncing...' : 'Sync to Supabase'}
          </button>
        </div>
      </div>

      {/* Background Decorative Element */}
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/5 blur-3xl pointer-events-none" />
    </div>
  );
}

PersistencePanel.propTypes = {
  status: PropTypes.string.isRequired,
  lastSync: PropTypes.string,
  theme: PropTypes.oneOf(['blue', 'green']),
  onSync: PropTypes.func.isRequired,
};
