import React, { useState, useEffect } from 'react';
import { Shield, Plus, Save, Trash2, UserCircle, Users, Wand2, Filter } from 'lucide-react';
import { DEFAULT_DIVISIONS, Division } from '../lib/constants';
import { useSeason } from '../context/SeasonContext';
import { useClub, CLUB_THEMES } from '../context/ClubContext';

type Team = {
  id: string;
  name: string;
  minAge: number;
  maxAge: number;
  gender: 'M' | 'F' | 'C';
  coachId: string;
  divisionId: string;
};

const MOCK_COACHES = [
  { id: 'c1', name: 'Sarah Jenkins' },
  { id: 'c2', name: 'Mike Thompson' },
  { id: 'c3', name: 'David Rodriguez' },
  { id: 'c4', name: 'Emily Chen' },
  { id: 'c5', name: 'Marcus Johnson' },
  { id: 'c6', name: 'Jessica Taylor' },
];

const INITIAL_TEAMS: Team[] = [
  { id: 't1', name: 'U10B Lightning', minAge: 9, maxAge: 10, gender: 'M', coachId: 'c1', divisionId: 'd3' },
  { id: 't2', name: 'U10B Thunder', minAge: 9, maxAge: 10, gender: 'M', coachId: 'c2', divisionId: 'd3' },
  { id: 't3', name: 'U10G Storm', minAge: 9, maxAge: 10, gender: 'F', coachId: 'c3', divisionId: 'd4' },
  { id: 't4', name: 'U10G Tornadoes', minAge: 9, maxAge: 10, gender: 'F', coachId: '', divisionId: 'd4' },
];

