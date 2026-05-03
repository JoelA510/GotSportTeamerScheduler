export function scopeSchedulerRunsToActiveSeason(query, seasonSettingId) {
  if (!seasonSettingId) return query;
  return query.or(`season_settings_id.eq.${seasonSettingId},season_id.eq.${seasonSettingId}`);
}
