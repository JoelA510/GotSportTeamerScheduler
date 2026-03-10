import React, { useState } from 'react';
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
import { GripVertical, User } from 'lucide-react';

export function SortablePlayer({ player }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
    data: player,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 bg-bg-surface border border-border-subtle rounded-md mb-2 flex items-center justify-between shadow-sm cursor-grab active:cursor-grabbing ${isDragging ? 'shadow-lg border-blue-500/50' : 'hover:border-border-highlight'}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-3">
        <div className="text-text-muted hover:text-text-primary transition-colors">
          <GripVertical size={16} />
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-sm text-text-primary">{player.name}</span>
          <span className="text-xs text-text-muted">Skill: {player.skill || 'Unrated'}</span>
        </div>
      </div>
      <div className="bg-bg-surface-hover p-1.5 rounded-full text-text-muted">
        <User size={14} />
      </div>
    </div>
  );
}

export function TeamColumn({ team, players }) {
  const { setNodeRef } = useSortable({
    id: team.id,
    data: { type: 'Column', team },
  });

  return (
    <div className="bg-bg-surface/50 border border-border-subtle rounded-xl flex flex-col h-[650px]">
      <div className="p-4 border-b border-border-subtle bg-bg-surface rounded-t-xl shrink-0">
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-bold text-text-primary">{team.name}</h3>
          <span
            className={`text-xs px-2 py-1 rounded-full font-bold ${players.length > 14 ? 'bg-amber-500/20 text-amber-500' : 'bg-blue-500/20 text-blue-400'}`}
          >
            {players.length} Players
          </span>
        </div>
        <p className="text-xs text-text-muted">{team.division}</p>
        <div className="text-xs mt-2 text-text-secondary">Coach: {team.headCoach || 'Vacant'}</div>
      </div>

      <div className="flex-1 overflow-y-auto p-3" ref={setNodeRef}>
        <SortableContext items={players.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {players.map((player) => (
            <SortablePlayer key={player.id} player={player} />
          ))}
          {players.length === 0 && (
            <div className="h-24 border-2 border-dashed border-border-subtle rounded-lg flex items-center justify-center text-text-muted text-sm italic">
              Drop players here
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

export default function RosterManager({ initialTeams }) {
  const [teams, setTeams] = useState(initialTeams);
  const [activePlayer, setActivePlayer] = useState(null);

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

    // If dragging over an empty column
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

      // Remove from source
      sTeam.players.splice(pIndex, 1);

      // Add to dest
      let dIndex = dTeam.players.findIndex((p) => p.id === overId);
      if (dIndex < 0) dIndex = dTeam.players.length;

      dTeam.players.splice(dIndex, 0, player);

      return newTeams;
    });
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActivePlayer(null);

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    const sourceTeam = findTeamOfPlayer(activeId);
    const destTeam = findTeamOfPlayer(overId);

    if (sourceTeam && destTeam && sourceTeam.id === destTeam.id) {
      // Reordering within the same list
      setTeams((prevTeams) => {
        const newTeams = [...prevTeams];
        const tIdx = newTeams.findIndex((t) => t.id === sourceTeam.id);
        const oldIndex = newTeams[tIdx].players.findIndex((p) => p.id === activeId);
        const newIndex = newTeams[tIdx].players.findIndex((p) => p.id === overId);

        newTeams[tIdx].players = arrayMove(newTeams[tIdx].players, oldIndex, newIndex);
        return newTeams;
      });
    }
  };

  return (
    <div className="w-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
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
