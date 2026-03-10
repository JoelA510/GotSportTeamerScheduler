import React, { useState, useEffect } from 'react';
import { Calendar, Lock, Unlock, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useSeason } from '../context/SeasonContext';
import { useClub, CLUB_THEMES } from '../context/ClubContext';

const MOCK_PRACTICES = [
  { id: 'p1', team: 'U10 Lightning', coach: 'Smith', field: 'Centennial 1A', day: 'Monday', time: '5:00 PM - 6:30 PM', locked: true },
  { id: 'p2', team: 'U10 Thunder', coach: 'Johnson', field: 'Centennial 1B', day: 'Monday', time: '5:00 PM - 6:30 PM', locked: false },
  { id: 'p3', team: 'U10 Storm', coach: 'Williams', field: 'Oak Creek', day: 'Tuesday', time: '5:30 PM - 7:00 PM', locked: false },
  { id: 'p4', team: 'U12 Strikers', coach: 'Brown', field: 'Centennial 2A', day: 'Wednesday', time: '6:00 PM - 7:30 PM', locked: true },
  { id: 'p5', team: 'U12 United', coach: 'Davis', field: 'Centennial 2B', day: 'Wednesday', time: '6:00 PM - 7:30 PM', locked: false },
];

export default function PracticeSchedule() {
  const { currentSeason } = useSeason();
  const { currentClub } = useClub();
  
  const stateKey = `${currentClub.id}_${currentSeason.id}`;
  const theme = CLUB_THEMES[currentClub.color];
  
  const [practicesByScope, setPracticesByScope] = useState<Record<string, typeof MOCK_PRACTICES>>({
    'c1_s2026': MOCK_PRACTICES,
    'c1_f2025': [MOCK_PRACTICES[0], MOCK_PRACTICES[2], MOCK_PRACTICES[4]],
  });

  const practices = practicesByScope[stateKey] || [];
  
  const setPractices = (updater: (prev: typeof MOCK_PRACTICES) => typeof MOCK_PRACTICES) => {
    setPracticesByScope(prev => ({
      ...prev,
      [stateKey]: updater(prev[stateKey] || [])
    }));
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const toggleLock = (id: string) => {
    setPractices(prev => prev.map(p => p.id === id ? { ...p, locked: !p.locked } : p));
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => setIsGenerating(false), 1500);
  };

  return (
    <div className="animate-in fade-in duration-500">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">Practice Scheduling Engine</h1>
          <p className="text-slate-400">Automatically assign weekly practice slots based on coach availability and field capacity for {currentSeason.name}.</p>
        </div>
        <button 
          onClick={handleGenerate}
          disabled={isGenerating}
          className={`glass-button flex items-center gap-2 ${theme.primary} hover:opacity-90 disabled:opacity-50`}
        >
          <RefreshCw size={18} className={isGenerating ? "animate-spin" : ""} />
          {isGenerating ? 'Generating...' : 'Run Scheduler'}
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/80 border-b border-white/10">
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Team</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Coach</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Field</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Day & Time</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {practices.map(practice => (
                    <tr key={practice.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 font-bold text-white">{practice.team}</td>
                      <td className="p-4 text-slate-300">{practice.coach}</td>
                      <td className={`p-4 ${theme.text} font-mono text-sm`}>{practice.field}</td>
                      <td className="p-4 text-slate-300">
                        <div className="flex flex-col">
                          <span className="font-semibold">{practice.day}</span>
                          <span className="text-xs text-slate-500 font-mono">{practice.time}</span>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <button 
                          onClick={() => toggleLock(practice.id)}
                          className={`p-2 rounded-lg transition-colors inline-flex ${
                            practice.locked 
                              ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30' 
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700'
                          }`}
                          title={practice.locked ? "Unlock slot" : "Lock slot"}
                        >
                          {practice.locked ? <Lock size={16} /> : <Unlock size={16} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="glass-panel p-6 sticky top-8">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-4">Readiness Panel</h3>
            
            <div className="space-y-4 mb-6">
              <div className="glass-card p-4 border-emerald-500/30 bg-emerald-950/20 flex items-start gap-3">
                <CheckCircle2 className="text-emerald-400 mt-0.5" size={18} />
                <div>
                  <h4 className="text-emerald-400 font-bold text-sm">All Teams Assigned</h4>
                  <p className="text-emerald-300/70 text-xs mt-1">36/36 teams have practice slots.</p>
                </div>
              </div>
              
              <div className="glass-card p-4 border-amber-500/30 bg-amber-950/20 flex items-start gap-3">
                <AlertTriangle className="text-amber-400 mt-0.5" size={18} />
                <div>
                  <h4 className="text-amber-400 font-bold text-sm">Coach Conflict Risk</h4>
                  <p className="text-amber-300/70 text-xs mt-1">Coach Smith has back-to-back practices at different locations.</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Locked Slots</span>
                <span className="font-mono text-amber-400">{practices.filter(p => p.locked).length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Field Utilization</span>
                <span className="font-mono text-white">85%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
