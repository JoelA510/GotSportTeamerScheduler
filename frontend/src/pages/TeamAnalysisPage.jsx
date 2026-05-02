import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboardData } from '../hooks/useDashboardData.js';
import { useTeamPersistence } from '../hooks/useTeamPersistence.js';
import { useImport } from '../contexts/ImportContext.jsx';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
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
import { generateTeams } from '../../../packages/core/src/teamGeneration.js';
import { PERMISSIONS } from '../constants/permissions.js';

const DEFAULT_MAX_ROSTER_SIZE = 14;
const DEFAULT_MIN_ROSTER_SIZE = 10;
const DEFAULT_TARGET_TEAM_SIZE = 12;

function getImportedRows(importedData) {
  if (!importedData) return [];
  if (Array.isArray(importedData)) return importedData;
  if (Array.isArray(importedData.data)) return importedData.data;
  if (Array.isArray(importedData.fullData)) return importedData.fullData;
  if (Array.isArray(importedData.rows)) return importedData.rows;
  return [];
}

function firstNonEmpty(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function resolveDivisionName(row) {
  return (
    firstNonEmpty(row, [
      'division_name',
      'division',
      'divisionName',
      'Division',
      'Group',
      'Program',
      'program',
    ]) || 'Unassigned'
  );
}

function resolveDivisionId(row) {
  const explicitId = firstNonEmpty(row, ['division_id', 'divisionId']);
  return String(explicitId || resolveDivisionName(row)).trim();
}

function createDefaultConfig(program) {
  const estimatedTeams = Math.max(
    1,
    Math.ceil((program?.playerCount || 0) / DEFAULT_TARGET_TEAM_SIZE)
  );
  return {
    targetTeamSize: DEFAULT_TARGET_TEAM_SIZE,
    minRosterSize: DEFAULT_MIN_ROSTER_SIZE,
    maxRosterSize: DEFAULT_MAX_ROSTER_SIZE,
    minTeams: null,
    maxTeams: null,
    teamCountOverride: estimatedTeams,
    seed: '',
  };
}

function derivePrograms(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const id = resolveDivisionId(row);
    const name = String(resolveDivisionName(row)).trim() || id;
    const current = grouped.get(id) || { id, name, playerCount: 0 };
    current.playerCount += 1;
    grouped.set(id, current);
  });

  return Array.from(grouped.values()).map((program) => ({
    ...program,
    totalPlayers: program.playerCount,
  }));
}

