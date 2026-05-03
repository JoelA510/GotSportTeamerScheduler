import { beforeEach, describe, expect, it } from 'vitest';
import { getMockData, mockSupabase as supabase } from '../frontend/src/lib/mockSupabaseClient.js';

describe('mock field import apply and rollback', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.__MOCK_DB__ = undefined;
  });

  it('stages field slot rows, applies them, and rolls them back', async () => {
    const { data: job } = await supabase
      .from('import_jobs')
      .insert({
        id: 'mock-field-import-job',
        created_by: 'mock-admin-id',
        organization_id: 'org-1',
        job_type: 'fields',
        storage_path: 'imports/mock-admin-id/fields.csv',
        status: 'importing',
        total_rows: 1,
        processed_rows: 0,
        progress_percent: 0,
      })
      .select();
    const jobId = job.id;

    const { data: validationResult, error: validationError } = await supabase.functions.invoke(
      'import-validation',
      {
        body: {
          import_type: 'fields',
          organization_id: 'org-1',
          rows: [
            {
              Location: 'Main Park',
              Field: 'Imported Field',
              Subunit: 'A',
              Type: 'practice',
              Day: 'Mon',
              Start: '17:30',
              End: '18:30',
              Capacity: '1',
              'Valid From': '2026-03-01',
              'Valid Until': '2026-05-31',
            },
          ],
          file_name: 'fields.csv',
          import_job_id: jobId,
          row_offset: 0,
        },
      }
    );

    expect(validationError).toBeNull();
    expect(validationResult.staged_rows).toBe(1);
    expect(getMockData('staging_import_rows', 'import_job_id', jobId)).toHaveLength(1);

    const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
      'finalize_field_import_job',
      {
        p_import_job_id: jobId,
        p_validation_errors: [],
      }
    );

    expect(finalizeError).toBeNull();
    expect(finalizeResult.inserted_fields).toBe(1);
    expect(finalizeResult.inserted_practice_slots).toBe(1);
    expect(getMockData('fields').some((field) => field.name === 'Imported Field')).toBe(true);
    expect(getMockData('practice_slots').some((slot) => slot.start_time === '17:30')).toBe(true);

    const { data: rollbackResult, error: rollbackError } = await supabase.rpc(
      'rollback_field_import_job',
      { p_import_job_id: jobId }
    );

    expect(rollbackError).toBeNull();
    expect(rollbackResult.deleted_fields).toBe(1);
    expect(rollbackResult.deleted_practice_slots).toBe(1);
    expect(getMockData('fields').some((field) => field.name === 'Imported Field')).toBe(false);
  });
});
