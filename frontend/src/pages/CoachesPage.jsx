import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  UserMinus,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { usePermission } from '../hooks/usePermission.js';
import { logger } from '../lib/logger.js';

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'registered', label: 'Registered' },
  { id: 'interested', label: 'Interested' },
  { id: 'inactive', label: 'Inactive' },
];

const STATUS_LABELS = {
  active: 'Registered',
  'pending-confirmation': 'Pending',
  interested: 'Interested',
  inactive: 'Inactive',
};

const STATUS_OPTIONS = [
  { id: 'active', label: 'Registered' },
  { id: 'pending-confirmation', label: 'Pending' },
  { id: 'interested', label: 'Interested' },
  { id: 'inactive', label: 'Inactive' },
];

const STATUS_STYLES = {
  active: 'border-status-success/30 bg-status-success-bg text-status-success',
  'pending-confirmation': 'border-status-warning/30 bg-status-warning-bg text-status-warning',
  interested: 'border-brand-400/30 bg-brand-glow text-brand-400',
  inactive: 'border-border-highlight bg-bg-surface text-text-muted',
};

function normalizeSearch(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatTeamAssignmentLabel({ team, divisionsById }) {
  const divisionName = divisionsById.get(String(team.division_id || ''))?.name;
  return [team.name || team.id, divisionName, team.coach_id ? 'Assigned' : 'Unassigned']
    .filter(Boolean)
    .join(' - ');
}

function getCoachStatusGroup(status) {
  if (status === 'active' || status === 'pending-confirmation') return 'registered';
  if (status === 'inactive') return 'inactive';
  return 'interested';
}

function formatDate(value) {
  if (!value) return 'Not imported';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not imported';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function buildCoachReviewRows({
  coaches = [],
  interestedPrograms = [],
  divisions = [],
  players = [],
  teams = [],
} = {}) {
  const divisionsById = new Map(divisions.map((division) => [String(division.id), division]));
  const playersById = new Map(players.map((player) => [String(player.id), player]));
  const interestsByCoach = new Map();
  const teamsByCoach = new Map();

  for (const interest of interestedPrograms) {
    const coachId = String(interest.coach_id || '');
    if (!coachId) continue;
    const entries = interestsByCoach.get(coachId) || [];
    entries.push(interest);
    interestsByCoach.set(coachId, entries);
  }

  for (const team of teams) {
    const coachId = String(team.coach_id || '');
    if (!coachId) continue;
    const entries = teamsByCoach.get(coachId) || [];
    entries.push(team);
    teamsByCoach.set(coachId, entries);
  }

  return coaches.map((coach) => {
    const coachId = String(coach.id);
    const interests = interestsByCoach.get(coachId) || [];
    const assignedTeams = teamsByCoach.get(coachId) || [];
    const status = coach.status || 'active';
    const divisionIds = uniqueValues([
      ...interests.map((interest) => (interest.division_id ? String(interest.division_id) : null)),
      ...assignedTeams.map((team) => (team.division_id ? String(team.division_id) : null)),
    ]);
    const programNames = uniqueValues(
      divisionIds.map((divisionId) => divisionsById.get(divisionId)?.name || divisionId)
    );
    const playerNames = uniqueValues(
      interests.map((interest) => {
        const player = playersById.get(String(interest.inferred_from_player_id || ''));
        if (!player) return null;
        return `${player.first_name || ''} ${player.last_name || ''}`.trim() || player.id;
      })
    );

    return {
      id: coach.id,
      fullName: coach.full_name || 'Unnamed coach',
      email: coach.email || '',
      phone: coach.phone || '',
      status,
      statusLabel: STATUS_LABELS[status] || status,
      statusGroup: getCoachStatusGroup(status),
      importSource: coach.import_source || '',
      lastImportedAt: coach.last_imported_at || null,
      lastImportedLabel: formatDate(coach.last_imported_at),
      canCoachMultipleTeams: Boolean(coach.can_coach_multiple_teams),
      divisionIds,
      programNames,
      playerNames,
      teams: assignedTeams.map((team) => ({
        id: team.id,
        name: team.name || team.id,
        divisionId: team.division_id || null,
      })),
      interestedProgramCount: interests.length,
    };
  });
}

