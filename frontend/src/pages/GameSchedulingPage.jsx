import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useDashboardData } from '../hooks/useDashboardData.js';
import TeamScheduleView from '../components/TeamScheduleView.jsx';
import AutoSchedulerPanel from '../components/scheduling/AutoSchedulerPanel.jsx';
import GameScheduleGrid from '../components/scheduling/GameScheduleGrid.jsx';
import { GameCardPreview } from '../components/scheduling/GameCard.jsx';
import Button from '../components/ui/Button.jsx';
import ProgressBar from '../components/ui/ProgressBar.jsx';
import { Edit2, Save, Trophy, Sparkles } from 'lucide-react';
import GameReadinessPanel from '../components/GameReadinessPanel.jsx';
import GameConflictBanner from '../components/scheduling/GameConflictBanner.jsx';
import { formatDateTime } from '../utils/formatters.js';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { PERMISSIONS } from '../constants/permissions.js';

export default function GameSchedulingPage() {
  const { game, loading, timezone } = useDashboardData();
  const { currentOrganization, permissions = [] } = useOrganization();
  const [localAssignments, setLocalAssignments] = useState(game?.assignments ?? []);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeTab, setActiveTab] = useState('full'); // 'full' or 'team'

  // Auto-scheduler states
  const [autoSchedulerStatus, setAutoSchedulerStatus] = useState('idle');
  const [autoSchedulerProgress, setAutoSchedulerProgress] = useState(0);
  const [autoSchedulerResult, setAutoSchedulerResult] = useState(null);
  const [autoSchedulerError, setAutoSchedulerError] = useState(null);
  const autoSchedulerIntervalRef = useRef(null);
  const [fields, setFields] = useState([]);
  const [gameSlots, setGameSlots] = useState([]);
  const [activeGame, setActiveGame] = useState(null);
  const canManageSchedule =
    permissions.includes(PERMISSIONS.MANAGE_SCHEDULE) ||
    permissions.includes(PERMISSIONS.MANAGE_ORGANIZATION);
  const canEditSchedule = canManageSchedule && isEditMode;

  useEffect(() => {
    if (game?.assignments) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalAssignments(game.assignments);
    }
    // Depend on stable signals — useDashboardData returns a fresh `game` object
    // every render, so `[game?.assignments]` alone would loop.
  }, [game?.assignments?.length, game?.generatedAt]);

  // Ensure the simulation timer can't outlive the component.
  useEffect(() => {
    return () => {
      if (autoSchedulerIntervalRef.current) {
        clearInterval(autoSchedulerIntervalRef.current);
        autoSchedulerIntervalRef.current = null;
      }
    };
  }, []);

  const stopAutoSchedulerInterval = () => {
    if (autoSchedulerIntervalRef.current) {
      clearInterval(autoSchedulerIntervalRef.current);
      autoSchedulerIntervalRef.current = null;
    }
  };

  const handleAutoGenerate = () => {
    if (!canManageSchedule) return;

    stopAutoSchedulerInterval();
    setAutoSchedulerStatus('running');
    setAutoSchedulerProgress(0);
    setAutoSchedulerError(null);

    autoSchedulerIntervalRef.current = setInterval(() => {
      setAutoSchedulerProgress((prev) => {
        if (prev >= 100) {
          stopAutoSchedulerInterval();
          setAutoSchedulerStatus('completed');
          setAutoSchedulerResult({ assignments: localAssignments });
          return 100;
        }
        return prev + 5;
      });
    }, 150);
  };

  const handleCancelAutoScheduler = () => {
    stopAutoSchedulerInterval();
    setAutoSchedulerStatus('idle');
    setAutoSchedulerProgress(0);
  };

  const handleResetAutoScheduler = () => {
    stopAutoSchedulerInterval();
    setAutoSchedulerStatus('idle');
    setAutoSchedulerResult(null);
    setAutoSchedulerProgress(0);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadGridReferenceData() {
      if (!currentOrganization?.id) {
        setFields([]);
        setGameSlots([]);
        return;
      }

      const [{ data: fieldRows }, { data: slotRows }] = await Promise.all([
        supabase
          .from('fields')
          .select('*')
          .eq('organization_id', currentOrganization.id)
          .eq('active', true),
        supabase
          .from('game_slots')
          .select('*')
          .eq('organization_id', currentOrganization.id)
          .order('start', { ascending: true }),
      ]);

      if (!isMounted) return;
      setFields(fieldRows ?? []);
      setGameSlots(
        (slotRows ?? []).map((slot) => ({
          ...slot,
          label: slot.start ? formatDateTime(slot.start, timezone) : slot.id,
        }))
      );
    }

    loadGridReferenceData();

    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id, timezone]);

  const conflictSet = useMemo(() => {
    const ids = new Set();
    (game?.warnings ?? []).forEach((warning) => {
      (warning.details?.conflicts ?? []).forEach((assignment) => {
        if (assignment?.id) ids.add(assignment.id);
      });
    });
    return ids;
  }, [game?.warnings]);

  const handleDragStart = useCallback(
    (event) => {
      if (!canManageSchedule) return;
      const assignment = localAssignments.find((a) => String(a.id) === String(event.active.id));
      setActiveGame(assignment ?? null);
    },
    [canManageSchedule, localAssignments]
  );

  const handleDragEnd = useCallback(
    async (event) => {
      const { active, over } = event;
      setActiveGame(null);
      if (!canManageSchedule) return;
      if (!over?.id) return;

      const [targetFieldId, targetSlotId] = String(over.id).split(':');
      if (!targetFieldId || !targetSlotId) return;

      const targetSlot = gameSlots.find((slot) => String(slot.id) === targetSlotId);
      const currentAssignment = localAssignments.find((assignment) => {
        return String(assignment.id) === String(active.id);
      });
      if (!currentAssignment) return;

      const updatedAssignment = {
        ...currentAssignment,
        fieldId: targetFieldId,
        slotId: targetSlotId,
        start: targetSlot?.start ?? currentAssignment.start,
        end: targetSlot?.end ?? currentAssignment.end,
        assignmentSource: 'manual',
      };

      setLocalAssignments((current) =>
        current.map((assignment) =>
          String(assignment.id) === String(active.id) ? updatedAssignment : assignment
        )
      );

      const { error } = await supabase
        .from('game_assignments')
        .update({
          field_id: targetFieldId,
          slot_id: targetSlotId,
          start: targetSlot?.start ?? updatedAssignment.start,
          end: targetSlot?.end ?? updatedAssignment.end,
          assignment_source: 'manual',
        })
        .eq('id', active.id);
      if (error) {
        console.error('Failed to persist game assignment override:', error);
      }
    },
    [canManageSchedule, gameSlots, localAssignments]
  );

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
        {canManageSchedule && (
          <div className="flex gap-3">
            <Button
              variant={canEditSchedule ? 'primary' : 'secondary'}
              onClick={() => setIsEditMode(!isEditMode)}
              className="flex items-center gap-2"
            >
              {canEditSchedule ? <Save size={18} /> : <Edit2 size={18} />}
              {canEditSchedule ? 'Commit Changes' : 'Quick Adjust'}
            </Button>
          </div>
        )}
      </div>

      <GameConflictBanner warnings={game?.warnings ?? []} />

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
              {canEditSchedule ? (
                <div className="p-4 overflow-x-auto">
                  <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <GameScheduleGrid
                      assignments={localAssignments}
                      fields={fields}
                      timeSlots={gameSlots}
                      conflictSet={conflictSet}
                      activeGameId={activeGame?.id}
                      timezone={timezone}
                    />
                    <DragOverlay>
                      {activeGame ? <GameCardPreview assignment={activeGame} /> : null}
                    </DragOverlay>
                  </DndContext>
                </div>
              ) : activeTab === 'full' ? (
                <GameScheduleList
                  assignments={localAssignments}
                  timezone={timezone}
                  onEditSchedule={canManageSchedule ? () => setIsEditMode(true) : undefined}
                />
              ) : (
                <TeamScheduleSelector
                  assignments={localAssignments}
                  selectedTeamId={selectedTeamId}
                  onSelectTeam={setSelectedTeamId}
                  onEditSchedule={canManageSchedule ? () => setIsEditMode(true) : undefined}
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
            result={autoSchedulerResult}
            error={autoSchedulerError}
            onTrigger={handleAutoGenerate}
            onCancel={handleCancelAutoScheduler}
            onReset={handleResetAutoScheduler}
            disabled={Boolean(loading) || !canManageSchedule}
          />

          <GameReadinessPanel
            gameReadinessSnapshot={game?.snapshot ?? {}}
            gameSummary={
              game?.summary ?? { scheduledRate: 0, unscheduledMatchups: 0, teamsWithByes: 0 }
            }
            generatedAt={game?.generatedAt}
            timezone={timezone}
          />
        </div>
      </div>
    </div>
  );
}