export default function TeamViewer() {
  const { currentSeason } = useSeason();
  const { currentClub } = useClub();
  
  const stateKey = `${currentClub.id}_${currentSeason.id}`;
  const theme = CLUB_THEMES[currentClub.color];
  
  const [teamsByScope, setTeamsByScope] = useState<Record<string, Team[]>>({
    'c1_s2026': INITIAL_TEAMS,
    'c1_f2025': [INITIAL_TEAMS[0], INITIAL_TEAMS[2]],
  });

  const teams = teamsByScope[stateKey] || [];
  
  const setTeams = (updater: (prev: Team[]) => Team[]) => {
    setTeamsByScope(prev => ({
      ...prev,
      [stateKey]: updater(prev[stateKey] || [])
    }));
  };

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>('all');
  const [playerCount, setPlayerCount] = useState<number>(50); // Mock registered players for generation

  // Reset selected team when season or club changes
  useEffect(() => {
    const currentTeams = teamsByScope[stateKey] || [];
    if (currentTeams.length > 0) {
      setSelectedTeamId(currentTeams[0].id);
    } else {
      setSelectedTeamId(null);
    }
  }, [stateKey, teamsByScope]);

  const filteredTeams = selectedDivisionId === 'all' 
    ? teams 
    : teams.filter(t => t.divisionId === selectedDivisionId);

  const selectedTeam = teams.find(t => t.id === selectedTeamId);

  const handleUpdateTeam = (updates: Partial<Team>) => {
    if (!selectedTeamId) return;
    setTeams(prev => prev.map(t => t.id === selectedTeamId ? { ...t, ...updates } : t));
  };

  const handleAddTeam = () => {
    const div = DEFAULT_DIVISIONS.find(d => d.id === selectedDivisionId) || DEFAULT_DIVISIONS[2];
    const newTeam: Team = {
      id: `t${Date.now()}`,
      name: 'New Team',
      minAge: div.minAge,
      maxAge: div.maxAge,
      gender: div.gender,
      coachId: '',
      divisionId: div.id
    };
    setTeams([...teams, newTeam]);
    setSelectedTeamId(newTeam.id);
  };

  const handleDeleteTeam = (id: string) => {
    setTeams(prev => prev.filter(t => t.id !== id));
    if (selectedTeamId === id) {
      const remaining = teams.filter(t => t.id !== id);
      setSelectedTeamId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleGenerateTeams = () => {
    if (selectedDivisionId === 'all') {
      alert("Please select a specific division to generate teams.");
      return;
    }
    
    const div = DEFAULT_DIVISIONS.find(d => d.id === selectedDivisionId);
    if (!div) return;

    // Calculate how many teams are needed based on max roster size
    const numTeams = Math.ceil(playerCount / div.maxRoster);
    
    const newTeams: Team[] = [];
    for (let i = 0; i < numTeams; i++) {
      newTeams.push({
        id: `t${Date.now()}_${i}`,
        name: `${div.name} Team ${i + 1}`,
        minAge: div.minAge,
        maxAge: div.maxAge,
        gender: div.gender,
        coachId: '',
        divisionId: div.id
      });
    }

    // Replace existing teams in this division or just append? Let's replace for this demo.
    setTeams(prev => [
      ...prev.filter(t => t.divisionId !== selectedDivisionId),
      ...newTeams
    ]);
    if (newTeams.length > 0) {
      setSelectedTeamId(newTeams[0].id);
    }
  };

  return (
    <div className="animate-in fade-in duration-500">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">Team Viewer</h1>
          <p className="text-slate-400">Manage team profiles, age/gender constraints, and coach assignments for {currentSeason.name}.</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button 
            onClick={handleAddTeam}
            className="glass-button-secondary flex items-center gap-2"
          >
            <Plus size={18} />
            Create Team
          </button>
        </div>
      </header>

      <div className="glass-panel p-4 mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Filter size={18} className="text-slate-400" />
          <select 
            value={selectedDivisionId}
            onChange={(e) => setSelectedDivisionId(e.target.value)}
            className="glass-input text-sm py-2 min-w-[200px]"
          >
            <option value="all">All Divisions</option>
            {DEFAULT_DIVISIONS.map(div => (
              <option key={div.id} value={div.id}>{div.name}</option>
            ))}
          </select>
        </div>

        {selectedDivisionId !== 'all' && (
          <div className="flex items-center gap-4 w-full md:w-auto bg-slate-900/50 p-2 rounded-lg border border-white/5">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Registered Players:</label>
              <input 
                type="number" 
                value={playerCount}
                onChange={(e) => setPlayerCount(parseInt(e.target.value) || 0)}
                className="glass-input text-sm py-1 w-20 text-center"
              />
            </div>
            <div className="h-6 w-px bg-white/10"></div>
            <div className="text-xs text-slate-400">
              Max Team Size: <span className="text-white font-bold">{DEFAULT_DIVISIONS.find(d => d.id === selectedDivisionId)?.maxRoster}</span>
            </div>
            <button 
              onClick={handleGenerateTeams}
              className="glass-button flex items-center gap-2 bg-blue-600 hover:bg-blue-500 py-1.5 px-3 text-sm"
            >
              <Wand2 size={16} />
              Auto-Generate Teams
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Team List Sidebar */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          {filteredTeams.map(team => (
            <div 
              key={team.id}
              onClick={() => setSelectedTeamId(team.id)}
              className={`glass-card p-4 cursor-pointer transition-all duration-200 border-l-4 ${
                selectedTeamId === team.id 
                  ? `${theme.border.replace('/30', '')} bg-slate-800/80 ${theme.shadow}` 
                  : 'border-l-transparent hover:bg-white/5'
              }`}
            >
              <div className="flex justify-between items-start">
                <h3 className={`font-bold ${selectedTeamId === team.id ? 'text-white' : 'text-slate-300'}`}>
                  {team.name}
                </h3>
                <div className="flex items-center gap-1">
                  {team.gender === 'M' && <span className="text-xs font-mono bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/30">BOYS</span>}
                  {team.gender === 'F' && <span className="text-xs font-mono bg-pink-500/20 text-pink-400 px-1.5 py-0.5 rounded border border-pink-500/30">GIRLS</span>}
                  {team.gender === 'C' && <span className="text-xs font-mono bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/30">COED</span>}
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-400 font-mono flex items-center gap-2">
                <Users size={14} />
                U{team.maxAge} • {team.coachId ? MOCK_COACHES.find(c => c.id === team.coachId)?.name : 'No Coach'}
              </div>
            </div>
          ))}
          {filteredTeams.length === 0 && (
            <div className="glass-panel p-8 text-center text-slate-500 font-mono text-sm">
              No teams found in this division. Generate or create one to get started.
            </div>
          )}
        </div>

        {/* Team Editor */}
        <div className="lg:col-span-2">
          {selectedTeam ? (
            <div className="glass-panel p-6 sticky top-8 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Shield className="text-blue-400" size={24} />
                  Edit Team Profile
                </h2>
                <button 
                  onClick={() => handleDeleteTeam(selectedTeam.id)}
                  className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  title="Delete Team"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <div className="space-y-6">
                {/* Team Name */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Team Name</label>
                  <input 
                    type="text" 
                    value={selectedTeam.name}
                    onChange={(e) => handleUpdateTeam({ name: e.target.value })}
                    className="glass-input w-full text-lg font-bold text-white" 
                    placeholder="e.g. U10B Lightning"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Coach Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <UserCircle size={16} />
                      Head Coach
                    </label>
                    <select 
                      value={selectedTeam.coachId}
                      onChange={(e) => handleUpdateTeam({ coachId: e.target.value })}
                      className="glass-input w-full"
                    >
                      <option value="">-- Unassigned --</option>
                      {MOCK_COACHES.map(coach => (
                        <option key={coach.id} value={coach.id}>{coach.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Gender Toggle */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Gender Category</label>
                    <div className="flex bg-slate-900/50 p-1 rounded-lg border border-white/10">
                      <button
                        onClick={() => handleUpdateTeam({ gender: 'M' })}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                          selectedTeam.gender === 'M' 
                            ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]' 
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        Boys
                      </button>
                      <button
                        onClick={() => handleUpdateTeam({ gender: 'F' })}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                          selectedTeam.gender === 'F' 
                            ? 'bg-pink-600 text-white shadow-[0_0_10px_rgba(219,39,119,0.5)]' 
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        Girls
                      </button>
                      <button
                        onClick={() => handleUpdateTeam({ gender: 'C' })}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                          selectedTeam.gender === 'C' 
                            ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)]' 
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        Coed
                      </button>
                    </div>
                  </div>
                </div>

                {/* Age Constraints */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Age Constraints</label>
                  <div className="flex items-center gap-4 bg-slate-800/30 p-4 rounded-xl border border-white/5">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-slate-500 font-mono">Min Age</label>
                      <input 
                        type="number" 
                        value={selectedTeam.minAge}
                        onChange={(e) => handleUpdateTeam({ minAge: parseInt(e.target.value) || 0 })}
                        className="glass-input w-full font-mono" 
                        min="4" max="18"
                      />
                    </div>
                    <div className="text-slate-500 font-bold mt-5">TO</div>
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-slate-500 font-mono">Max Age</label>
                      <input 
                        type="number" 
                        value={selectedTeam.maxAge}
                        onChange={(e) => handleUpdateTeam({ maxAge: parseInt(e.target.value) || 0 })}
                        className="glass-input w-full font-mono" 
                        min="4" max="18"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Players outside this age range will trigger a conflict warning in the Roster Manager.
                  </p>
                </div>

                <div className="mt-8 pt-6 border-t border-white/10 flex justify-end">
                  <button className="glass-button flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500">
                    <Save size={18} />
                    Save Team Profile
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-panel h-full min-h-[400px] flex items-center justify-center text-slate-500">
              Select a team to view or edit its details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
