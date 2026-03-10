import React, { createContext, useContext, useState, ReactNode } from 'react';

type Season = {
  id: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
};

const SEASONS: Season[] = [
  { id: 's2026', name: 'Spring 2026', year: 2026, startDate: '2026-03-01', endDate: '2026-05-31' },
  { id: 'f2025', name: 'Fall 2025', year: 2025, startDate: '2025-09-01', endDate: '2025-11-30' },
  { id: 's2025', name: 'Spring 2025', year: 2025, startDate: '2025-03-01', endDate: '2025-05-31' },
  { id: 'f2024', name: 'Fall 2024', year: 2024, startDate: '2024-09-01', endDate: '2024-11-30' },
];

interface SeasonContextType {
  seasons: Season[];
  currentSeason: Season;
  setCurrentSeason: (season: Season) => void;
  updateSeason: (id: string, updates: Partial<Season>) => void;
}

const SeasonContext = createContext<SeasonContextType | undefined>(undefined);

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [seasons, setSeasons] = useState<Season[]>(SEASONS);
  const [currentSeasonId, setCurrentSeasonId] = useState<string>(SEASONS[0].id);

  const currentSeason = seasons.find(s => s.id === currentSeasonId) || seasons[0];

  const setCurrentSeason = (season: Season) => {
    setCurrentSeasonId(season.id);
  };

  const updateSeason = (id: string, updates: Partial<Season>) => {
    setSeasons(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  return (
    <SeasonContext.Provider value={{ seasons, currentSeason, setCurrentSeason, updateSeason }}>
      {children}
    </SeasonContext.Provider>
  );
}

export function useSeason() {
  const context = useContext(SeasonContext);
  if (context === undefined) {
    throw new Error('useSeason must be used within a SeasonProvider');
  }
  return context;
}
