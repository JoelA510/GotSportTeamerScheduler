import React, { useState } from 'react';
import { AlertCircle, Plus, Check } from 'lucide-react';
import Button from './ui/Button.jsx';

export default function PracticeOverridePanel({ teams = [], baseSlots = [] }) {
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [overrides, setOverrides] = useState([]);

  // Mock checking for conflicts (e.g., Coach already has a team in this slot)
  const checkForConflict = (teamId, slotId) => {
    const team = teams.find((t) => String(t.id) === String(teamId));
    if (!team || !team.headCoach) return null;

    // Check if any existing override has the same coach in the same slot
    const conflict = overrides.find((o) => {
      const oTeam = teams.find((t) => String(t.id) === String(o.teamId));
      return o.slotId === slotId && oTeam?.headCoach === team.headCoach;
    });

    if (conflict) {
      return `Coach ${team.headCoach} is already scheduled at this time with ${
        teams.find((t) => String(t.id) === String(conflict.teamId))?.name || 'another team'
      }.`;
    }

    return null;
  };

  const handleAssign = () => {
    if (!selectedTeamId || !selectedSlotId) return;

    const conflict = checkForConflict(selectedTeamId, selectedSlotId);

    const newOverride = {
      id: Date.now().toString(),
      teamId: selectedTeamId,
      slotId: selectedSlotId,
      conflictWarning: conflict,
      status: 'pending',
    };

    setOverrides([newOverride, ...overrides]);
    setSelectedTeamId('');
    setSelectedSlotId('');
  };

  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 mt-8 shadow-sm">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-xl font-bold text-text-primary mb-1">Manual Practice Overrides</h3>
          <p className="text-sm text-text-secondary">
            Assign specific teams to practice slots, overriding the algorithm.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-8 p-4 bg-bg-surface-hover border border-border-default rounded-lg">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">
            Select Team
          </label>
          <select
            className="w-full bg-bg-input border border-border-default rounded-md px-3 py-2 text-text-primary focus:border-blue-500 focus:outline-none transition-colors appearance-none"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
          >
            <option value="">-- Choose Team --</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.division}) - Coach: {t.headCoach || 'None'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">
            Select Practice Slot
          </label>
          <select
            className="w-full bg-bg-input border border-border-default rounded-md px-3 py-2 text-text-primary focus:border-blue-500 focus:outline-none transition-colors appearance-none"
            value={selectedSlotId}
            onChange={(e) => setSelectedSlotId(e.target.value)}
          >
            <option value="">-- Choose Slot --</option>
            {baseSlots.map((s) => (
              <option key={s.baseSlotId} value={s.baseSlotId}>
                {s.day} @ {s.baseSlotId.split('_').pop().slice(0, 5)} (Avail:{' '}
                {s.totalCapacity - s.totalAssigned})
              </option>
            ))}
          </select>
        </div>

        <Button
          variant="primary"
          onClick={handleAssign}
          disabled={!selectedTeamId || !selectedSlotId}
          className="flex items-center gap-2 h-10"
        >
          <Plus size={16} /> Assign Slot
        </Button>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-text-primary mb-3">Pending Overrides</h4>
        {overrides.length === 0 ? (
          <div className="text-sm text-text-muted italic p-4 text-center border border-dashed border-border-subtle rounded-md">
            No manual overrides created yet.
          </div>
        ) : (
          overrides.map((override) => {
            const team = teams.find((t) => String(t.id) === String(override.teamId));
            const slot = baseSlots.find((s) => s.baseSlotId === override.slotId);

            return (
              <div
                key={override.id}
                className="flex items-start justify-between p-4 bg-bg-surface border border-border-subtle rounded-md"
              >
                <div className="space-y-1 w-full max-w-lg">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-text-primary">{team?.name}</span>
                    <span className="text-text-muted">&rarr;</span>
                    <span className="font-medium text-blue-400">
                      {slot?.day} at {slot?.baseSlotId.split('_').pop()}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
                      Manual
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">Division: {team?.division}</p>

                  {override.conflictWarning && (
                    <div className="mt-2 text-xs flex items-center gap-1.5 text-amber-500 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                      <AlertCircle size={14} className="shrink-0" />
                      <span>Conflict: {override.conflictWarning}</span>
                    </div>
                  )}
                </div>

                <div className="text-emerald-500 flex items-center gap-1 text-xs font-semibold">
                  <Check size={14} /> Saved
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
