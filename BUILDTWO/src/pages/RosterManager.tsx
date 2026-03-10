import React, { useState, useMemo, useEffect } from 'react';
import { Users, Zap, ShieldAlert, RotateCcw, Save } from 'lucide-react';
import { useSeason } from '../context/SeasonContext';
import { useClub, CLUB_THEMES } from '../context/ClubContext';
import { 
  DndContext, 
  DragEndEvent, 
  DragOverlay, 
  DragStartEvent, 
  PointerSensor, 
  TouchSensor, 
  useSensor, 
  useSensors, 
  useDroppable, 
  useDraggable, 
  closestCorners 
} from '@dnd-kit/core';

// --- Types ---
type Player = {
  id: string;
  name: string;
  age: number;
  gender: 'M' | 'F';
  skillRating: number;
  buddyId?: string;
  teamId: string | null;
};

type Team = {
  id: string;
  name: string;
  minAge: number;
  maxAge: number;
  gender: 'M' | 'F';
  coachName?: string;
};

// --- Mock Data ---
const INITIAL_TEAMS: Team[] = [
  { id: 't1', name: 'U10B Lightning', minAge: 9, maxAge: 10, gender: 'M', coachName: 'Sarah Jenkins' },
  { id: 't2', name: 'U10B Thunder', minAge: 9, maxAge: 10, gender: 'M', coachName: 'Mike Thompson' },
  { id: 't3', name: 'U10G Storm', minAge: 9, maxAge: 10, gender: 'F', coachName: 'David Rodriguez' },
  { id: 't4', name: 'U10G Tornadoes', minAge: 9, maxAge: 10, gender: 'F', coachName: 'Unassigned' },
];

const FIRST_NAMES = ["Liam", "Olivia", "Noah", "Emma", "Oliver", "Charlotte", "Elijah", "Amelia", "James", "Ava", "William", "Sophia", "Benjamin", "Isabella", "Lucas", "Mia", "Henry", "Evelyn", "Theodore", "Harper", "Jack", "Luna", "Levi", "Camila", "Alexander", "Gianna", "Jackson", "Elizabeth", "Mateo", "Eleanor", "Daniel", "Ella", "Michael", "Abigail", "Mason", "Sofia", "Sebastian", "Avery", "Ethan", "Scarlett"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores"];

const generatePlayers = (seed: string): Player[] => {
  const players: Player[] = [];
  // Use seed to generate deterministic but different players for different seasons
  const seedNum = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  for (let i = 0; i < 40; i++) {
    const randomVal = ((seedNum + i) * 9301 + 49297) % 233280 / 233280;
    players.push({
      id: `p${i + 1}_${seed}`,
      name: `${FIRST_NAMES[(i + seedNum) % FIRST_NAMES.length]} ${LAST_NAMES[(i + seedNum * 2) % LAST_NAMES.length]}`,
      age: randomVal > 0.5 ? 9 : 10,
      gender: i % 2 === 0 ? 'M' : 'F',
      skillRating: Math.floor(randomVal * 51) + 50, // 50-100
      teamId: null,
    });
  }

  // Set up mutual buddies (must be same gender and age group to be valid)
  const buddyPairs = [[0, 2], [1, 3], [4, 6], [5, 7], [8, 10]];
  buddyPairs.forEach(([idx1, idx2]) => {
    players[idx1].age = 9;
    players[idx2].age = 9;
    players[idx1].buddyId = players[idx2].id;
    players[idx2].buddyId = players[idx1].id;
  });

  // Add an invalid buddy pair (boy and girl) to test conflict engine
  players[12].buddyId = players[13].id;
  players[13].buddyId = players[12].id;

  return players;
};

// Remove INITIAL_PLAYERS constant since we generate per season

// --- Components ---

const PlayerCardDraggable = ({ player }: { player: Player; key?: React.Key }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: player.id,
    data: { player },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`glass-card p-3 mb-3 cursor-grab active:cursor-grabbing hover:bg-white/10 transition-colors group ${isDragging ? 'opacity-50 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : ''}`}
    >
      <div className="flex justify-between items-start mb-1">
        <div className="font-bold tracking-tight truncate pr-2 text-white">{player.name}</div>
        <div className="font-mono font-black text-lg leading-none text-blue-400">{player.skillRating}</div>
      </div>
      <div className="flex justify-between items-center">
        <div className="text-xs font-mono uppercase text-slate-400 group-hover:text-slate-300">
          {player.gender} • {player.age}Y
        </div>
        {player.buddyId && (
          <div className="text-xs font-mono font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 border border-emerald-500/30 rounded flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
            <Users size={12} />
            BUDDY
          </div>
        )}
      </div>
    </div>
  );
};

