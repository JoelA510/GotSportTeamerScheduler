import React from 'react';
import PropTypes from 'prop-types';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Clock, MapPin } from 'lucide-react';
import { formatTime } from '../../utils/formatters.js';

/**
 * GameCard — a draggable card representing a single game assignment in the schedule grid.
 *
 * Uses `useDraggable` from @dnd-kit/core (not useSortable, since slots hold 0-1 games).
 * Attaches the full assignment as drag data so handlers can access it.
 */
export default function GameCard({ assignment, hasConflict = false, isDragDisabled = false, timezone = undefined }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: assignment.id,
    data: assignment,
    disabled: isDragDisabled,
  });

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  const isManual = assignment.assignmentSource === 'manual';

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`game-card-${assignment.id}`}
      className={`p-3 bg-bg-surface border rounded-lg shadow-sm transition-colors ${
        isDragDisabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${
        hasConflict
          ? 'border-status-error shadow-[0_0_12px_rgba(239,68,68,0.25)]'
          : isDragging
            ? 'border-blue-500/50 shadow-lg'
            : 'border-border-subtle hover:border-border-highlight'
      }`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {!isDragDisabled && (
            <div className="text-text-muted hover:text-text-primary transition-colors">
              <GripVertical size={14} />
            </div>
          )}
          <span className="font-semibold text-sm text-text-primary">
            {assignment.homeTeamId}
          </span>
          <span className="text-xs text-text-muted">vs</span>
          <span className="font-semibold text-sm text-text-primary">
            {assignment.awayTeamId}
          </span>
        </div>
        {isManual && (
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30"
            data-testid="manual-badge"
          >
            manual
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {formatTime(assignment.start, timezone)}
        </span>
        <span className="flex items-center gap-1">
          <MapPin size={11} />
          Field {assignment.fieldId}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-bg-surface-hover text-text-muted text-[10px] font-medium">
          {assignment.division}
        </span>
      </div>
    </div>
  );
}

GameCard.propTypes = {
  assignment: PropTypes.shape({
    id: PropTypes.string.isRequired,
    slotId: PropTypes.string,
    homeTeamId: PropTypes.string.isRequired,
    awayTeamId: PropTypes.string.isRequired,
    start: PropTypes.string.isRequired,
    end: PropTypes.string,
    fieldId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    division: PropTypes.string,
    assignmentSource: PropTypes.string,
  }).isRequired,
  hasConflict: PropTypes.bool,
  isDragDisabled: PropTypes.bool,
  timezone: PropTypes.string,
};

/**
 * GameCardPreview — simplified card shown in DragOverlay during drag.
 * No dnd hooks — purely presentational.
 */
export function GameCardPreview({ assignment }) {
  return (
    <div
      className="p-3 bg-bg-surface border border-blue-500 rounded-lg shadow-2xl opacity-90 scale-105 transform rotate-2"
      data-testid="game-card-preview"
    >
      <div className="flex items-center gap-2">
        <GripVertical size={14} className="text-blue-400" />
        <span className="font-semibold text-sm text-text-primary">
          {assignment.homeTeamId} vs {assignment.awayTeamId}
        </span>
      </div>
      <span className="text-xs text-text-muted">Moving game...</span>
    </div>
  );
}

GameCardPreview.propTypes = {
  assignment: PropTypes.shape({
    homeTeamId: PropTypes.string.isRequired,
    awayTeamId: PropTypes.string.isRequired,
  }).isRequired,
};
