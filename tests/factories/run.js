export function makeSchedulerRun(overrides = {}) {
  return {
    id: 'run-1',
    season_settings_id: 1,
    run_type: 'team',
    status: 'completed',
    parameters: {},
    metrics: {},
    results: {},
    created_by: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeEvaluationRun(overrides = {}) {
  return {
    id: 'eval-1',
    scheduler_run_type: 'team',
    scheduler_run_id: 'run-1',
    season_settings_id: 1,
    status: 'completed',
    findings_severity: 'none',
    metrics_summary: {},
    input_snapshot: {},
    auto_fix_summary: {},
    created_by: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeEvaluationFinding(overrides = {}) {
  return {
    id: 1,
    evaluation_run_id: 'eval-1',
    severity: 'info',
    finding_code: 'TEST_FINDING',
    description: 'Test finding',
    affected_entities: [],
    auto_fix_applied: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
