import React, { useState } from 'react';
import { Settings as SettingsIcon, Save, Building2, Calendar, Users, Clock, Shield } from 'lucide-react';
import { DEFAULT_DIVISIONS } from '../lib/constants';

import { useClub, CLUB_THEMES } from '../context/ClubContext';

export default function Settings() {
  const { currentClub } = useClub();
  const [activeTab, setActiveTab] = useState<'organization' | 'season' | 'divisions'>('season');
  const [divisions, setDivisions] = useState(DEFAULT_DIVISIONS);

  const theme = CLUB_THEMES[currentClub.color];

  return (
    <div className="animate-in fade-in duration-500">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">League Settings</h1>
          <p className="text-slate-400">Configure global parameters, season dates, and division rules.</p>
        </div>
        <button className="glass-button flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500">
          <Save size={18} />
          Save Changes
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1">
          <div className="glass-panel p-2 flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('organization')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium ${
                activeTab === 'organization'
                  ? `${theme.bgLight} ${theme.text} border ${theme.border}`
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Building2 size={18} />
              Organization
            </button>
            <button
              onClick={() => setActiveTab('season')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium ${
                activeTab === 'season'
                  ? `${theme.bgLight} ${theme.text} border ${theme.border}`
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Calendar size={18} />
              Season Config
            </button>
            <button
              onClick={() => setActiveTab('divisions')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium ${
                activeTab === 'divisions'
                  ? `${theme.bgLight} ${theme.text} border ${theme.border}`
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Users size={18} />
              Divisions
            </button>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="glass-panel p-6 min-h-[500px]">
            {activeTab === 'organization' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold text-white border-b border-white/10 pb-4 mb-6">Organization Profile</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">League Name</label>
                    <input type="text" className="glass-input w-full" defaultValue="SquadLogic Premier League" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Contact Email</label>
                    <input type="email" className="glass-input w-full" defaultValue="admin@squadlogic.com" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Timezone</label>
                    <select className="glass-input w-full">
                      <option>America/Los_Angeles (PT)</option>
                      <option>America/Denver (MT)</option>
                      <option>America/Chicago (CT)</option>
                      <option>America/New_York (ET)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Default Location</label>
                    <input type="text" className="glass-input w-full" defaultValue="Centennial Park Complex" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'season' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold text-white border-b border-white/10 pb-4 mb-6">Season Configuration</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Season Name</label>
                    <input type="text" className="glass-input w-full" defaultValue="Fall 2026" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Status</label>
                    <select className="glass-input w-full">
                      <option>Drafting</option>
                      <option>Active</option>
                      <option>Completed</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Start Date</label>
                    <input type="date" className="glass-input w-full" defaultValue="2026-09-01" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">End Date</label>
                    <input type="date" className="glass-input w-full" defaultValue="2026-11-15" />
                  </div>
                </div>

                <h3 className="text-lg font-bold text-white border-b border-white/10 pb-2 mt-8 mb-4 flex items-center gap-2">
                  <Clock size={18} className="text-blue-400" />
                  Scheduling Constraints
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">School Day Ends</label>
                    <input type="time" className="glass-input w-full" defaultValue="15:30" />
                    <p className="text-xs text-slate-500 mt-1">Practices cannot be scheduled before this time on weekdays.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Latest Practice End</label>
                    <input type="time" className="glass-input w-full" defaultValue="20:30" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'divisions' && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-6">
                  <h2 className="text-xl font-bold text-white">Divisions</h2>
                  <button className="glass-button-secondary text-sm py-1">Add Division</button>
                </div>
                
                <div className="space-y-4">
                  {divisions.map((div) => (
                    <div key={div.id} className="glass-card p-4 flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-white">{div.name}</h4>
                        <div className="flex gap-4 mt-1 text-sm text-slate-400 font-mono">
                          <span>Format: {div.format}</span>
                          <span>Max Team Size: {div.maxRoster}</span>
                          <span>Game Length: {div.duration}m</span>
                        </div>
                      </div>
                      <button className="text-blue-400 hover:text-blue-300 text-sm font-semibold">Edit</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
