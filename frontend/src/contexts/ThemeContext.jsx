import React, { createContext, useContext, useState } from 'react';

/**
 * App settings context.
 *
 * Historically this also drove the multi-theme "Deep Space Glass" system
 * (dark / light / party / club) and dynamic club branding. The app is now a
 * single, flat light theme, so the theme-switching and club-branding logic has
 * been removed. The provider keeps its original name to avoid churn across
 * consumers; it now holds only league / season / timezone settings, persisted
 * to localStorage.
 */
const ThemeContext = createContext(null);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
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
