import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { ScoringInputSchema } from '../_shared/schemas/scoring.ts';
import {
  evaluatePracticeSchedule,
  evaluateGameSchedule,
  EvaluationResult,
} from '../_shared/engines/scoring-engine.ts';
import {
  getUserFromRequest,
  getUserOrgIds,
  corsHeaders,
  jsonResponse,
  recordAudit,
} from '../_shared/auth.ts';

serve(async (req) => {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 2. Auth & Organization Scoping
    const user = await getUserFromRequest(req, supabase);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const orgIds = await getUserOrgIds(supabase, user.id);
    if (orgIds.length === 0) {
      return jsonResponse({ error: 'User is not a member of any organization' }, 403);
    }
    const organizationId = orgIds[0];

    // 3. Payload Validation (Zod)
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parseResult = ScoringInputSchema.safeParse(body);
    if (!parseResult.success) {
      return jsonResponse(
        {
          error: 'Validation failed',
          details: parseResult.error.format(),
        },
        400
      );
    }

    const { practice, games, persist = false, metadata = {} } = parseResult.data;

    // 4. Heavy Computation (Isomorphic Scoring Engine)
    const startTime = performance.now();

    // Task 1 Refinement: Pass as single objects
    const practiceResults = practice
      ? evaluatePracticeSchedule({
          assignments: practice.assignments,
          teams: practice.teams,
          slots: practice.slots,
          unassigned: practice.unassigned,
        })
      : null;

    const gameResults = games
      ? evaluateGameSchedule({
          assignments: games.games,
          teams: games.teams,
        })
      : null;

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    // 5. Result Aggregation
    const finalStatus =
      practiceResults?.status === 'action-required' || gameResults?.status === 'action-required'
        ? 'action-required'
        : practiceResults?.status === 'attention-needed' ||
            gameResults?.status === 'attention-needed'
          ? 'attention-needed'
          : 'ok';

    const allIssues = [...(practiceResults?.issues ?? []), ...(gameResults?.issues ?? [])];

    // Fairness Index Calculation (Composite)
    const practiceFairness = practiceResults?.summary?.fairnessScore ?? 1.0;
    const gameFairness = gameResults?.summary?.coveragePercent
      ? gameResults.summary.coveragePercent / 100
      : 1.0;
    const combinedScore = (practiceFairness + gameFairness) / 2;

    const evaluationPayload: EvaluationResult = {
      status: finalStatus,
      issues: allIssues,
      practice: practiceResults,
      games: gameResults,
      metrics: {
        fairnessScore: practiceFairness,
        combinedScore: combinedScore,
        executionTimeMs: durationMs,
      },
    };

    // 6. Atomic RPC Persistence & Real-time Update
    let runId = null;
    if (persist) {
      const runData = {
        organization_id: organizationId,
        admin_id: user.id, // Explicitly captured for audit
        execution_time_ms: durationMs, // Performance optimization metric
        scheduler_run_id: metadata.schedulerRunId,
        scheduler_run_type: practice && games ? 'composite' : practice ? 'practice' : 'game',
        season_settings_id: metadata.seasonSettingsId,
        status: finalStatus === 'ok' ? 'completed' : 'completed_with_warnings',
        findings_severity:
          finalStatus === 'action-required'
            ? 'errors'
            : finalStatus === 'attention-needed'
              ? 'warnings'
              : 'none',
        metrics_summary: {
          issueCount: allIssues.length,
          errorCount: allIssues.filter((i) => i.severity === 'error').length,
          warningCount: allIssues.filter((i) => i.severity === 'warning').length,
          practiceUnassigned: practiceResults?.summary?.unassignedTeams ?? 0,
          performanceMs: durationMs,
          fairness_index: combinedScore,
        },
        input_snapshot: {
          hasPractice: !!practice,
          hasGames: !!games,
          teamCount: Math.max(practice?.teams?.length ?? 0, games?.teams?.length ?? 0),
        },
        created_by: user.id,
        started_at: new Date(startTime).toISOString(), // Roughly
        completed_at: new Date().toISOString(),
      };

      const findings = allIssues.map((issue) => ({
        severity:
          issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info',
        finding_code: issue.category,
        description: issue.message,
        affected_entities: issue.details ? [issue.details] : [],
      }));

      const metrics = [
        {
          metric_key: 'combined_fairness_index',
          metric_value: combinedScore,
          thresholds: { min: 0.8, target: 0.95 },
        },
        {
          metric_key: 'execution_latency',
          metric_value: durationMs,
          thresholds: { max: 500, target: 100 },
        },
      ];

      if (practiceResults) {
        metrics.push({
          metric_key: 'practice_coverage',
          metric_value: practiceResults.summary.coveragePercent,
          thresholds: { min: 90, target: 100 },
        });
      }

      const { data: id, error: persistError } = await supabase.rpc('persist_evaluation_run', {
        p_run_data: runData,
        p_findings: findings,
        p_metrics: metrics,
      });

      if (persistError) {
        throw new Error(`Persistence failed: ${persistError.message}`);
      }
      runId = id;

      // 7. Audit Log (C-1)
      await recordAudit(supabase, {
        organizationId,
        action: 'evaluation.run',
        resourceType: 'evaluation_run',
        resourceId: runId,
        metadata: {
          status: finalStatus,
          issue_count: allIssues.length,
          execution_time_ms: durationMs,
        },
      });
    }

    return jsonResponse({
      ...evaluationPayload,
      runId,
      metadata: {
        ...metadata,
        engineVersion: '2.5.0-composite',
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Scoring error:', err);
    return jsonResponse(
      {
        error: 'Engine failure',
        message: (err as Error).message,
      },
      500
    );
  }
});