export function summarizeCoachRows(rows = []) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row.statusGroup === 'registered') summary.registered += 1;
      if (row.statusGroup === 'interested') summary.interested += 1;
      if (row.statusGroup === 'inactive') summary.inactive += 1;
      if (row.statusGroup === 'registered' && row.teams.length === 0) summary.unassigned += 1;
      return summary;
    },
    { total: 0, registered: 0, interested: 0, inactive: 0, unassigned: 0 }
  );
}

export function filterCoachReviewRows(
  rows = [],
  { status = 'all', divisionId = 'all', search = '' } = {}
) {
  const query = normalizeSearch(search);

  return rows.filter((row) => {
    const matchesStatus = status === 'all' || row.statusGroup === status;
    const matchesDivision = divisionId === 'all' || row.divisionIds.includes(String(divisionId));
    const searchable = [
      row.fullName,
      row.email,
      row.phone,
      row.statusLabel,
      ...row.programNames,
      ...row.playerNames,
      ...row.teams.map((team) => team.name),
    ]
      .join(' ')
      .toLowerCase();
    const matchesSearch = !query || searchable.includes(query);

    return matchesStatus && matchesDivision && matchesSearch;
  });
}

export function buildTeamAssignmentOptions({ teams = [], divisions = [] } = {}) {
  const divisionsById = new Map(divisions.map((division) => [String(division.id), division]));

  return teams.map((team) => ({
    value: team.id,
    label: formatTeamAssignmentLabel({ team, divisionsById }),
    coachId: team.coach_id || null,
    divisionId: team.division_id || null,
  }));
}

export function canAssignCoachToTeam(coach) {
  return coach?.status === 'active' || coach?.status === 'pending-confirmation';
}

export function canSetCoachStatus(coach, status) {
  return !(['inactive', 'interested'].includes(status) && (coach?.teams || []).length > 0);
}