function GameScheduleList({ assignments, timezone, onEditSchedule }) {
  if (!assignments || assignments.length === 0) {
    return (
      <div className="glass-panel p-12 text-center animate-fadeIn border-brand-400/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Trophy size={120} className="text-brand-400" />
        </div>
        <div className="max-w-md mx-auto relative z-10">
          <h2 className="text-2xl font-display font-bold text-white mb-4">No Game Schedule Yet</h2>
          <p className="text-white/60 mb-8">
            The game schedule has not been generated for the current season. Run the auto-scheduler
            on the right once teams and field availability are finalized.
          </p>
          {onEditSchedule && (
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                variant="primary"
                size="lg"
                className="flex items-center gap-2"
                onClick={onEditSchedule}
              >
                Generate Schedule <Sparkles size={18} />
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse" data-testid="game-schedule-list">
        <thead>
          <tr className="bg-bg-app/50 border-b border-border-subtle">
            <th className="p-4 text-xs font-semibold text-text-muted uppercase tracking-wider">
              Matchup
            </th>
            <th className="p-4 text-xs font-semibold text-text-muted uppercase tracking-wider">
              Field
            </th>
            <th className="p-4 text-xs font-semibold text-text-muted uppercase tracking-wider">
              Kickoff
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle/30">
          {assignments.map((a) => (
            <tr
              key={a.id ?? `${a.homeTeamId}-${a.awayTeamId}-${a.slotId}`}
              className="hover:bg-white/5"
            >
              <td className="p-4 text-text-primary font-medium">
                {a.homeTeamName ?? 'Home'} vs {a.awayTeamName ?? 'Away'}
              </td>
              <td className="p-4 text-text-secondary">{a.fieldName ?? a.fieldId ?? '—'}</td>
              <td className="p-4 text-text-secondary">
                {a.kickoff ? formatDateTime(a.kickoff, timezone) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamScheduleSelector({
  assignments,
  selectedTeamId,
  onSelectTeam,
  onEditSchedule,
  timezone,
}) {
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
          <TeamScheduleView assignments={assignments} teamId={selectedTeamId} timezone={timezone} />
        ) : assignments.length === 0 ? (
          <div className="glass-panel p-12 text-center animate-fadeIn border-brand-400/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Trophy size={120} className="text-brand-400" />
            </div>
            <div className="max-w-md mx-auto relative z-10">
              <h2 className="text-2xl font-display font-bold text-white mb-4">
                No Game Schedule Yet
              </h2>
              <p className="text-white/60 mb-8">
                The game schedule has not been generated for the current season. You can generate a
                new schedule once teams and field availability are finalized.
              </p>
              {onEditSchedule && (
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    variant="primary"
                    size="lg"
                    className="flex items-center gap-2"
                    onClick={onEditSchedule}
                  >
                    Generate Schedule <Sparkles size={18} />
                  </Button>
                </div>
              )}
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
