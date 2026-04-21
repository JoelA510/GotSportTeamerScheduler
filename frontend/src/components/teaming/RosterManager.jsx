import React, { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, User, ShieldAlert, Zap, ArrowRight } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useConflicts } from '../../hooks/useConflicts.js';
import { supabase } from '../../lib/supabaseClient.js';
import { useOrganization } from '../../contexts/OrganizationContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { logger } from '../../lib/logger.js';

/**
 * @param {{ player: any }} props
 */
const PlayerCard = ({ player }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
    data: player,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const playerName =
    player.name ||
    `${player.first_name || ''} ${player.last_name || ''}`.trim() ||
    'Unknown Player';
  const playerSkill = player.skill || player.skillRating || player.skill_tier || 'Unrated';

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`player-card-${player.id}`}
      role="listitem"
      aria-label={`${playerName}, Skill: ${playerSkill}${player.assignment_source === 'manual' ? ', manually assigned' : ''}`}
      aria-roledescription="draggable item"
      className={`p-3 bg-bg-surface border border-border-subtle rounded-md flex items-center justify-between shadow-sm cursor-grab active:cursor-grabbing ${isDragging ? 'shadow-lg border-blue-500/50' : 'hover:border-border-highlight'}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-3">
        <div
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-hidden="true"
        >
          <GripVertical size={16} />
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-sm text-text-primary">{playerName}</span>
          <span className="text-xs text-text-muted flex items-center gap-2">
            Skill: {playerSkill}
            {player.assignment_source === 'manual' && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
                manual
              </span>
            )}
          </span>
        </div>
      </div>
      <div className="bg-bg-surface-hover p-1.5 rounded-full text-text-muted" aria-hidden="true">
        <User size={14} />
      </div>
    </div>
  );
};

// Governance: Memoize individual player rows to prevent unnecessary re-renders during drag transitions
export const SortablePlayer = React.memo(PlayerCard);

export function TeamColumn({ team, players }) {
  const parentRef = useRef(null);

  // CRITICAL: Virtualizer mapping for 60FPS roster interaction
  const rowVirtualizer = useVirtualizer({
    count: players.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 68,
    overscan: 10,
  });

  const { setNodeRef } = useSortable({
    id: team.id,
    data: { type: 'Column', team },
  });

  return (
    <div
      className="bg-bg-surface/50 border border-border-subtle rounded-xl flex flex-col h-[650px]"
      data-testid={`team-column-${team.id}`}
    >
      <div className="p-4 border-b border-border-subtle bg-bg-surface rounded-t-xl shrink-0">
        <div className="flex justify-between items-center mb-1">
          <div className="flex flex-col">
            <h3 className="font-bold text-text-primary">{team.name}</h3>
            <a
              href={`/team/${team.id}`}
              className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline uppercase tracking-widest font-bold flex items-center gap-1 mt-0.5"
            >
              View Team Portal <ArrowRight size={10} />
            </a>
          </div>
          <span
            className={`text-xs px-2 py-1 rounded-full font-bold ${players.length > 14 ? 'bg-amber-500/20 text-amber-500' : 'bg-blue-500/20 text-blue-400'}`}
          >
            {players.length} Players
          </span>
        </div>
        <p className="text-xs text-text-muted">{team.division}</p>
        <div className="text-xs mt-2 text-text-secondary">Coach: {team.headCoach || 'Vacant'}</div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 relative h-full" ref={parentRef} role="list">
        <div
          ref={setNodeRef}
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          <SortableContext items={players.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {rowVirtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <SortablePlayer player={players[virtualItem.index]} />
              </div>
            ))}
            {players.length === 0 && (
              <div className="h-24 border-2 border-dashed border-border-subtle rounded-lg flex items-center justify-center text-text-muted text-sm italic">
                Drop players here
              </div>
            )}
          </SortableContext>
        </div>
      </div>
    </div>
  );
}

export default function RosterManager({ initialTeams }) {
  const [teams, setTeams] = useState(initialTeams);
  const [activePlayer, setActivePlayer] = useState(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const { conflicts, hasConflicts } = useConflicts(teams);
  const { currentOrganization } = useOrganization();
  const { user, isImpersonating } = useAuth();

  // CRITICAL FIX: Sync state when async mock data finishes loading
  useEffect(() => {
    setTeams(initialTeams);
  }, [initialTeams]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const findTeamOfPlayer = (playerId) => {
    return teams.find((t) => t.players.find((p) => p.id === playerId));
  };

  const handleDragStart = (event) => {
    const { active } = event;
    const team = findTeamOfPlayer(active.id);
    if (team) {
      const player = team.players.find((p) => p.id === active.id);
      setActivePlayer(player);
    }
  };

  const handleDragOver = (event) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const sourceTeam = findTeamOfPlayer(activeId);
    let destTeam = findTeamOfPlayer(overId);

    if (!destTeam) {
      destTeam = teams.find((t) => t.id === overId);
    }

    if (!sourceTeam || !destTeam || sourceTeam.id === destTeam.id) return;

    setTeams((prevTeams) => {
      const newTeams = JSON.parse(JSON.stringify(prevTeams));
      const sTeam = newTeams.find((t) => t.id === sourceTeam.id);
      const dTeam = newTeams.find((t) => t.id === destTeam.id);

      const pIndex = sTeam.players.findIndex((p) => p.id === activeId);
      const player = sTeam.players[pIndex];

      sTeam.players.splice(pIndex, 1);

      let dIndex = dTeam.players.findIndex((p) => p.id === overId);
      if (dIndex < 0) dIndex = dTeam.players.length;

      const updatedPlayer = { ...player, assignment_source: 'manual' };
      dTeam.players.splice(dIndex, 0, updatedPlayer);

      return newTeams;
    });
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActivePlayer(null);

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    const sourceTeam = findTeamOfPlayer(activeId);
    let destTeam = findTeamOfPlayer(overId);
    if (!destTeam) destTeam = teams.find((t) => t.id === overId);

    if (!sourceTeam || !destTeam) return;

    if (sourceTeam.id === destTeam.id) {
      setTeams((prevTeams) => {
        const newTeams = [...prevTeams];
        const tIdx = newTeams.findIndex((t) => t.id === sourceTeam.id);
        const oldIndex = newTeams[tIdx].players.findIndex((p) => p.id === activeId);
        const newIndex = newTeams[tIdx].players.findIndex((p) => p.id === overId);

        newTeams[tIdx].players = arrayMove(newTeams[tIdx].players, oldIndex, newIndex);
        return newTeams;
      });
      setAnnouncement(`Moved ${activePlayer.name} within ${destTeam.name}`);
    } else {
      try {
        const { error } = /** @type {any} */ (
          await supabase
            .from('players')
            .update({
              team_id: destTeam.id,
              assignment_source: 'manual',
            })
            .eq('id', activeId)
        );

        if (error) throw error;
        setAnnouncement(`Assigned ${activePlayer.name} to ${destTeam.name}`);

        // Audit the manual override
        await supabase.rpc('record_audit_event', {
          p_organization_id: currentOrganization?.id,
          p_action: 'player.reassigned',
          p_metadata: {
            player_id: activeId,
            from_team_id: sourceTeam.id,
            to_team_id: destTeam.id,
            trigger: 'roster_drag_drop',
            ...(isImpersonating && {
              target_user_id: user.profile.id,
              impersonated_by: user.id,
              admin_email: user.email,
            }),
          },
        });
      } catch (e) {
        logger.error('Failed to persist player assignment override', e);
        setAnnouncement(`Failed to move ${activePlayer.name}`);
      }
    }
  };

  const handleQuickDraft = async () => {
    setIsDrafting(true);
    try {
      const { data: settings } = /** @type {any} */ (
        await supabase
          .from('season_settings')
          .select('id')
          .eq('organization_id', currentOrganization?.id)
          .limit(1)
          .single()
      );

      if (settings) {
        await supabase.from('scheduler_runs').insert({
          season_settings_id: settings.id,
          run_type: 'team',
          status: 'running',
          parameters: { source: 'quick_draft' },
          metrics: { progress: 0 },
          started_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      logger.error('Quick Draft backend insert failed', e);
    } finally {
      setIsDrafting(false);
    }
  };

  return (
    <div className="w-full">
      {hasConflicts && (
        <div className="bg-status-error-bg backdrop-blur-md text-white p-4 border border-status-error rounded-xl mb-6 flex flex-col gap-2 shadow-[0_0_30px_rgba(239,68,68,0.3)] animate-fadeIn">
          <div className="flex items-center gap-2 font-bold uppercase tracking-widest text-status-error">
            <ShieldAlert size={20} />
            Conflict Detected
          </div>
          <div className="flex flex-col gap-2">
            {conflicts.map((c, i) => (
              <div
                key={i}
                className="font-mono text-sm bg-black/20 p-3 rounded-lg border border-status-error/30 flex items-center justify-between"
              >
                <span className="text-text-secondary">{c.message}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    c.severity === 'error'
                      ? 'bg-status-error/20 text-status-error'
                      : 'bg-status-warning/20 text-status-warning'
                  }`}
                >
                  {c.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div className="flex justify-end mb-4">
        <button
          onClick={handleQuickDraft}
          disabled={isDrafting}
          className="relative z-10 glass-button flex items-center gap-2 text-sm"
          aria-label={isDrafting ? 'Drafting in progress' : 'Execute Quick Draft'}
        >
          <Zap size={16} aria-hidden="true" />
          {isDrafting ? 'Drafting...' : 'Quick Draft'}
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Press space to start dragging. Use arrow keys to move between teams, enter to drop, escape to cancel.',
          },
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {teams.map((team) => (
            <TeamColumn key={team.id} team={team} players={team.players} />
          ))}
        </div>

        <DragOverlay>
          {activePlayer ? (
            <div className="p-3 bg-bg-surface border border-blue-500 rounded-md shadow-2xl flex items-center justify-between opacity-90 scale-105 transform rotate-2">
              <div className="flex items-center gap-3">
                <GripVertical size={16} className="text-blue-400" />
                <div className="flex flex-col">
                  <span className="font-medium text-sm text-text-primary">{activePlayer.name}</span>
                  <span className="text-xs text-text-muted">Moving player...</span>
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
