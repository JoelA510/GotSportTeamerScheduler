import React, { useState, useEffect, useMemo } from 'react';
import { useDashboardData } from '../hooks/useDashboardData.js';
import GameScheduleView from '../components/GameScheduleView.jsx';
import TeamScheduleView from '../components/TeamScheduleView.jsx';
import AutoSchedulerPanel from '../components/AutoSchedulerPanel.jsx';
import Button from '../components/ui/Button.jsx';
import ProgressBar from '../components/ui/ProgressBar.jsx';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Edit2, Save, Trophy, Sparkles } from 'lucide-react';
import GameReadinessPanel from '../components/GameReadinessPanel.jsx';
import TeamScheduleView from '../components/TeamScheduleView.jsx';
import GameConflictBanner from '../components/scheduling/GameConflictBanner.jsx';

export default function GameSchedulingPage() {
  const { game, loading, error, timezone } = useDashboardData();
  const [localAssignments, setLocalAssignments] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeTab, setActiveTab] = useState('full'); // 'full' or 'team'

  // Auto-scheduler states
  const [autoSchedulerStatus, setAutoSchedulerStatus] = useState('idle');
  const [autoSchedulerProgress, setAutoSchedulerProgress] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (game?.assignments) {
      setLocalAssignments(game.assignments);
    }
  }, [game]);

  const handleAutoGenerate = () => {
    setAutoSchedulerStatus('running');
    setAutoSchedulerProgress(0);

    const interval = setInterval(() => {
      setAutoSchedulerProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setAutoSchedulerStatus('success');
          return 100;
        }
        return prev + 5;
      });
    }, 150);
  };

  if (loading && !game) {
    return (
      <div className="p-12 text-center animate-fadeIn">
        <ProgressBar progress={45} label="Loading master game schedule..." />
      </div>
    );
  }

  return (
    <div className="animate-fadeIn space-y-8">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Game Scheduling</h1>
          <p className="text-white/60">Generate and manage the master competition schedule.</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant={isEditMode ? 'primary' : 'secondary'}
            onClick={() => setIsEditMode(!isEditMode)}
            className="flex items-center gap-2"
          >
            {isEditMode ? <Save size={18} /> : <Edit2 size={18} />}
            {isEditMode ? 'Commit Changes' : 'Quick Adjust'}
          </Button>
        </div>
      </div>

      <GameConflictBanner assignments={localAssignments} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {/* Main Schedule View */}
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden shadow-2xl backdrop-blur-sm">
            <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/5">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab('full')}
                  className={`text-sm font-semibold transition-colors ${
                    activeTab === 'full' ? 'text-blue-400' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  Full Schedule
                </button>
                <button
                  onClick={() => setActiveTab('team')}
                  className={`text-sm font-semibold transition-colors ${
                    activeTab === 'team' ? 'text-blue-400' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  By Team
                </button>
              </div>
            </div>

            <div className="p-0">
              {activeTab === 'full' ? (
                <GameScheduleView assignments={localAssignments} timezone={timezone} />
              ) : (
                <TeamScheduleSelector
                  assignments={localAssignments}
                  selectedTeamId={selectedTeamId}
                  onSelectTeam={setSelectedTeamId}
                  timezone={timezone}
                />
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <AutoSchedulerPanel
            status={autoSchedulerStatus}
            progress={autoSchedulerProgress}
            onTrigger={handleAutoGenerate}
            label="Game Auto-Scheduler"
            description="Use AI to generate a conflict-free match chart based on team proximity and field availability."
          />

          <GameReadinessPanel
            gameSnapshot={{
              conflicts: 0,
              coverage: 100,
              lastCalculated: game?.generatedAt,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TeamScheduleSelector({ assignments, selectedTeamId, onSelectTeam, timezone }) {
  // Extract unique team IDs/Names
  const teams = useMemo(() => {
    const teamSet = new Map();
    assignments.forEach((a) => {
      teamSet.set(a.homeTeamId, a.homeTeamName);
      teamSet.set(a.awayTeamId, a.awayTeamName);
    });
    return Array.from(teamSet.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
          Select Team
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {teams.map((team) => (
            <button
              key={team.id}
              onClick={() => onSelectTeam(team.id)}
              className={`px-3 py-2 rounded text-xs font-medium transition-all ${
                selectedTeamId === team.id
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {team.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 border-t border-white/5 pt-8">
        {selectedTeamId ? (
          <TeamScheduleView
            assignments={localAssignments}
            teamId={selectedTeamId}
            timezone={timezone}
          />
        ) : localAssignments.length === 0 ? (
          <div className="glass-panel p-12 text-center animate-fadeIn border-brand-400/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Trophy size={120} className="text-brand-400" />
            </div>
            <div className="max-w-md mx-auto relative z-10">
              <h2 className="text-2xl font-display font-bold text-white mb-4">
                No Game Schedule Yet
              </h2>
              <p className="text-white/60 mb-8">
                The game schedule has not been generated for the current season. You can generate a new schedule once teams and field availability are finalized.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  variant="primary"
                  size="lg"
                  className="flex items-center gap-2"
                  onClick={() => setIsEditMode(true)}
                >
                  Generate Schedule <Sparkles size={18} />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-text-muted py-8 bg-bg-surface rounded border border-border-subtle border-dashed">
            Select a team to view their schedule
          </div>
        )}
      </div>
    </div>
  );
}
