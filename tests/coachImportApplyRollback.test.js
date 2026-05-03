import { beforeEach, describe, expect, it } from 'vitest';
import { getMockData, mockSupabase as supabase } from '../frontend/src/lib/mockSupabaseClient.js';

describe('mock coach import apply and rollback', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.__MOCK_DB__ = undefined;
  });

  it('stages coach validation rows, applies them, and rolls them back', async () => {
    const { data: job } = await supabase
      .from('import_jobs')
      .insert({
        id: 'mock-coach-import-job',
        created_by: 'mock-admin-id',
        organization_id: 'org-1',
        job_type: 'registration',
        storage_path: 'imports/mock-admin-id/coaches.csv',
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
          import_type: 'coaches',
          organization_id: 'org-1',
          rows: [
            {
              full_name: 'CSV Coach',
              email: 'csvcoach@example.com',
              phone: '555-1212',
            },
          ],
          file_name: 'coaches.csv',
          import_job_id: jobId,
          row_offset: 0,
        },
      }
    );

    expect(validationError).toBeNull();
    expect(validationResult.staged_rows).toBe(1);
    expect(getMockData('staging_import_rows', 'import_job_id', jobId)).toHaveLength(1);

    const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
      'finalize_coach_import_job',
      {
        p_import_job_id: jobId,
        p_validation_errors: [],
      }
    );

    expect(finalizeError).toBeNull();
    expect(finalizeResult.inserted_coaches).toBe(1);
    expect(getMockData('coaches').some((coach) => coach.email === 'csvcoach@example.com')).toBe(
      true
    );

    const { data: rollbackResult, error: rollbackError } = await supabase.rpc(
      'rollback_coach_import_job',
      { p_import_job_id: jobId }
    );

    expect(rollbackError).toBeNull();
    expect(rollbackResult.deleted_coaches).toBe(1);
    expect(getMockData('coaches').some((coach) => coach.email === 'csvcoach@example.com')).toBe(
      false
    );
  });
});
