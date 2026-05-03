import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mail, Phone, RefreshCw, Search, ShieldCheck, UserRoundCheck, Users } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
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
  const latestRequestRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [interestedPrograms, setInterestedPrograms] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

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

  const rows = useMemo(
    () => buildCoachReviewRows({ coaches, interestedPrograms, divisions, players, teams }),
    [coaches, interestedPrograms, divisions, players, teams]
  );
  const summary = useMemo(() => summarizeCoachRows(rows), [rows]);
  const filteredRows = useMemo(
    () =>
      filterCoachReviewRows(rows, {
        status: statusFilter,
        divisionId: divisionFilter,
        search: debouncedSearch,
      }),
    [rows, statusFilter, divisionFilter, debouncedSearch]
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
          <thead className="bg-bg-card">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-text-secondary">
                  Loading coaches...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-text-secondary">
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
                            className="rounded-full border border-border-subtle bg-bg-card px-2 py-1 text-xs text-text-secondary"
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
                          <div key={team.id}>{team.name}</div>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