const PlayerCardOverlay = ({ player, theme }: { player: Player, theme: any }) => {
  return (
    <div className={`glass-card p-3 mb-3 ${theme.bgLight} border ${theme.border} ${theme.shadow} cursor-grabbing rotate-3 scale-105`}>
      <div className="flex justify-between items-start mb-1">
        <div className="font-bold tracking-tight truncate pr-2 text-white">{player.name}</div>
        <div className={`font-mono font-black text-lg leading-none ${theme.text}`}>{player.skillRating}</div>
      </div>
      <div className="flex justify-between items-center">
        <div className="text-xs font-mono uppercase text-slate-300">
          {player.gender} • {player.age}Y
        </div>
        {player.buddyId && (
          <div className="text-xs font-mono font-bold bg-emerald-500/40 text-emerald-300 px-1.5 py-0.5 border border-emerald-400 rounded flex items-center gap-1">
            <Users size={12} />
            BUDDY
          </div>
        )}
      </div>
    </div>
  );
};

const DroppableContainer = ({ id, title, children, count, maxCount, avgSkill, isUnassigned, team, theme }: any) => {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div 
      ref={setNodeRef}
      className={`glass-panel flex flex-col h-[600px] lg:h-full transition-all duration-300 ${isOver ? `${theme.bgLight} border ${theme.border} ${theme.shadow}` : ''}`}
    >
      {isUnassigned ? (
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-800/50 rounded-t-2xl">
          <h2 className="font-bold uppercase tracking-widest text-white">{title}</h2>
          <span className={`font-mono font-bold ${theme.primary} text-white px-2 py-1 rounded text-xs ${theme.iconShadow}`}>{count}</span>
        </div>
      ) : (
        <div className="p-4 border-b border-white/10 bg-slate-800/50 rounded-t-2xl">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="font-bold uppercase tracking-widest text-lg text-white">{title}</h2>
              <div className="text-xs text-slate-400 font-mono mt-1">
                U{team.maxAge} {team.gender === 'M' ? 'Boys' : 'Girls'} • Coach: {team.coachName || 'Unassigned'}
              </div>
            </div>
          </div>
          <div className="flex justify-between items-end">
            <div className="font-mono text-xs flex flex-col gap-1">
              <span className="uppercase text-slate-400">Avg Skill</span>
              <span className={`text-lg font-bold ${theme.text}`}>{avgSkill.toFixed(1)}</span>
            </div>
            <div className="font-mono text-xs flex flex-col gap-1 text-right">
              <span className="uppercase text-slate-400">Roster Size</span>
              <span className={`text-lg font-bold ${count > maxCount ? 'text-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]' : 'text-white'}`}>
                {count} <span className="text-sm text-slate-500">/ {maxCount}</span>
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {children}
        {count === 0 && (
          <div className="h-full flex items-center justify-center text-slate-500 font-mono text-sm uppercase text-center p-4 border-2 border-dashed border-white/10 rounded-xl">
            {isUnassigned ? 'All players assigned' : 'Drag players here'}
          </div>
        )}
      </div>
    </div>
  );
};

export default function RosterManager() {
  const { currentSeason } = useSeason();
  const { currentClub } = useClub();
  
  const stateKey = `${currentClub.id}_${currentSeason.id}`;
  
  const [playersByScope, setPlayersByScope] = useState<Record<string, Player[]>>({});
  const [teamsByScope, setTeamsByScope] = useState<Record<string, Team[]>>({
    'c1_s2026': INITIAL_TEAMS,
    'c1_f2025': [INITIAL_TEAMS[0], INITIAL_TEAMS[2]],
  });
  
  const [activeId, setActiveId] = useState<string | null>(null);

  const theme = CLUB_THEMES[currentClub.color];

  // Initialize players for current scope if not exists
  useEffect(() => {
    if (!playersByScope[stateKey]) {
      setPlayersByScope(prev => ({
        ...prev,
        [stateKey]: generatePlayers(stateKey)
      }));
    }
  }, [stateKey, playersByScope]);

  const players = playersByScope[stateKey] || [];
  const teams = teamsByScope[stateKey] || [];
  
  const setPlayers = (updater: (prev: Player[]) => Player[]) => {
    setPlayersByScope(prev => ({
      ...prev,
      [stateKey]: updater(prev[stateKey] || [])
    }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const playerId = active.id as string;
    const targetContainerId = over.id as string;

    setPlayers(prev => prev.map(p => {
      if (p.id === playerId) {
        return { ...p, teamId: targetContainerId === 'unassigned' ? null : targetContainerId };
      }
      return p;
    }));
  };

  const handleAutoDraft = () => {
    setPlayers(prev => {
      const newPlayers = [...prev];
      const unassigned = newPlayers.filter(p => !p.teamId).sort((a, b) => b.skillRating - a.skillRating);
      const processed = new Set<string>();
      
      unassigned.forEach(p => {
        if (processed.has(p.id)) return;

        const eligibleTeams = teams.filter(t => p.age >= t.minAge && p.age <= t.maxAge && p.gender === t.gender);
        if (eligibleTeams.length === 0) return;

        let buddy: Player | undefined;
        if (p.buddyId) {
          const potentialBuddy = newPlayers.find(bp => bp.id === p.buddyId);
          if (potentialBuddy && potentialBuddy.buddyId === p.id && !potentialBuddy.teamId) {
            const buddyEligibleTeams = teams.filter(t => potentialBuddy.age >= t.minAge && potentialBuddy.age <= t.maxAge && potentialBuddy.gender === t.gender);
            const sharedTeams = eligibleTeams.filter(t => buddyEligibleTeams.some(bt => bt.id === t.id));
            if (sharedTeams.length > 0) {
              buddy = potentialBuddy;
            }
          }
        }

        const teamStats = eligibleTeams.map(t => {
          const teamPlayers = newPlayers.filter(np => np.teamId === t.id);
          const avgSkill = teamPlayers.length > 0 
            ? teamPlayers.reduce((sum, np) => sum + np.skillRating, 0) / teamPlayers.length 
            : 0;
          return { id: t.id, count: teamPlayers.length, avgSkill };
        });

        teamStats.sort((a, b) => {
          if (a.count !== b.count) return a.count - b.count;
          return a.avgSkill - b.avgSkill;
        });

        const selectedTeamId = teamStats[0].id;
        
        const playerIndex = newPlayers.findIndex(np => np.id === p.id);
        newPlayers[playerIndex] = { ...newPlayers[playerIndex], teamId: selectedTeamId };
        processed.add(p.id);

        if (buddy) {
          const buddyIndex = newPlayers.findIndex(np => np.id === buddy!.id);
          newPlayers[buddyIndex] = { ...newPlayers[buddyIndex], teamId: selectedTeamId };
          processed.add(buddy.id);
        }
      });

      return newPlayers;
    });
  };

  const handleReset = () => {
    setPlayers(prev => prev.map(p => ({ ...p, teamId: null })));
  };

  const conflicts = useMemo(() => {
    const detected: { type: string; message: string; p1?: Player; p2?: Player }[] = [];
    const checked = new Set<string>();

    players.forEach(p1 => {
      // Check buddy separation
      if (p1.buddyId && !checked.has(p1.id)) {
        const p2 = players.find(p => p.id === p1.buddyId);
        if (p2 && p2.buddyId === p1.id) {
          checked.add(p1.id);
          checked.add(p2.id);
          
          const p1Eligible = teams.filter(t => p1.age >= t.minAge && p1.age <= t.maxAge && p1.gender === t.gender);
          const p2Eligible = teams.filter(t => p2.age >= t.minAge && p2.age <= t.maxAge && p2.gender === t.gender);
          const sharedTeams = p1Eligible.filter(t => p2Eligible.some(bt => bt.id === t.id));
          
          if (sharedTeams.length > 0) {
            if (p1.teamId && p2.teamId && p1.teamId !== p2.teamId) {
              detected.push({ 
                type: 'buddy', 
                message: `Buddy pair separated: ${p1.name} & ${p2.name}`,
                p1, p2 
              });
            }
          } else if (p1.teamId || p2.teamId) {
            detected.push({
              type: 'invalid_buddy',
              message: `Invalid buddy request (Age/Gender mismatch): ${p1.name} & ${p2.name}`,
              p1, p2
            });
          }
        }
      }

      // Check team compatibility
      if (p1.teamId) {
        const team = teams.find(t => t.id === p1.teamId);
        if (team) {
          if (p1.gender !== team.gender) {
            detected.push({
              type: 'gender',
              message: `Gender mismatch: ${p1.name} (${p1.gender}) assigned to ${team.name} (${team.gender})`,
              p1
            });
          }
          if (p1.age < team.minAge || p1.age > team.maxAge) {
            detected.push({
              type: 'age',
              message: `Age mismatch: ${p1.name} (Age ${p1.age}) assigned to ${team.name} (U${team.maxAge})`,
              p1
            });
          }
        }
      }
    });
    return detected;
  }, [players]);

  const unassignedPlayers = useMemo(() => {
    return players.filter(p => !p.teamId).sort((a, b) => b.skillRating - a.skillRating);
  }, [players]);

  const activePlayer = useMemo(() => players.find(p => p.id === activeId), [activeId, players]);

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={closestCorners} 
      onDragStart={handleDragStart} 
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full animate-in fade-in duration-500">
        {/* Conflict Banner */}
        {conflicts.length > 0 && (
          <div className="bg-red-900/80 backdrop-blur-md text-white p-4 border border-red-500 rounded-xl mb-6 flex flex-col gap-2 shadow-[0_0_30px_rgba(239,68,68,0.3)] animate-in slide-in-from-top-4">
            <div className="flex items-center gap-2 font-bold uppercase tracking-widest text-red-300">
              <ShieldAlert size={20} />
              Conflict Detected
            </div>
            <div className="flex flex-col gap-2">
              {conflicts.map((c, i) => (
                <div key={i} className="font-mono text-sm bg-red-950/50 p-3 rounded-lg border border-red-800/50 flex items-center justify-between">
                  <span>{c.message}</span>
                  {c.type === 'buddy' && c.p1 && c.p2 && (
                    <div className="flex gap-2">
                      <span className="bg-slate-800 px-2 py-1 rounded text-xs">{teams.find(t=>t.id===c.p1!.teamId)?.name}</span>
                      <span className="bg-slate-800 px-2 py-1 rounded text-xs">{teams.find(t=>t.id===c.p2!.teamId)?.name}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white mb-1">Roster Manager</h1>
            <p className="font-mono text-sm text-slate-400">U10 DIVISION • {currentSeason.name.toUpperCase()}</p>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <button 
              onClick={handleReset}
              className="glass-button-secondary flex items-center justify-center gap-2 flex-1 md:flex-none"
            >
              <RotateCcw size={18} />
              <span className="hidden md:inline">Reset</span>
            </button>
            <button 
              onClick={handleAutoDraft}
              className="glass-button flex items-center justify-center gap-2 flex-1 md:flex-none"
            >
              <Zap size={18} />
              Auto-Draft
            </button>
            <button 
              className="glass-button flex items-center justify-center gap-2 flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-500"
            >
              <Save size={18} />
              Save Snapshot
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex flex-col lg:flex-row gap-6 min-h-[600px]">
          {/* Unassigned Column */}
          <div className="w-full lg:w-1/4 h-full flex flex-col">
            <DroppableContainer id="unassigned" title="Unassigned" count={unassignedPlayers.length} isUnassigned theme={theme}>
              {unassignedPlayers.map(p => <PlayerCardDraggable key={p.id} player={p} />)}
            </DroppableContainer>
          </div>

          {/* Teams Grid */}
          <div className="w-full lg:w-3/4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6 h-full">
            {teams.length === 0 ? (
              <div className="col-span-full h-full flex items-center justify-center text-slate-500 font-mono text-sm uppercase text-center p-4 border-2 border-dashed border-white/10 rounded-xl">
                No teams configured for this season
              </div>
            ) : (
              teams.map(team => {
                const teamPlayers = players.filter(p => p.teamId === team.id).sort((a, b) => b.skillRating - a.skillRating);
                const avgSkill = teamPlayers.length > 0 ? teamPlayers.reduce((sum, p) => sum + p.skillRating, 0) / teamPlayers.length : 0;
                return (
                  <DroppableContainer 
                    key={team.id} 
                    id={team.id} 
                    title={team.name} 
                    count={teamPlayers.length} 
                    maxCount={12} 
                    avgSkill={avgSkill}
                    team={team}
                    theme={theme}
                  >
                    {teamPlayers.map(p => <PlayerCardDraggable key={p.id} player={p} />)}
                  </DroppableContainer>
                );
              })
            )}
          </div>
        </main>
      </div>

      <DragOverlay>
        {activePlayer ? <PlayerCardOverlay player={activePlayer} theme={theme} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
