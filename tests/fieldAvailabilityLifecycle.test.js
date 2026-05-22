import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase as supabase, getMockData } from '../frontend/src/lib/mockSupabaseClient.js';
import { finalizeDeferredImportJob } from '../frontend/src/utils/importDeferredActions.js';

describe('field availability lifecycle', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.__MOCK_DB__ = undefined;
  });

  it('create_import_job sets field_availability job_type', async () => {
    const { data, error } = await supabase.rpc('create_import_job', {
      p_organization_id: 'org-1',
      p_import_type: 'field_availability',
      p_file_name: 'fa.csv',
    });
    expect(error).toBeNull();
    expect(data.job_type).toBe('field_availability');
  });

  it('invalid seasonal rows produce warnings and do not create slots', async () => {
    const basePractice = getMockData('practice_slots').length;
    const baseGame = getMockData('game_slots').length;
    const { data: job } = await supabase.rpc('create_import_job', { p_organization_id: 'org-1', p_import_type: 'field_availability', p_file_name: 'invalid-fa.csv' });
    await supabase.from('staging_import_rows').insert({
      id: 'row-invalid', import_job_id: job.id, organization_id: 'org-1', import_type: 'field_availability', raw_payload: {},
      normalized_payload: { season_label: 'Fall 2026', location: '', field_name: 'Bad', available_from: '2026-11-30', available_until: '2026-08-01', teams_per_hour: '0' },
      validation_errors: [],
    });
    const res = await supabase.rpc('finalize_field_availability_import_job', { p_import_job_id: job.id, p_validation_errors: [] });
    expect(res.error).toBeNull();
    expect(res.data.status).toBe('completed_with_warnings');
    expect(res.data.invalid_rows).toBeGreaterThan(0);
    expect(getMockData('practice_slots').length).toBe(basePractice);
    expect(getMockData('game_slots').length).toBe(baseGame);
  });

  it('deferred apply routes to finalize_field_availability_import_job and rollback rpc works', async () => {
    const { data: job } = await supabase.rpc('create_import_job', {
      p_organization_id: 'org-1', p_import_type: 'field_availability', p_file_name: 'fa.csv',
    });
    await supabase.from('staging_import_rows').insert({
      id: 'row1', import_job_id: job.id, organization_id: 'org-1', import_type: 'field_availability', raw_payload: {},
      normalized_payload: {
        season_label: 'Fall 2026', location: 'San Lorenzo', field_name: 'Main', available_from: '2026-08-01', available_until: '2026-10-31',
        primary_format: '11v11', secondary_format: '9v9', format_quantity: '1', blackout_months: 'Sept',
        goal_equipment: 'sturdy goals', goal_status: 'needs purchase', scenario_name: 'Canyon A', scenario_group: 'canyon'
      },
      validation_errors: [],
    });
    await supabase.rpc('mark_import_job_ready_to_apply', { p_import_job_id: job.id, p_import_type: 'field_availability', p_validation_errors: [] });
    const result = await finalizeDeferredImportJob({ supabase, type: 'field_availability', importJobId: job.id, validationErrors: [] });
    expect(result.inserted_profiles).toBe(1);

    const profile = getMockData('field_availability_profiles')[0];
    expect(profile).toBeTruthy();
    expect(getMockData('field_blackout_windows').some((b) => b.profile_id === profile.id && b.blackout_from === '2026-09-01')).toBe(true);

    const rb = await supabase.rpc('rollback_field_availability_import_job', { p_import_job_id: job.id });
    expect(rb.error).toBeNull();
    expect(getMockData('field_availability_profiles').length).toBe(0);
    expect(getMockData('field_availability_profile_formats').length).toBe(0);
    expect(getMockData('field_blackout_windows').length).toBe(0);
    expect(getMockData('field_equipment_requirements').length).toBe(0);
    expect(getMockData('field_availability_scenario_members').length).toBe(0);
  });

  it('deferred cancel works for field_availability', async () => {
    const { data: job } = await supabase.rpc('create_import_job', {
      p_organization_id: 'org-1', p_import_type: 'field_availability', p_file_name: 'cancel-fa.csv',
    });
    await supabase.from('staging_import_rows').insert({
      id: 'row-cancel', import_job_id: job.id, organization_id: 'org-1', import_type: 'field_availability', raw_payload: {},
      normalized_payload: { season_label: 'Fall 2026', location: 'Five Canyons', field_name: 'Upper', available_from: '2026-09-01', available_until: '2026-11-30' },
      validation_errors: [],
    });
    const ready = await supabase.rpc('mark_import_job_ready_to_apply', { p_import_job_id: job.id, p_import_type: 'field_availability', p_validation_errors: [] });
    expect(ready.error).toBeNull();
    const canceled = await supabase.rpc('cancel_ready_import_job', { p_import_job_id: job.id, p_import_type: 'field_availability' });
    expect(canceled.error).toBeNull();
    expect(canceled.data.status).toBe('canceled');
  });

  it('blackout month parsing supports Aug/Sep/Oct/Nov tokens', async () => {
    const { data: job } = await supabase.rpc('create_import_job', {
      p_organization_id: 'org-1', p_import_type: 'field_availability', p_file_name: 'months.csv',
    });
    await supabase.from('staging_import_rows').insert({
      id: 'row-months', import_job_id: job.id, organization_id: 'org-1', import_type: 'field_availability', raw_payload: {},
      normalized_payload: { season_label: 'Fall 2026', location: 'San Lorenzo', field_name: 'Main', available_from: '2026-08-01', available_until: '2026-11-30', blackout_months: 'Aug, Sept, Oct, Nov' },
      validation_errors: [],
    });
    await supabase.rpc('finalize_field_availability_import_job', { p_import_job_id: job.id, p_validation_errors: [] });
    const wins = getMockData('field_blackout_windows').map((w) => [w.blackout_from, w.blackout_until]);
    expect(wins).toContainEqual(['2026-08-01', '2026-08-31']);
    expect(wins).toContainEqual(['2026-09-01', '2026-09-30']);
    expect(wins).toContainEqual(['2026-10-01', '2026-10-31']);
    expect(wins).toContainEqual(['2026-11-01', '2026-11-30']);
  });
});
