import React, { createContext, useContext, useState, ReactNode } from 'react';

export type ClubColor = 'blue' | 'emerald' | 'purple' | 'amber' | 'rose';

export const CLUB_THEMES: Record<ClubColor, {
  primary: string;
  text: string;
  border: string;
  bgLight: string;
  shadow: string;
  iconShadow: string;
}> = {
  blue: {
    primary: 'bg-blue-600',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    bgLight: 'bg-blue-600/20',
    shadow: 'shadow-[inset_0_0_10px_rgba(59,130,246,0.1)]',
    iconShadow: 'shadow-[0_0_15px_rgba(37,99,235,0.5)]',
  },
  emerald: {
    primary: 'bg-emerald-600',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    bgLight: 'bg-emerald-600/20',
    shadow: 'shadow-[inset_0_0_10px_rgba(16,185,129,0.1)]',
    iconShadow: 'shadow-[0_0_15px_rgba(16,185,129,0.5)]',
  },
  purple: {
    primary: 'bg-purple-600',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    bgLight: 'bg-purple-600/20',
    shadow: 'shadow-[inset_0_0_10px_rgba(168,85,247,0.1)]',
    iconShadow: 'shadow-[0_0_15px_rgba(168,85,247,0.5)]',
  },
  amber: {
    primary: 'bg-amber-600',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    bgLight: 'bg-amber-600/20',
    shadow: 'shadow-[inset_0_0_10px_rgba(245,158,11,0.1)]',
    iconShadow: 'shadow-[0_0_15px_rgba(245,158,11,0.5)]',
  },
  rose: {
    primary: 'bg-rose-600',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
    bgLight: 'bg-rose-600/20',
    shadow: 'shadow-[inset_0_0_10px_rgba(225,29,72,0.1)]',
    iconShadow: 'shadow-[0_0_15px_rgba(225,29,72,0.5)]',
  },
};

export type Club = {
  id: string;
  name: string;
  shortName: string;
  color: ClubColor;
};

const CLUBS: Club[] = [
  { id: 'c1', name: 'SquadLogic FC', shortName: 'SL', color: 'blue' },
  { id: 'c2', name: 'Metro City United', shortName: 'MCU', color: 'emerald' },
  { id: 'c3', name: 'Valley Strikers', shortName: 'VS', color: 'purple' },
  { id: 'c4', name: 'Coastal Surge', shortName: 'CS', color: 'amber' },
];

interface ClubContextType {
  clubs: Club[];
  currentClub: Club;
  setCurrentClub: (club: Club) => void;
}

const ClubContext = createContext<ClubContextType | undefined>(undefined);

export function ClubProvider({ children }: { children: ReactNode }) {
  const [currentClub, setCurrentClub] = useState<Club>(CLUBS[0]);

  return (
    <ClubContext.Provider value={{ clubs: CLUBS, currentClub, setCurrentClub }}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  const context = useContext(ClubContext);
  if (context === undefined) {
    throw new Error('useClub must be used within a ClubProvider');
  }
  return context;
}
