import { describe, it, expect } from 'vitest';
import { makeSchedulerRun, makeEvaluationRun, makeEvaluationFinding } from '../run.js';

describe('makeSchedulerRun', () => {
  it('returns deterministic defaults with no args', () => {
    const r = makeSchedulerRun();
    expect(r.id).toBe('run-1');
    expect(r.season_settings_id).toBe(1);
    expect(r.run_type).toBe('team');
    expect(r.status).toBe('completed');
    expect(r.parameters).toEqual({});
    expect(r.metrics).toEqual({});
    expect(r.results).toEqual({});
  });

  it('merges overrides, with override keys winning', () => {
    const r = makeSchedulerRun({ run_type: 'practice', status: 'running' });
    expect(r.run_type).toBe('practice');
    expect(r.status).toBe('running');
    expect(r.id).toBe('run-1');
  });

  it('respects explicit undefined overrides', () => {
    const r = makeSchedulerRun({ status: undefined });
    expect(r.status).toBeUndefined();
  });
});

describe('makeEvaluationRun', () => {
  it('returns deterministic defaults with no args', () => {
    const e = makeEvaluationRun();
    expect(e.id).toBe('eval-1');
    expect(e.scheduler_run_type).toBe('team');
    expect(e.scheduler_run_id).toBe('run-1');
    expect(e.status).toBe('completed');
    expect(e.findings_severity).toBe('none');
    expect(e.metrics_summary).toEqual({});
    expect(e.input_snapshot).toEqual({});
    expect(e.auto_fix_summary).toEqual({});
  });

  it('merges overrides, with override keys winning', () => {
    const e = makeEvaluationRun({ status: 'failed', findings_severity: 'errors' });
    expect(e.status).toBe('failed');
    expect(e.findings_severity).toBe('errors');
    expect(e.scheduler_run_type).toBe('team');
  });

  it('respects explicit undefined overrides', () => {
    const e = makeEvaluationRun({ status: undefined });
    expect(e.status).toBeUndefined();
  });
});

describe('makeEvaluationFinding', () => {
  it('returns deterministic defaults with no args', () => {
    expect(makeEvaluationFinding()).toEqual({
      id: 1,
      evaluation_run_id: 'eval-1',
      severity: 'info',
      finding_code: 'TEST_FINDING',
      description: 'Test finding',
      affected_entities: [],
      auto_fix_applied: false,
      created_at: '2026-01-01T00:00:00Z',
    });
  });

  it('merges overrides, with override keys winning', () => {
    const f = makeEvaluationFinding({ severity: 'error', finding_code: 'RLS_LEAK' });
    expect(f.severity).toBe('error');
    expect(f.finding_code).toBe('RLS_LEAK');
    expect(f.description).toBe('Test finding');
  });

  it('respects explicit undefined overrides', () => {
    const f = makeEvaluationFinding({ severity: undefined });
    expect(f.severity).toBeUndefined();
  });
});
