import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import RosterManager from './pages/RosterManager';
import DataImport from './pages/DataImport';
import FieldAllocation from './pages/FieldAllocation';
import PracticeSchedule from './pages/PracticeSchedule';
import GameSchedule from './pages/GameSchedule';
import Settings from './pages/Settings';
import Account from './pages/Account';
import TeamViewer from './pages/TeamViewer';
import { SeasonProvider } from './context/SeasonContext';
import { ClubProvider } from './context/ClubContext';

// Placeholder components for other routes
const Placeholder = ({ title }: { title: string }) => (
  <div className="glass-panel p-8 flex flex-col items-center justify-center min-h-[400px] animate-in fade-in">
    <h2 className="text-2xl font-bold text-white mb-4">{title}</h2>
    <p className="text-slate-400 text-center max-w-md">
      This module is currently under development. Please check back later or use the Roster Manager to test the core drag-and-drop functionality.
    </p>
  </div>
);

export default function App() {
  return (
    <ClubProvider>
      <SeasonProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="import" element={<DataImport />} />
              <Route path="teams" element={<TeamViewer />} />
              <Route path="rosters" element={<RosterManager />} />
              <Route path="fields" element={<FieldAllocation />} />
              <Route path="practice" element={<PracticeSchedule />} />
              <Route path="games" element={<GameSchedule />} />
              <Route path="settings" element={<Settings />} />
              <Route path="account" element={<Account />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SeasonProvider>
    </ClubProvider>
  );
}
