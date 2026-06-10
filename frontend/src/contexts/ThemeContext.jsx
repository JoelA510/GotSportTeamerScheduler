import React, { createContext, useContext, useEffect, useState } from 'react';

/**
 * App settings context.
 *
 * Drives the Lightning-class light/dark theme: `themeMode` is persisted to
 * localStorage (`sl-theme`) and reflected as `data-theme` on <html>, which the
 * `[data-theme='dark']` token block in index.css responds to. Light is the
 * default; no attribute is set for light so the :root tokens apply as-is.
 *
 * The league / season / timezone fields are legacy state retained from the
 * pre-redesign provider; OrganizationContext is the canonical source for
 * org/season data and these fields are slated for removal.
 */
const ThemeContext = createContext(null);

const THEME_STORAGE_KEY = 'sl-theme';

function getStoredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeMode] = useState(getStoredTheme);

  useEffect(() => {
    if (themeMode === 'dark') {
      document.documentElement.dataset.theme = 'dark';
    } else {
      delete document.documentElement.dataset.theme;
    }
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  const toggleThemeMode = () => {
    setThemeMode((mode) => (mode === 'dark' ? 'light' : 'dark'));
  };

  const [leagueName, setLeagueName] = useState(() => {
    return localStorage.getItem('squadlogic-league-name') || 'My Youth League';
  });

  const [currentSeason, setCurrentSeason] = useState(() => {
    return localStorage.getItem('squadlogic-current-season') || '2025';
  });

  const [availableSeasons, setAvailableSeasons] = useState(() => {
    const saved = localStorage.getItem('squadlogic-available-seasons');
    return saved ? JSON.parse(saved) : ['2025'];
  });

  const [timezone, setTimezone] = useState(() => {
    return localStorage.getItem('squadlogic-timezone') || 'UTC';
  });

  const updateLeagueName = (name) => {
    setLeagueName(name);
    localStorage.setItem('squadlogic-league-name', name);
  };

  const updateCurrentSeason = (season) => {
    setCurrentSeason(season);
    localStorage.setItem('squadlogic-current-season', season);

    // Auto-add to available seasons if not present
    if (!availableSeasons.includes(season)) {
      const newSeasons = [...availableSeasons, season].sort();
      setAvailableSeasons(newSeasons);
      localStorage.setItem('squadlogic-available-seasons', JSON.stringify(newSeasons));
    }
  };

  const addSeason = (season) => {
    if (!availableSeasons.includes(season)) {
      const newSeasons = [...availableSeasons, season].sort();
      setAvailableSeasons(newSeasons);
      localStorage.setItem('squadlogic-available-seasons', JSON.stringify(newSeasons));
    }
  };

  const updateTimezone = (tz) => {
    setTimezone(tz);
    localStorage.setItem('squadlogic-timezone', tz);
  };

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        setThemeMode,
        toggleThemeMode,
        leagueName,
        updateLeagueName,
        currentSeason,
        updateCurrentSeason,
        timezone,
        updateTimezone,
        availableSeasons,
        addSeason,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
