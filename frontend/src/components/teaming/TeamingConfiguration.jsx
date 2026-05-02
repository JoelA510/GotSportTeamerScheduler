import React from 'react';
import Button from '../ui/Button.jsx';

export default function TeamingConfiguration({ program, config, onUpdate }) {
  if (!program)
    return (
      <div className="bg-bg-surface border border-border-subtle rounded-xl p-8 text-center text-text-muted h-full flex items-center justify-center">
        Select a program to configure
      </div>
    );

  const handleNumberChange = (field, value) => {
    const intValue = Number.parseInt(value, 10);
    onUpdate(program.id, { [field]: Number.isNaN(intValue) ? null : intValue });
  };

  const handleTextChange = (field, value) => {
    onUpdate(program.id, { [field]: value });
  };

  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 h-full">
      <h3 className="font-bold text-text-primary mb-1">{program.name} Settings</h3>
      <p className="text-sm text-text-secondary mb-6">Configure team generation rules.</p>

      <div className="space-y-6">
        <div>
          <label
            htmlFor="target-team-size"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            Target Team Size
          </label>
          <input
            id="target-team-size"
            type="number"
            min="1"
            className="w-full bg-bg-base border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            value={config?.targetTeamSize ?? ''}
            onChange={(e) => handleNumberChange('targetTeamSize', e.target.value)}
          />
          <p className="text-xs text-text-muted mt-1">Ideal number of players per team.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="min-roster"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Min Roster
            </label>
            <input
              id="min-roster"
              type="number"
              min="1"
              className="w-full bg-bg-base border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={config?.minRosterSize ?? ''}
              onChange={(e) => handleNumberChange('minRosterSize', e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="max-roster"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Max Roster
            </label>
            <input
              id="max-roster"
              type="number"
              min="1"
              className="w-full bg-bg-base border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={config?.maxRosterSize ?? ''}
              onChange={(e) => handleNumberChange('maxRosterSize', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="min-teams"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Min Teams
            </label>
            <input
              id="min-teams"
              type="number"
              min="1"
              placeholder="Auto"
              className="w-full bg-bg-base border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={config?.minTeams ?? ''}
              onChange={(e) => handleNumberChange('minTeams', e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="max-teams"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Max Teams
            </label>
            <input
              id="max-teams"
              type="number"
              min="1"
              placeholder="Auto"
              className="w-full bg-bg-base border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={config?.maxTeams ?? ''}
              onChange={(e) => handleNumberChange('maxTeams', e.target.value)}
            />
          </div>
        </div>

        <div className="pt-4 border-t border-border-subtle">
          <label
            htmlFor="team-count-override"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            Override Team Count
          </label>
          <div className="flex gap-2">
            <input
              id="team-count-override"
              type="number"
              min="1"
              placeholder="Auto"
              className="flex-1 bg-bg-base border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={config?.teamCountOverride ?? ''}
              onChange={(e) => handleNumberChange('teamCountOverride', e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() => handleNumberChange('teamCountOverride', '')}
              disabled={config?.teamCountOverride == null}
            >
              Reset
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Force a specific number of teams (currently estimated: {program.estimatedTeams})
          </p>
        </div>

        <div className="pt-4 border-t border-border-subtle">
          <label
            htmlFor="random-seed"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            Random Seed
          </label>
          <div className="flex gap-2">
            <input
              id="random-seed"
              type="text"
              placeholder="e.g. 12345"
              className="w-full bg-bg-base border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={config?.seed || ''}
              onChange={(e) => handleTextChange('seed', e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() => handleTextChange('seed', '')}
              disabled={!config?.seed}
            >
              Clear
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Use the same seed to reproduce specific team assignments.
          </p>
        </div>
      </div>
    </div>
  );
}
