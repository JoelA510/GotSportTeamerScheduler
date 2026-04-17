import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboardData } from '../hooks/useDashboardData.js';
import { useTeamPersistence } from '../hooks/useTeamPersistence.js';
import { useImport } from '../contexts/ImportContext.jsx';
import TeamOverviewPanel from '../components/TeamOverviewPanel.jsx';
import ProgramOverview from '../components/teaming/ProgramOverview.jsx';
import TeamingConfiguration from '../components/teaming/TeamingConfiguration.jsx';
import RosterManager from '../components/teaming/RosterManager.jsx';
import TeamPersistencePanel from '../components/TeamPersistencePanel.jsx';
import DataValidationPanel from '../components/teaming/DataValidationPanel.jsx';
import Button from '../components/ui/Button.jsx';
import ProgressBar from '../components/ui/ProgressBar.jsx';
import { Edit2, Save, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';

export default function TeamAnalysisPage() {
  const { team, loading, error, timezone } = useDashboardData();
  const { snapshot: persistenceSnapshot, loading: persistenceLoading } = useTeamPersistence();
  const { importedData } = useImport();
  const [isEditMode, setIsEditMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState(null);
  const [configs, setConfigs] = useState({});
  const navigate = useNavigate();

  // Mock data for initial empty state
  const [programs] = useState([
    { id: 'u10-rec', name: 'U10 Recreation League', totalPlayers: 148, capacity: 156 },
    { id: 'u12-rec', name: 'U12 Recreation League', totalPlayers: 112, capacity: 120 },
  ]);

  const selectedProgram = useMemo(
    () => programs.find((p) => p.id === selectedProgramId) || programs[0],
    [selectedProgramId, programs]
  );

  useEffect(() => {
    if (selectedProgram && !configs[selectedProgram.id]) {
      setConfigs((prev) => ({
        ...prev,
        [selectedProgram.id]: {
          targetSize: 12,
          minSize: 10,
          maxSize: 14,
          balancing: 'skill',
        },
      }));
    }
  }, [selectedProgram, configs]);

  const updateConfig = (newConfig) => {
    setConfigs((prev) => ({
      ...prev,
      [selectedProgram.id]: newConfig,
    }));
  };

  const validationErrors = useMemo(() => {
    const errors = [];
    if (!importedData) errors.push('Missing imported player roster.');
    return errors;
  }, [importedData]);

  const handleGenerateTeams = useCallback(async () => {
    setIsGenerating(true);
    try {
      // In a real app, this would trigger the 'generate-teams' Edge Function
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // await supabase.functions.invoke('generate-teams', { body: { config: configs[selectedProgram.id] } });

      // Simulate a long-running process for UI feedback
      await new Promise((resolve) => setTimeout(resolve, 3500));
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [configs, selectedProgram]);

  // Combined loading state for better UX
  const isActuallyGenerating = useMemo(() => {
    if (team?.status === 'running') return true;
    return isGenerating;
  }, [team?.status, isGenerating]);

  // Reset local trigger state when polling confirms processing started or failed
  useEffect(() => {
    if (isGenerating && (team?.status === 'running' || team?.status === 'error')) {
      // This is still a set state in effect, but it's gated and handles the transition
      // To fully remove it, we'd need to manage the transition state in the hook itself.
      // However, making it asynchronous or using a ref for the transition is cleaner.
      const timer = setTimeout(() => setIsGenerating(false), 0);
      return () => clearTimeout(timer);
    }
  }, [team?.status, isGenerating]);

  // Map persistence snapshot to nested structure for RosterManager
  const mappedTeams = useMemo(() => {
    const { teamRows = [], teamPlayerRows = [] } = persistenceSnapshot?.payload || {};
    const rawPlayers = importedData?.data || [];

    return teamRows.map((teamRow) => {
      const players = teamPlayerRows
        .filter((tp) => tp.team_id === teamRow.id)
        .map((tp) => {
          // Join with imported data to get name and skill
          const playerDetails = rawPlayers.find(
            (rp, idx) => rp.id === tp.player_id || String(idx) === String(tp.player_id)
          );

          return {
            id: tp.player_id,
            name: playerDetails
              ? `${playerDetails['First Name'] || playerDetails['first_name'] || ''} ${playerDetails['Last Name'] || playerDetails['last_name'] || ''}`.trim() ||
                'Unnamed Player'
              : 'Unknown Player',
            skill: playerDetails?.['Skill Level'] || playerDetails?.['skill_tier'] || 'developing',
            buddyId: playerDetails?.buddyId || playerDetails?.buddy_id,
            gender: playerDetails?.gender || playerDetails?.Gender,
            age: playerDetails?.age || playerDetails?.Age || 10,
          };
        });

      return {
        id: teamRow.id,
        name: teamRow.name,
        division: teamRow.division || teamRow.division_id,
        minAge: teamRow.min_age,
        maxAge: teamRow.max_age,
        gender: teamRow.gender,
        players,
      };
    });
  }, [persistenceSnapshot?.payload, importedData]);

  // Use real data from the dashboard hook if available, otherwise empty array
  // Map automated results if persistence is empty
  const activeTeams = useMemo(() => {
    if (mappedTeams.length > 0) return mappedTeams;
    if (!team?.teams) return [];

    const rawPlayers = importedData?.data || [];
    const teamPlayers = team?.team_players || [];

    return team.teams.map((t) => ({
      ...t,
      players: teamPlayers
        .filter((tp) => tp.team_id === t.id)
        .map((tp) => {
          const playerDetails = rawPlayers.find(
            (rp, idx) => rp.id === tp.player_id || String(idx) === String(tp.player_id)
          );
          return {
            id: tp.player_id,
            name: playerDetails
              ? `${playerDetails['First Name'] || playerDetails['first_name'] || ''} ${playerDetails['Last Name'] || playerDetails['last_name'] || ''}`.trim() ||
                'Unnamed Player'
              : 'Unknown Player',
            skill: playerDetails?.['Skill Level'] || playerDetails?.['skill_tier'] || 'developing',
            buddyId: playerDetails?.buddyId || playerDetails?.buddy_id,
            gender: playerDetails?.gender || playerDetails?.Gender,
            age: playerDetails?.age || playerDetails?.Age || 10,
          };
        }),
    }));
  }, [mappedTeams, team, importedData]);

  return (
    <div className="animate-fadeIn space-y-8 max-w-[65ch] mx-auto w-full">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-text-primary mb-2">
            Teaming & Analysis
          </h1>
          <p className="text-text-secondary">
            Review team generation, division capacity, and roster assignments.
          </p>
        </div>
        {team?.generatedAt && (
          <Button
            variant={isEditMode ? 'primary' : 'secondary'}
            onClick={() => setIsEditMode(!isEditMode)}
            className="flex items-center gap-2"
          >
            {isEditMode ? <Save size={18} /> : <Edit2 size={18} />}
            {isEditMode ? 'Save Changes' : 'Edit Mode'}
          </Button>
        )}
      </div>

      {loading?.team || isActuallyGenerating ? (
        <div className="p-12 text-center animate-fadeIn">
          <div className="max-w-md mx-auto">
            <h3 className="text-xl font-bold text-text-primary mb-4">
              {team?.status === 'running' || isActuallyGenerating
                ? 'Generating Teams...'
                : 'Loading Team Data...'}
            </h3>
            <ProgressBar
              progress={team?.progress || 0}
              label={
                team?.status === 'running' || isActuallyGenerating
                  ? 'Processing roster rules and division caps...'
                  : 'Fetching data...'
              }
            />
          </div>
        </div>
      ) : !team?.generatedAt && importedData ? (
        // NEW DASHBOARD VIEW
        <div className="space-y-6">
          {/* 1. Validation Panel */}
          <DataValidationPanel errors={validationErrors} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 2. Program Overview (Left 2/3) */}
            <div className="lg:col-span-2">
              <ProgramOverview
                programs={programs}
                onSelectProgram={setSelectedProgramId}
                selectedProgramId={selectedProgramId}
              />
            </div>

            {/* 3. Configuration (Right 1/3) */}
            <div className="lg:col-span-1">
              <TeamingConfiguration
                program={selectedProgram}
                config={selectedProgram ? configs[selectedProgram.id] : null}
                onUpdate={updateConfig}
              />
            </div>
          </div>

          {/* 4. Action Bar */}
          <div className="flex justify-end pt-6 border-t border-border-subtle">
            <Button
              variant="primary"
              size="lg"
              onClick={handleGenerateTeams}
              disabled={isActuallyGenerating || validationErrors.length > 0}
              className="flex items-center gap-2"
            >
              Generate Teams <ArrowRight size={18} />
            </Button>
          </div>
        </div>
      ) : isEditMode ? (
        <div className="space-y-6">
          <div className="bg-bg-surface border border-border-subtle rounded-xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-text-primary">Manual Roster Management</h3>
              <p className="text-sm text-text-secondary">
                Drag and drop players between teams to manually override automated assignments.
              </p>
            </div>
            <RosterManager initialTeams={activeTeams} />
          </div>
        </div>
      ) : (
        <>
          <TeamOverviewPanel
            totals={team.totals}
            divisions={team.divisions}
            generatedAt={team.generatedAt}
            timezone={timezone}
          />
          <TeamPersistencePanel teamPersistenceSnapshot={persistenceSnapshot} />
          <div className="flex justify-end pt-4 border-t border-border-subtle">
            <Button variant="primary" size="lg" onClick={() => navigate('/fields')}>
              Confirm Teams & Proceed
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
