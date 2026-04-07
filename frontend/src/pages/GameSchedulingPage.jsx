import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Edit2, Save } from 'lucide-react';
import GameReadinessPanel from '../components/GameReadinessPanel.jsx';
import TeamScheduleView from '../components/TeamScheduleView.jsx';
import GameConflictBanner from '../components/scheduling/GameConflictBanner.jsx';
import GameScheduleGrid from '../components/scheduling/GameScheduleGrid.jsx';
import { GameCardPreview } from '../components/scheduling/GameCard.jsx';
import { useDashboardData } from '../hooks/useDashboardData.js';
import { useFields } from '../hooks/useFields.js';
import { useGameSlots } from '../hooks/useGameSlots.js';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { validateGameMove } from '../../../packages/core/src/gameValidation.js';
import { supabase } from '../lib/supabaseClient.js';
import EvaluationPanel from '../components/EvaluationPanel.jsx';
import { logger } from '../lib/logger.js';
import Button from '../components/ui/Button.jsx';

export default function GameSchedulingPage() {
  // ── Existing hooks ────────────────────────────────────────────────────────
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const { user, isImpersonating } = useAuth();
  const { currentOrganization } = useOrganization();
  const { game, team } = useDashboardData();
  const { timezone } = useTheme();
  const { fields } = useFields();
  const { slots: gameSlots } = useGameSlots();

  // ── Edit mode state ───────────────────────────────────────────────────────
  const [isEditMode, setIsEditMode] = useState(false);

  // ── Local mutable copy of assignments (optimistic UI) ─────────────────────
  const [localAssignments, setLocalAssignments] = useState([]);
  useEffect(() => {
    if (game.assignments?.length) {
      setLocalAssignments(game.assignments);
    }
  }, [game.assignments]);

  // ── Drag state ────────────────────────────────────────────────────────────
  const [activeGame, setActiveGame] = useState(null);
  const [validationResult, setValidationResult] = useState(null);

  const teams = team.teams || [];

  // ── Sensors (same config as RosterManager) ────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── Derive unique time slots from ALL game_slots + assignments ───────────
  const timeSlots = useMemo(() => {
    const slotMap = new Map();

    // 1. Seed from game_slots table (includes empty slots you can drag to)
    for (const gs of gameSlots) {
      if (!slotMap.has(gs.id)) {
        const startDate = new Date(gs.start);
        const label = startDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone || undefined,
        });
        slotMap.set(gs.id, { id: gs.id, start: gs.start, label });
      }
    }

    // 2. Also include any slots from assignments (in case game_slots haven't loaded)
    for (const a of localAssignments) {
      if (!slotMap.has(a.slotId)) {
        const startDate = new Date(a.start);
        const label = startDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone || undefined,
        });
        slotMap.set(a.slotId, { id: a.slotId, start: a.start, label });
      }
    }

    return Array.from(slotMap.values()).sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );
  }, [gameSlots, localAssignments, timezone]);

  // ── Compute conflicts (Placeholder for Phase 8 real-time sync) ────────────────
  const { conflicts, conflictSet } = useMemo(() => {
    return { conflicts: [], conflictSet: new Set() };
  }, []);

  // ── Slot lookup for resolving drop targets ────────────────────────────────
  const slotTimeLookup = useMemo(() => {
    const map = {};
    // Include all game_slots so empty slots are valid drag targets
    for (const gs of gameSlots) {
      if (!map[gs.id]) {
        map[gs.id] = { start: gs.start, end: gs.end };
      }
    }
    // Assignments can also provide slot times (fallback if game_slots haven't loaded)
    for (const a of localAssignments) {
      if (!map[a.slotId]) {
        map[a.slotId] = { start: a.start, end: a.end };
      }
    }
    return map;
  }, [gameSlots, localAssignments]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (event) => {
      const assignment = localAssignments.find((a) => a.id === event.active.id);
      setActiveGame(assignment || null);
    },
    [localAssignments]
  );

  const handleDragOver = useCallback(
    (event) => {
      const { over } = event;
      if (!over || !activeGame) {
        setValidationResult(null);
        return;
      }

      // Parse composite droppable ID: "fieldId:slotId"
      const overId = String(over.id);
      const colonIdx = overId.indexOf(':');
      if (colonIdx < 0) {
        setValidationResult(null);
        return;
      }

      const targetFieldId = overId.slice(0, colonIdx);
      const targetSlotId = overId.slice(colonIdx + 1);
      const slotTime = slotTimeLookup[targetSlotId];

      if (!slotTime) {
        setValidationResult(null);
        return;
      }

      const teamsForValidation = teams.map((t) => ({
        id: t.id,
        coachId: t.coachId || t.headCoachId || null,
      }));

      const result = validateGameMove({
        game: activeGame,
        targetFieldId,
        targetSlotId,
        targetStart: slotTime.start,
        targetEnd: slotTime.end,
        assignments: localAssignments,
        teams: teamsForValidation,
      });

      setValidationResult({ ...result, targetFieldId, targetSlotId });
    },
    [activeGame, localAssignments, teams, slotTimeLookup]
  );

  const handleDragEnd = useCallback(
    async (event) => {
      const { over } = event;
      const draggedGame = activeGame;

      // Clear drag state immediately
      setActiveGame(null);
      setValidationResult(null);

      if (!over || !draggedGame) return;

      // Parse target
      const overId = String(over.id);
      const colonIdx = overId.indexOf(':');
      if (colonIdx < 0) return;

      const targetFieldId = overId.slice(0, colonIdx);
      const targetSlotId = overId.slice(colonIdx + 1);
      const slotTime = slotTimeLookup[targetSlotId];
      if (!slotTime) return;

      // Validate the drop
      const teamsForValidation = teams.map((t) => ({
        id: t.id,
        coachId: t.coachId || t.headCoachId || null,
      }));

      const validation = validateGameMove({
        game: draggedGame,
        targetFieldId,
        targetSlotId,
        targetStart: slotTime.start,
        targetEnd: slotTime.end,
        assignments: localAssignments,
        teams: teamsForValidation,
      });

      if (!validation.valid) return; // Invalid drop — snap back

      // Same slot? No-op
      if (
        String(draggedGame.fieldId) === targetFieldId &&
        String(draggedGame.slotId) === targetSlotId
      ) {
        return;
      }

      // ── Optimistic UI update ────────────────────────────────────────────
      const snapshot = [...localAssignments];
      setLocalAssignments((prev) =>
        prev.map((a) =>
          a.id === draggedGame.id
            ? {
                ...a,
                fieldId: targetFieldId,
                slotId: targetSlotId,
                start: slotTime.start,
                end: slotTime.end,
                assignmentSource: 'manual',
              }
            : a
        )
      );

      // ── Persist to Supabase ─────────────────────────────────────────────
      try {
        const { error } = /** @type {any} */ (
          await supabase
            .from('game_assignments')
            .update({
              slot_id: targetSlotId,
              field_id: targetFieldId,
              start: slotTime.start,
              end: slotTime.end,
              assignment_source: 'manual',
            })
            .eq('id', draggedGame.id)
        );

        if (error) throw error;

        // Audit game move
        await supabase.rpc('record_audit_event', {
          p_organization_id: currentOrganization?.id,
          p_action: 'scheduling.game_moved',
          p_metadata: {
            game_id: draggedGame.id,
            from_field: draggedGame.fieldId,
            from_slot: draggedGame.slotId,
            to_field: targetFieldId,
            to_slot: targetSlotId,
            ...(isImpersonating && {
              target_user_id: user.profile.id,
              impersonated_by: user.id,
              admin_email: user.email,
            }),
          },
        });
      } catch (e) {
        logger.error('Failed to persist game assignment move', e);
        // Rollback optimistic update
        setLocalAssignments(snapshot);
      }
    },
    [
      activeGame,
      localAssignments,
      teams,
      slotTimeLookup,
      user,
      isImpersonating,
      currentOrganization,
    ]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fadeIn space-y-8">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Game Scheduling</h1>
          <p className="text-white/60">Generate and review game schedules.</p>
        </div>
        <Button
          variant={isEditMode ? 'primary' : 'secondary'}
          onClick={() => setIsEditMode(!isEditMode)}
          className="flex items-center gap-2"
        >
          {isEditMode ? <Save size={18} /> : <Edit2 size={18} />}
          {isEditMode ? 'Done Editing' : 'Edit Schedule'}
        </Button>
      </div>

      <div className="space-y-6">
        <EvaluationPanel
          gameData={{
            games: localAssignments,
            teams: teams,
          }}
          supabaseClient={supabase}
        />

        <GameReadinessPanel
          gameReadinessSnapshot={game.snapshot}
          gameSummary={game.summary}
          generatedAt={game.generatedAt}
          timezone={timezone}
        />
      </div>

      {conflicts.length > 0 && <GameConflictBanner warnings={conflicts} />}

      {isEditMode ? (
        <div className="overflow-x-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <GameScheduleGrid
              assignments={localAssignments}
              fields={fields}
              timeSlots={timeSlots}
              teams={teams}
              conflictSet={conflictSet}
              validationResult={validationResult}
              activeGameId={activeGame?.id}
              timezone={timezone}
            />

            <DragOverlay>
              {activeGame ? <GameCardPreview assignment={activeGame} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      ) : (
        <div className="bg-bg-card border border-border-default rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-text-primary">Team Schedules</h2>
            <select
              className="bg-bg-input border border-border-default rounded px-3 py-1.5 text-text-primary"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
            >
              <option value="">Select a team...</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.division})
                </option>
              ))}
            </select>
          </div>

          {selectedTeamId ? (
            <TeamScheduleView
              assignments={localAssignments}
              teamId={selectedTeamId}
              timezone={timezone}
            />
          ) : (
            <div className="text-center text-text-muted py-8 bg-bg-surface rounded border border-border-subtle border-dashed">
              Select a team to view their schedule
            </div>
          )}
        </div>
      )}
    </div>
  );
}