function positiveIntegerOrFallback(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function deriveProgramStats(program, config = {}) {
  const targetTeamSize = positiveIntegerOrFallback(config.targetTeamSize, DEFAULT_TARGET_TEAM_SIZE);
  const maxRosterSize = positiveIntegerOrFallback(config.maxRosterSize, DEFAULT_MAX_ROSTER_SIZE);
  const minTeams = positiveIntegerOrFallback(config.minTeams, null);
  const maxTeams = positiveIntegerOrFallback(config.maxTeams, null);
  const overrideTeams = positiveIntegerOrFallback(config.teamCountOverride, null);
  const baseEstimate =
    overrideTeams || Math.max(1, Math.ceil(program.playerCount / targetTeamSize));
  const minBoundedEstimate = minTeams ? Math.max(baseEstimate, minTeams) : baseEstimate;
  const estimatedTeams = maxTeams ? Math.min(minBoundedEstimate, maxTeams) : minBoundedEstimate;

  return {
    ...program,
    estimatedTeams,
    avgRosterSize: Number((program.playerCount / estimatedTeams).toFixed(1)),
    capacity: estimatedTeams * maxRosterSize,
  };
}

function findDivisionRowForProgram(program, divisionRows) {
  if (!program) return null;
  const rows = divisionRows || [];
  const programId = String(program.id || '')
    .trim()
    .toLowerCase();
  const programName = String(program.name || '')
    .trim()
    .toLowerCase();

  return (
    rows.find(
      (row) =>
        String(row.id || '')
          .trim()
          .toLowerCase() === programId
    ) ||
    rows.find(
      (row) =>
        String(row.name || '')
          .trim()
          .toLowerCase() === programName
    ) ||
    rows.find(
      (row) =>
        String(row.name || '')
          .trim()
          .toLowerCase() === programId
    ) ||
    null
  );
}

function configFromDivisionRow(program, divisionRow) {
  const defaults = createDefaultConfig(program);
  if (!divisionRow) return defaults;

  return {
    ...defaults,
    targetTeamSize: divisionRow.target_team_size ?? defaults.targetTeamSize,
    minRosterSize: divisionRow.min_roster_size ?? defaults.minRosterSize,
    maxRosterSize: divisionRow.max_roster_size ?? defaults.maxRosterSize,
    minTeams: divisionRow.min_teams ?? defaults.minTeams,
    maxTeams: divisionRow.max_teams ?? defaults.maxTeams,
    teamCountOverride: divisionRow.team_count_override ?? defaults.teamCountOverride,
  };
}

function toDivisionConfigPayload({ program, config, organizationId, seasonSettingsId }) {
  return {
    organization_id: organizationId,
    season_settings_id: seasonSettingsId,
    name: program.name || String(program.id),
    max_roster_size: config.maxRosterSize ?? null,
    min_roster_size: config.minRosterSize ?? null,
    target_team_size: config.targetTeamSize ?? null,
    team_count_override: config.teamCountOverride ?? null,
    min_teams: config.minTeams ?? null,
    max_teams: config.maxTeams ?? null,
  };
}

function parseBooleanLike(value) {
  return ['true', 'yes', 'y', '1'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function normalizeSkillRating(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  const text = String(value).trim().toLowerCase();
  if (text === 'advanced') return 5;
  if (text === 'developing') return 3;
  if (text === 'novice') return 1;
  return undefined;
}

function toGeneratorPlayer(row, sourceIndex, division) {
  const id = String(
    firstNonEmpty(row, [
      'id',
      'player_id',
      'playerId',
      'external_registration_id',
      'gotsport_id',
      'registration_id',
    ]) || sourceIndex
  );
  const firstName = firstNonEmpty(row, ['first_name', 'First Name', 'firstName']) || '';
  const lastName = firstNonEmpty(row, ['last_name', 'Last Name', 'lastName']) || '';
  const skillRating = normalizeSkillRating(
    firstNonEmpty(row, ['skillRating', 'skill_rating', 'Skill Rating', 'skill_tier', 'Skill Tier'])
  );
  const coachId = firstNonEmpty(row, ['coach_id', 'coachId', 'coach_email', 'Coach Email']);
  const willingToCoach =
    parseBooleanLike(row.willing_to_coach) ||
    parseBooleanLike(row.coach_volunteer) ||
    parseBooleanLike(row['Willing to Coach']);

  return {
    id,
    division,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim() || 'Unnamed Player',
    ...(skillRating !== undefined ? { skillRating } : {}),
    ...(coachId || willingToCoach ? { coachId: String(coachId || `coach-${id}`) } : {}),
  };
}

function buildGeneratedTeamPlayerRows(teamsByDivision) {
  return Object.values(teamsByDivision || {}).flatMap((teams) =>
    (teams || []).flatMap((team) =>
      (team.players || []).map((player) => ({
        team_id: team.id,
        player_id: player.id,
        role: 'player',
        source: 'auto',
      }))
    )
  );
}

export default function TeamAnalysisPage() {
  const { team, loading, error: _error, timezone } = useDashboardData();
  const { persistenceSnapshot, loading: _persistenceLoading } = useTeamPersistence();
  const { importedData } = useImport();
  const { currentOrganization, currentSeasonSetting, permissions = [] } = useOrganization();
  const [isEditMode, setIsEditMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState(null);
  const [configs, setConfigs] = useState({});
  const [generationError, setGenerationError] = useState(null);
  const [divisionRows, setDivisionRows] = useState(null);
  const [divisionSettingsError, setDivisionSettingsError] = useState(null);
  const [savingConfigId, setSavingConfigId] = useState(null);
  const [configSaveMessage, setConfigSaveMessage] = useState('');
  const navigate = useNavigate();
  const canManageTeams =
    permissions.includes(PERMISSIONS.MANAGE_ALL_TEAMS) ||
    permissions.includes(PERMISSIONS.MANAGE_ORGANIZATION);

  const importedPlayerRows = useMemo(() => getImportedRows(importedData), [importedData]);
  const basePrograms = useMemo(() => derivePrograms(importedPlayerRows), [importedPlayerRows]);
  const programs = useMemo(
    () =>
      basePrograms.map((program) =>
        deriveProgramStats(program, configs[program.id] || createDefaultConfig(program))
      ),
    [basePrograms, configs]
  );

  useEffect(() => {
    setConfigs({});
    setConfigSaveMessage('');
  }, [currentOrganization?.id, currentSeasonSetting?.id]);

  const selectedProgram = useMemo(
    () => programs.find((p) => p.id === selectedProgramId) || programs[0],
    [selectedProgramId, programs]
  );

  useEffect(() => {
    if (basePrograms.length === 0 || divisionRows === null) return;

    setConfigs((prev) => {
      let changed = false;
      const next = { ...prev };

      basePrograms.forEach((program) => {
        if (next[program.id]) return;
        const divisionRow = findDivisionRowForProgram(program, divisionRows);
        next[program.id] = configFromDivisionRow(program, divisionRow);
        changed = true;
      });

      return changed ? next : prev;
    });
  }, [basePrograms, divisionRows]);

  useEffect(() => {
    const selectedExists = programs.some((program) => program.id === selectedProgramId);
    if (programs.length > 0 && (!selectedProgramId || !selectedExists)) {
      setSelectedProgramId(programs[0].id);
    }
  }, [programs, selectedProgramId]);

  useEffect(() => {
    let cancelled = false;

    const fetchDivisionRows = async () => {
      if (!currentOrganization?.id || !currentSeasonSetting?.id) {
        setDivisionRows([]);
        setDivisionSettingsError(null);
        return;
      }

      setDivisionRows(null);
      const { data, error } = await supabase
        .from('divisions')
        .select(
          `
          id,
          organization_id,
          season_settings_id,
          name,
          max_roster_size,
          min_roster_size,
          target_team_size,
          team_count_override,
          min_teams,
          max_teams
        `
        )
        .eq('organization_id', currentOrganization.id)
        .eq('season_settings_id', currentSeasonSetting.id)
        .order('name', { ascending: true });

      if (cancelled) return;
      if (error) {
        setDivisionRows([]);
        setDivisionSettingsError(error.message || 'Could not load division settings.');
        return;
      }

      setDivisionRows(data || []);
      setDivisionSettingsError(null);
    };

    fetchDivisionRows();

    return () => {
      cancelled = true;
    };
  }, [currentOrganization?.id, currentSeasonSetting?.id]);

  const updateConfig = (programId, patch) => {
    setConfigSaveMessage('');
    setConfigs((prev) => ({
      ...prev,
      [programId]: {
        ...(prev[programId] || {}),
        ...patch,
      },
    }));
  };

  const saveDivisionConfig = useCallback(
    async (program, config, { silent = false } = {}) => {
      if (!program) throw new Error('Select a program before saving rules.');
      if (!currentOrganization?.id) throw new Error('Select an active organization.');
      if (!currentSeasonSetting?.id) throw new Error('Select an active season.');
      if (!canManageTeams) throw new Error('Admin team-management permission is required.');
      if (divisionRows === null) throw new Error('Division settings are still loading.');

      const payload = toDivisionConfigPayload({
        program,
        config,
        organizationId: currentOrganization.id,
        seasonSettingsId: currentSeasonSetting.id,
      });
      const existingRow = findDivisionRowForProgram(program, divisionRows);
      if (existingRow?.id) payload.id = existingRow.id;

      if (!silent) {
        setSavingConfigId(program.id);
        setConfigSaveMessage('');
      }

      try {
        const { data, error } = await supabase
          .from('divisions')
          .upsert(payload, { onConflict: 'season_settings_id,name' })
          .select(
            `
            id,
            organization_id,
            season_settings_id,
            name,
            max_roster_size,
            min_roster_size,
            target_team_size,
            team_count_override,
            min_teams,
            max_teams
          `
          )
          .single();

        if (error) {
          if (!silent) setConfigSaveMessage(`Save failed: ${error.message}`);
          throw error;
        }

        setDivisionRows((prev) => {
          const withoutCurrent = (prev || []).filter(
            (row) =>
              String(row.id) !== String(data.id) &&
              !(
                String(row.season_settings_id) === String(data.season_settings_id) &&
                String(row.name).trim().toLowerCase() === String(data.name).trim().toLowerCase()
              )
          );
          return [...withoutCurrent, data].sort((a, b) =>
            String(a.name).localeCompare(String(b.name))
          );
        });
        if (!silent) setConfigSaveMessage('Rules saved.');
        return data;
      } finally {
        if (!silent) setSavingConfigId(null);
      }
    },
    [canManageTeams, currentOrganization?.id, currentSeasonSetting?.id, divisionRows]
  );

  const validationErrors = useMemo(() => {
    const errors = [];
    const selectedConfig = selectedProgram ? configs[selectedProgram.id] : null;

    if (importedPlayerRows.length === 0) {
      errors.push({ type: 'data', message: 'Missing imported player roster.' });
    }
    if (!currentOrganization?.id) {
      errors.push({ type: 'organization', message: 'Select an active organization.' });
    }
    if (!canManageTeams) {
      errors.push({ type: 'permission', message: 'Admin team-management permission is required.' });
    }
    if (divisionSettingsError) {
      errors.push({ type: 'division-settings', message: divisionSettingsError });
    }
    if (!selectedProgram) {
      errors.push({ type: 'division', message: 'Select a program before generating teams.' });
    }
    if (
      selectedConfig?.minRosterSize &&
      selectedConfig?.maxRosterSize &&
      selectedConfig.minRosterSize > selectedConfig.maxRosterSize
    ) {
      errors.push({
        type: 'roster',
        message: 'Minimum roster size cannot exceed max roster size.',
      });
    }
    if (
      selectedConfig?.minTeams &&
      selectedConfig?.maxTeams &&
      selectedConfig.minTeams > selectedConfig.maxTeams
    ) {
      errors.push({ type: 'teams', message: 'Minimum team count cannot exceed max team count.' });
    }
    if (
      selectedConfig?.teamCountOverride &&
      selectedConfig?.minTeams &&
      selectedConfig.teamCountOverride < selectedConfig.minTeams
    ) {
      errors.push({ type: 'teams', message: 'Override team count cannot be below min teams.' });
    }
    if (
      selectedConfig?.teamCountOverride &&
      selectedConfig?.maxTeams &&
      selectedConfig.teamCountOverride > selectedConfig.maxTeams
    ) {
      errors.push({ type: 'teams', message: 'Override team count cannot exceed max teams.' });
    }
    if (generationError) {
      errors.push({ type: 'generation', message: generationError });
    }

    return errors;
  }, [
    configs,
    canManageTeams,
    currentOrganization?.id,
    divisionSettingsError,
    generationError,
    importedPlayerRows.length,
    selectedProgram,
  ]);

  const handleGenerateTeams = useCallback(async () => {
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user?.id) throw new Error('Sign in before generating teams.');
      if (!currentOrganization?.id) throw new Error('Select an active organization.');
      if (!selectedProgram) throw new Error('Select a program before generating teams.');

      const selectedProgramKey = String(selectedProgram.id);
      const config = configs[selectedProgramKey] || createDefaultConfig(selectedProgram);
      await saveDivisionConfig(selectedProgram, config, { silent: true });
      const rowsForProgram = importedPlayerRows
        .map((row, sourceIndex) => ({ row, sourceIndex }))
        .filter(({ row }) => resolveDivisionId(row) === selectedProgramKey);
      if (rowsForProgram.length === 0) {
        throw new Error(`No imported players found for ${selectedProgram.name}.`);
      }

      const generatorPlayers = rowsForProgram.map(({ row, sourceIndex }) =>
        toGeneratorPlayer(row, sourceIndex, selectedProgramKey)
      );
      const divisionConfig = {
        id: selectedProgramKey,
        name: selectedProgram.name,
        teamsCount: config.teamCountOverride || selectedProgram.estimatedTeams,
        slotsPerWeek: 0,
        maxRosterSize: config.maxRosterSize,
        minRosterSize: config.minRosterSize,
        targetTeamSize: config.targetTeamSize,
        teamCountOverride: config.teamCountOverride,
        minTeams: config.minTeams,
        maxTeams: config.maxTeams,
      };
      const result = generateTeams({
        players: generatorPlayers,
        divisionConfigs: { [selectedProgramKey]: divisionConfig },
        seed: config.seed,
      });
      const teams = Object.values(result.teamsByDivision).flat();
      const teamPlayers = buildGeneratedTeamPlayerRows(result.teamsByDivision);
      const overflowPlayers = Object.values(result.overflowSummaryByDivision || {}).reduce(
        (sum, summary) => sum + (summary?.totalPlayers || 0),
        0
      );
      const now = new Date().toISOString();

      const { error: insertError } = await supabase.from('scheduler_runs').insert({
        organization_id: currentOrganization.id,
        season_id: currentSeasonSetting?.id ?? null,
        season_settings_id: currentSeasonSetting?.id ?? null,
        run_type: 'team',
        status: 'completed',
        parameters: {
          source: 'team_analysis_page',
          selectedProgramId: selectedProgramKey,
          divisionConfigs: { [selectedProgramKey]: divisionConfig },
        },
        metrics: {
          progress: 100,
          generatedTeams: teams.length,
          assignedPlayers: teamPlayers.length,
          overflowPlayers,
        },
        results: {
          ...result,
          teams,
          team_players: teamPlayers,
        },
        started_at: now,
        completed_at: now,
        created_by: user.id,
      });
      if (insertError) throw insertError;
    } catch (err) {
      console.error('Generation failed:', err);
      setGenerationError(err?.message || 'Team generation failed.');
    } finally {
      setIsGenerating(false);
    }
  }, [
    configs,
    currentOrganization?.id,
    currentSeasonSetting?.id,
    importedPlayerRows,
    saveDivisionConfig,
    selectedProgram,
  ]);

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
    const rawPlayers = importedPlayerRows;

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
  }, [persistenceSnapshot?.payload, importedPlayerRows]);

  // Use real data from the dashboard hook if available, otherwise empty array
  // Map automated results if persistence is empty
  const activeTeams = useMemo(() => {
    if (mappedTeams.length > 0) return mappedTeams;
    if (!team?.teams) return [];

    const rawPlayers = importedPlayerRows;
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
  }, [mappedTeams, team, importedPlayerRows]);

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
                onSave={() =>
                  selectedProgram &&
                  saveDivisionConfig(
                    selectedProgram,
                    configs[selectedProgram.id] || createDefaultConfig(selectedProgram)
                  ).catch((err) => {
                    console.error('Division rule save failed:', err);
                  })
                }
                saving={selectedProgram ? savingConfigId === selectedProgram.id : false}
                saveDisabled={
                  !canManageTeams ||
                  !selectedProgram ||
                  divisionRows === null ||
                  validationErrors.some((error) => error.type !== 'generation')
                }
                saveMessage={configSaveMessage}
              />
            </div>
          </div>

          {/* 4. Action Bar */}
          <div className="flex justify-end pt-6 border-t border-border-subtle">
            <Button
              variant="primary"
              size="lg"
              onClick={handleGenerateTeams}
              disabled={
                isActuallyGenerating ||
                divisionRows === null ||
                validationErrors.some((error) => error.type !== 'generation')
              }
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