function CoachStat({ icon: Icon, label, value }) {
  return (
    <div className="bg-bg-surface border border-border-highlight rounded-lg p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-text-muted">
        <Icon size={15} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold text-text-primary">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label }) {
  const className = STATUS_STYLES[status] || STATUS_STYLES.inactive;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

export default function CoachesPage() {
  const { currentOrganization } = useOrganization();
  const { can, PERMISSIONS } = usePermission();
  const latestRequestRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mutationMessage, setMutationMessage] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [selectedTeamByCoach, setSelectedTeamByCoach] = useState({});
  const [coaches, setCoaches] = useState([]);
  const [interestedPrograms, setInterestedPrograms] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const canManageCoaches = can(PERMISSIONS.MANAGE_ORGANIZATION);

  const loadCoaches = useCallback(async () => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;

    if (!currentOrganization?.id) {
      setCoaches([]);
      setInterestedPrograms([]);
      setDivisions([]);
      setPlayers([]);
      setTeams([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [coachResult, interestResult, divisionResult, teamResult] = await Promise.all([
        supabase
          .from('coaches')
          .select(
            'id, organization_id, full_name, email, phone, status, import_source, last_imported_at, can_coach_multiple_teams, created_at'
          )
          .eq('organization_id', currentOrganization.id)
          .order('full_name', { ascending: true }),
        supabase
          .from('coach_interested_programs')
          .select('id, coach_id, division_id, inferred_from_player_id, organization_id, created_at')
          .eq('organization_id', currentOrganization.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('divisions')
          .select('id, name, organization_id')
          .eq('organization_id', currentOrganization.id)
          .order('name', { ascending: true }),
        supabase
          .from('teams')
          .select('id, name, division_id, coach_id, organization_id')
          .eq('organization_id', currentOrganization.id)
          .order('name', { ascending: true }),
      ]);

      const resultError =
        coachResult.error || interestResult.error || divisionResult.error || teamResult.error;
      if (resultError) throw resultError;
      if (latestRequestRef.current !== requestId) return;

      const sourcePlayerIds = uniqueValues(
        (interestResult.data || []).map((interest) =>
          interest.inferred_from_player_id ? String(interest.inferred_from_player_id) : null
        )
      );
      const playerResult =
        sourcePlayerIds.length > 0
          ? await supabase
              .from('players')
              .select('id, first_name, last_name, organization_id')
              .eq('organization_id', currentOrganization.id)
              .in('id', sourcePlayerIds)
          : { data: [], error: null };

      if (playerResult.error) throw playerResult.error;
      if (latestRequestRef.current !== requestId) return;

      setCoaches(coachResult.data || []);
      setInterestedPrograms(interestResult.data || []);
      setDivisions(divisionResult.data || []);
      setPlayers(playerResult.data || []);
      setTeams(teamResult.data || []);
      setSelectedTeamByCoach((previous) => {
        const validTeamIds = new Set((teamResult.data || []).map((team) => String(team.id)));
        return Object.fromEntries(
          Object.entries(previous).filter(([, teamId]) => validTeamIds.has(String(teamId)))
        );
      });
    } catch (err) {
      if (latestRequestRef.current !== requestId) return;
      logger.error('Failed to load coaches:', err);
      setError('Failed to load coach records.');
    } finally {
      if (latestRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [currentOrganization?.id]);

  useEffect(() => {
    loadCoaches();
  }, [loadCoaches]);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    setMutationMessage(null);
    setSelectedTeamByCoach({});
  }, [currentOrganization?.id]);

  const rows = useMemo(
    () => buildCoachReviewRows({ coaches, interestedPrograms, divisions, players, teams }),
    [coaches, interestedPrograms, divisions, players, teams]
  );
  const summary = useMemo(() => summarizeCoachRows(rows), [rows]);
  const teamAssignmentOptions = useMemo(
    () => buildTeamAssignmentOptions({ teams, divisions }),
    [teams, divisions]
  );
  const filteredRows = useMemo(
    () =>
      filterCoachReviewRows(rows, {
        status: statusFilter,
        divisionId: divisionFilter,
        search: debouncedSearch,
      }),
    [rows, statusFilter, divisionFilter, debouncedSearch]
  );

  const runCoachMutation = useCallback(
    async ({ actionKey, successMessage, mutation }) => {
      if (!currentOrganization?.id || !canManageCoaches) return;

      setPendingAction(actionKey);
      setMutationMessage(null);
      setError(null);

      try {
        const { error: mutationError } = await mutation();
        if (mutationError) throw mutationError;
        setMutationMessage({ type: 'success', text: successMessage });
        await loadCoaches();
      } catch (err) {
        logger.error('Coach admin mutation failed:', err);
        setMutationMessage({
          type: 'error',
          text: err?.message || 'Coach action failed. Please try again.',
        });
      } finally {
        setPendingAction(null);
      }
    },
    [canManageCoaches, currentOrganization?.id, loadCoaches]
  );

  const handleStatusChange = useCallback(
    (coach, nextStatus) => {
      if (!nextStatus || nextStatus === coach.status) return;

      runCoachMutation({
        actionKey: `status:${coach.id}`,
        successMessage: `${coach.fullName} status updated to ${STATUS_LABELS[nextStatus] || nextStatus}.`,
        mutation: () =>
          supabase.rpc('admin_update_coach_status', {
            p_organization_id: currentOrganization.id,
            p_coach_id: coach.id,
            p_status: nextStatus,
          }),
      });
    },
    [currentOrganization?.id, runCoachMutation]
  );

  const handleAssignTeam = useCallback(
    (coach) => {
      const teamId = selectedTeamByCoach[coach.id];
      if (!teamId) return;

      runCoachMutation({
        actionKey: `assign:${coach.id}`,
        successMessage: `${coach.fullName} assigned to the selected team.`,
        mutation: async () => {
          const result = await supabase.rpc('admin_assign_team_coach', {
            p_organization_id: currentOrganization.id,
            p_team_id: teamId,
            p_coach_id: coach.id,
          });
          if (!result.error) {
            setSelectedTeamByCoach((previous) => {
              const next = { ...previous };
              delete next[coach.id];
              return next;
            });
          }
          return result;
        },
      });
    },
    [currentOrganization?.id, runCoachMutation, selectedTeamByCoach]
  );

  const handleUnassignTeam = useCallback(
    (team) => {
      runCoachMutation({
        actionKey: `unassign:${team.id}`,
        successMessage: `${team.name} no longer has an assigned coach.`,
        mutation: () =>
          supabase.rpc('admin_assign_team_coach', {
            p_organization_id: currentOrganization.id,
            p_team_id: team.id,
            p_coach_id: null,
          }),
      });
    },
    [currentOrganization?.id, runCoachMutation]
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-text-primary">Coaches</h1>
          <p className="text-text-secondary">
            Registered coaches and player-import volunteer leads.
          </p>
        </div>
        <button
          type="button"
          onClick={loadCoaches}
          disabled={loading}
          className="glass-button inline-flex items-center gap-2 px-4 py-2.5 disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div
          className="rounded-lg border border-status-error/30 bg-status-error-bg px-4 py-3 text-sm font-medium text-status-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {mutationMessage && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm font-medium ${
            mutationMessage.type === 'error'
              ? 'border-status-error/30 bg-status-error-bg text-status-error'
              : 'border-status-success/30 bg-status-success-bg text-status-success'
          }`}
          role={mutationMessage.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {mutationMessage.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CoachStat icon={Users} label="Total" value={summary.total} />
        <CoachStat icon={ShieldCheck} label="Registered" value={summary.registered} />
        <CoachStat icon={UserRoundCheck} label="Interested" value={summary.interested} />
        <CoachStat icon={Users} label="Unassigned" value={summary.unassigned} />
      </div>

      <div className="space-y-4 border-y border-border-subtle py-4">
        <div className="flex flex-wrap gap-2" aria-label="Coach status filter">
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatusFilter(filter.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-brand-400/50 bg-brand-glow text-brand-400'
                    : 'border-border-subtle bg-bg-surface text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_220px]">
          <label className="relative block">
            <span className="sr-only">Search coaches</span>
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search coaches, programs, teams"
              className="w-full rounded-lg border border-border-subtle bg-bg-surface py-2.5 pl-10 pr-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-brand-400/60"
            />
          </label>

          <label>
            <span className="sr-only">Filter by program</span>
            <select
              value={divisionFilter}
              onChange={(event) => setDivisionFilter(event.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-brand-400/60"
            >
              <option value="all">All programs</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-highlight bg-bg-surface">
        <table className="min-w-full divide-y divide-border-subtle">
          <thead className="bg-bg-surface">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-text-muted">
                Coach
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-text-muted">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-text-muted">
                Programs
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-text-muted">
                Teams
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-text-muted">
                Last Import
              </th>
              {canManageCoaches && (
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-text-muted">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {loading ? (
              <tr>
                <td
                  colSpan={canManageCoaches ? 6 : 5}
                  className="px-4 py-10 text-center text-sm text-text-secondary"
                >
                  Loading coaches...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={canManageCoaches ? 6 : 5}
                  className="px-4 py-10 text-center text-sm text-text-secondary"
                >
                  No coaches match the current filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((coach) => (
                <tr key={coach.id} className="hover:bg-bg-surface-hover/60">
                  <td className="px-4 py-4 align-top">
                    <div className="font-semibold text-text-primary">{coach.fullName}</div>
                    <div className="mt-1 flex flex-col gap-1 text-sm text-text-secondary">
                      {coach.email && (
                        <a
                          href={`mailto:${coach.email}`}
                          className="inline-flex items-center gap-1.5 hover:text-brand-400"
                        >
                          <Mail size={14} />
                          {coach.email}
                        </a>
                      )}
                      {coach.phone && (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone size={14} />
                          {coach.phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <StatusBadge status={coach.status} label={coach.statusLabel} />
                    {coach.canCoachMultipleTeams && (
                      <div className="mt-2 text-xs text-text-muted">Multiple teams allowed</div>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top text-sm text-text-secondary">
                    {coach.programNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {coach.programNames.map((program) => (
                          <span
                            key={program}
                            className="rounded-full border border-border-subtle bg-bg-surface px-2 py-1 text-xs text-text-secondary"
                          >
                            {program}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-muted">No lead programs</span>
                    )}
                    {coach.playerNames.length > 0 && (
                      <div className="mt-2 text-xs text-text-muted">
                        From {coach.playerNames.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top text-sm text-text-secondary">
                    {coach.teams.length > 0 ? (
                      <div className="space-y-1">
                        {coach.teams.map((team) => (
                          <div key={team.id} className="flex items-center gap-2">
                            <span>{team.name}</span>
                            {canManageCoaches && (
                              <button
                                type="button"
                                onClick={() => handleUnassignTeam(team)}
                                disabled={pendingAction === `unassign:${team.id}`}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-muted transition-colors hover:border-status-error/50 hover:text-status-error disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={`Unassign ${coach.fullName} from ${team.name}`}
                                title="Unassign coach"
                              >
                                <UserMinus size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-muted">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top text-sm text-text-secondary">
                    <div>{coach.lastImportedLabel}</div>
                    {coach.importSource && (
                      <div className="mt-1 text-xs text-text-muted">{coach.importSource}</div>
                    )}
                  </td>
                  {canManageCoaches && (
                    <td className="min-w-[260px] px-4 py-4 align-top">
                      <div className="space-y-3">
                        <label className="block">
                          <span className="sr-only">Status for {coach.fullName}</span>
                          <select
                            value={coach.status}
                            onChange={(event) => handleStatusChange(coach, event.target.value)}
                            disabled={pendingAction === `status:${coach.id}`}
                            className="w-full rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-brand-400/60 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Status for ${coach.fullName}`}
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option
                                key={status.id}
                                value={status.id}
                                disabled={!canSetCoachStatus(coach, status.id)}
                              >
                                {status.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                          <label className="block">
                            <span className="sr-only">Assign team to {coach.fullName}</span>
                            <select
                              value={selectedTeamByCoach[coach.id] || ''}
                              onChange={(event) =>
                                setSelectedTeamByCoach((previous) => ({
                                  ...previous,
                                  [coach.id]: event.target.value,
                                }))
                              }
                              disabled={!canAssignCoachToTeam(coach)}
                              className="w-full rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-brand-400/60 disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label={`Assign team to ${coach.fullName}`}
                            >
                              <option value="">Select team</option>
                              {teamAssignmentOptions.map((team) => (
                                <option key={team.value} value={team.value}>
                                  {team.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => handleAssignTeam(coach)}
                            disabled={
                              !canAssignCoachToTeam(coach) ||
                              !selectedTeamByCoach[coach.id] ||
                              pendingAction === `assign:${coach.id}`
                            }
                            className="inline-flex h-10 items-center gap-2 rounded-lg border border-brand-400/40 bg-brand-glow px-3 text-sm font-semibold text-brand-400 transition-colors hover:bg-brand-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`Assign selected team to ${coach.fullName}`}
                          >
                            <CheckCircle2 size={16} />
                            Assign
                          </button>
                        </div>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
