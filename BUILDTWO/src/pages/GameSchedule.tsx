import React, { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, Download, Mail, Play, CheckCircle2 } from 'lucide-react';
import { useSeason } from '../context/SeasonContext';
import { useClub, CLUB_THEMES } from '../context/ClubContext';

const MOCK_GAMES = [
  { id: 'g1', date: 'Oct 3, 2026', time: '9:00 AM', home: 'U10 Lightning', away: 'U10 Thunder', field: 'Centennial 1A' },
  { id: 'g2', date: 'Oct 3, 2026', time: '10:30 AM', home: 'U10 Storm', away: 'U10 Tornadoes', field: 'Centennial 1A' },
  { id: 'g3', date: 'Oct 3, 2026', time: '9:00 AM', home: 'U12 Strikers', away: 'U12 United', field: 'Centennial 2A' },
  { id: 'g4', date: 'Oct 3, 2026', time: '10:30 AM', home: 'U12 City', away: 'U12 Rovers', field: 'Centennial 2A' },
  { id: 'g5', date: 'Oct 10, 2026', time: '9:00 AM', home: 'U10 Thunder', away: 'U10 Storm', field: 'Centennial 1A' },
];

export default function GameSchedule() {
  const { currentSeason } = useSeason();
  const { currentClub } = useClub();
  
  const stateKey = `${currentClub.id}_${currentSeason.id}`;
  const theme = CLUB_THEMES[currentClub.color];
  
  const [gamesByScope, setGamesByScope] = useState<Record<string, typeof MOCK_GAMES>>({
    'c1_s2026': MOCK_GAMES,
    'c1_f2025': [MOCK_GAMES[0], MOCK_GAMES[2]],
  });

  const games = gamesByScope[stateKey] || [];
  
  const setGames = (updater: (prev: typeof MOCK_GAMES) => typeof MOCK_GAMES) => {
    setGamesByScope(prev => ({
      ...prev,
      [stateKey]: updater(prev[stateKey] || [])
    }));
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => setIsGenerating(false), 2000);
  };

  return (
    <div className="animate-in fade-in duration-500">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">Game Scheduling Engine</h1>
          <p className="text-slate-400">Generate a full-season round-robin game schedule and manage outputs for {currentSeason.name}.</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button className="glass-button-secondary flex items-center gap-2">
            <Download size={18} />
            Export CSV
          </button>
          <button className="glass-button-secondary flex items-center gap-2">
            <Mail size={18} />
            Email Coaches
          </button>
          <button 
            onClick={handleGenerate}
            disabled={isGenerating}
            className={`glass-button flex items-center gap-2 ${theme.primary} hover:opacity-90 disabled:opacity-50`}
          >
            <Play size={18} className={isGenerating ? "animate-pulse" : ""} />
            {isGenerating ? 'Generating...' : 'Generate Season'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <div className="glass-panel overflow-hidden">
            <div className="p-4 border-b border-white/10 bg-slate-900/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h3 className="font-bold text-white">Master Schedule</h3>
              <div className="flex gap-2">
                <select className="glass-input text-sm py-1">
                  <option>All Divisions</option>
                  <option>U10 Boys</option>
                  <option>U12 Boys</option>
                </select>
                <select className="glass-input text-sm py-1">
                  <option>Week 1 (Oct 3)</option>
                  <option>Week 2 (Oct 10)</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/40 border-b border-white/10">
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Date & Time</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Home</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center">vs</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Away</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Field</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {games.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500 font-mono text-sm">
                        No games scheduled for {currentSeason.name}. Click "Generate Season" to create the schedule.
                      </td>
                    </tr>
                  ) : (
                    games.map(game => (
                      <tr key={game.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-white">{game.date}</span>
                            <span className="text-xs text-slate-400 font-mono">{game.time}</span>
                          </div>
                        </td>
                        <td className="p-4 text-right font-bold text-blue-400">{game.home}</td>
                        <td className="p-4 text-center text-slate-600 font-mono text-xs">VS</td>
                        <td className="p-4 font-bold text-emerald-400">{game.away}</td>
                        <td className="p-4 text-slate-300 font-mono text-sm">
                          <div className="flex items-center gap-2">
                            <CalendarIcon size={14} className="text-slate-500" />
                            {game.field}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="glass-panel p-6 sticky top-8">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-4">Schedule Diagnostics</h3>
            
            <div className="space-y-4 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Total Games</span>
                <span className="font-mono text-white">180</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Weeks</span>
                <span className="font-mono text-white">10</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Byes Assigned</span>
                <span className="font-mono text-amber-400">4</span>
              </div>
            </div>

            <div className="glass-card p-4 border-emerald-500/30 bg-emerald-950/20 flex items-start gap-3">
              <CheckCircle2 className="text-emerald-400 mt-0.5" size={18} />
              <div>
                <h4 className="text-emerald-400 font-bold text-sm">Schedule Valid</h4>
                <p className="text-emerald-300/70 text-xs mt-1">No coach conflicts detected. Field utilization is optimal.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
