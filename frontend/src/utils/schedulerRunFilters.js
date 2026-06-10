export function scopeSchedulerRunsToActiveSeason(query, seasonSettingId) {
  if (!seasonSettingId) return query;
  return query.or(`season_settings_id.eq.${seasonSettingId},season_id.eq.${seasonSettingId}`);
}

/**
 * Build a division → `{ teamRows, teamPlayerRows }` map from scheduler runs (ordered newest →
 * oldest), where the newest run that contains a division wins. Each team run persists a single
 * division, and the persistence hook only surfaces the single most-recent run as its global
 * `payload`; this lets a re-run of ANY previously-persisted division — not just the most-recently
 * persisted one — still find its teams to preserve, instead of silently regenerating fresh and
 * dropping that division's team UUIDs / manual roster moves.
 *
 * Pure — no React / Supabase imports.
 *
 * @param {Array<{ results?: { teams?: any[], team_players?: any[] } }>} runs
 * @returns {Record<string, { teamRows: any[], teamPlayerRows: any[] }>}
 */
export function buildPayloadByDivision(runs) {
  /** @type {Record<string, { teamRows: any[], teamPlayerRows: any[] }>} */
  const byDivision = {};
  for (const run of Array.isArray(runs) ? runs : []) {
    const teams = run?.results?.teams || [];
    const teamPlayers = run?.results?.team_players || [];
    for (const team of teams) {
      const division = String(team?.division ?? team?.division_id ?? 'unknown');
      if (byDivision[division]) continue; // a newer run already owns this division
      const divisionTeams = teams.filter(
        (t) => String(t?.division ?? t?.division_id ?? 'unknown') === division
      );
      const divisionTeamIds = new Set(divisionTeams.map((t) => t?.id).filter((id) => id != null));
      byDivision[division] = {
        teamRows: divisionTeams,
        teamPlayerRows: teamPlayers.filter((row) => divisionTeamIds.has(row?.team_id)),
      };
    }
  }
  return byDivision;
}

/**
 * Resolve a scheduler run's division key the way `get_latest_team_runs_per_division` does:
 * a non-empty `parameters.selectedProgramId`, else the first persisted team carrying a non-empty
 * `division` / `division_id`. Returns `null` when nothing resolves. Pure.
 *
 * @param {{ parameters?: any, results?: { teams?: any[] } }} run
 * @returns {string | null}
 */
export function resolveTeamRunDivision(run) {
  const selected = run?.parameters?.selectedProgramId;
  if (typeof selected === 'string' && selected.trim() !== '') return selected;
  for (const team of run?.results?.teams ?? []) {
    const division = team?.division ?? team?.division_id;
    if (division != null && String(division).trim() !== '') return String(division);
  }
  return null;
}

/**
 * Pure JS mirror of the `get_latest_team_runs_per_division` RPC, used by the mock Supabase client
 * and the round-trip tests so all three (SQL, mock, test) encode ONE contract: the single newest
 * team run per division, newest-first. Runs without a persisted team array are skipped (a
 * failed/queued attempt must never shadow an older completed snapshot). Pure.
 *
 * @param {Array<{ id?: string, status?: string, parameters?: any, results?: any, created_at?: string }>} runs
 * @returns {Array<{ id: any, status: any, division: string, parameters: any, results: any, created_at: any }>}
 */
export function selectLatestTeamRunsPerDivision(runs) {
  const sorted = [...(Array.isArray(runs) ? runs : [])].sort((a, b) =>
    String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? ''))
  );
  const byDivision = new Map();
  for (const run of sorted) {
    const teams = run?.results?.teams;
    if (!Array.isArray(teams) || teams.length === 0) continue; // no snapshot to seed a re-run
    const division = resolveTeamRunDivision(run);
    if (division == null || byDivision.has(division)) continue; // newest already won this division
    byDivision.set(division, {
      id: run.id,
      status: run.status,
      division,
      parameters: run.parameters ?? {},
      results: run.results ?? {},
      created_at: run.created_at,
    });
  }
  return [...byDivision.values()];
}
