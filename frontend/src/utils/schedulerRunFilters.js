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
