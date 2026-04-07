import React, { useState, useCallback } from 'react';
import PracticeReadinessPanel from '../components/PracticeReadinessPanel.jsx';
import PracticeOverridePanel from '../components/PracticeOverridePanel.jsx';
import PracticeAssignmentList from '../components/PracticeAssignmentList.jsx';
import AutoSchedulerPanel from '../components/scheduling/AutoSchedulerPanel.jsx';
import { useDashboardData } from '../hooks/useDashboardData.js';
import { usePracticeAssignments } from '../hooks/usePracticeAssignments.js';
import { useAutoScheduler } from '../hooks/useAutoScheduler.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import Button from '../components/ui/Button.jsx';
import { Edit2, Save } from 'lucide-react';
import EvaluationPanel from '../components/EvaluationPanel.jsx';
import { supabase } from '../lib/supabaseClient.js';

export default function PracticeSchedulingPage() {
  const { practice, team, loading: dashboardLoading } = useDashboardData();
  const {
    assignments,
    loading: assignmentsLoading,
    updateAssignmentSource,
  } = usePracticeAssignments(practice.runId);
  const { timezone } = useTheme();
  const { currentOrganization } = useOrganization();
  const [isEditMode, setIsEditMode] = useState(false);

  const {
    trigger: triggerAutoScheduler,
    cancel: cancelAutoScheduler,
    status: autoSchedulerStatus,
    result: autoSchedulerResult,
    error: autoSchedulerError,
    progress: autoSchedulerProgress,
    reset: resetAutoScheduler,
  } = useAutoScheduler({ organizationId: currentOrganization?.id });

  const handleAutoGenerate = useCallback(() => {
    const lockedAssignments = (assignments ?? [])
      .filter((a) => a.source === 'manual' || a.source === 'locked')
      .map((a) => ({ teamId: a.teamId, slotId: a.slotId }));

    triggerAutoScheduler({
      teams: team?.teams || [],
      slots: practice.snapshot?.baseSlotDistribution || [],
      lockedAssignments,
      schoolDayEnd: practice.snapshot?.schoolDayEnd,
      timezone,
    });
  }, [assignments, team, practice, timezone, triggerAutoScheduler]);

  // Use optimized assignments if auto-scheduler completed, otherwise use current
  const displayAssignments =
    autoSchedulerStatus === 'completed' && autoSchedulerResult?.assignments
      ? autoSchedulerResult.assignments
      : assignments;

  return (
    <div className="animate-fadeIn space-y-8">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Practice Scheduling</h1>
          <p className="text-white/60">
            Generate and review practice schedules based on field availability.
          </p>
        </div>
        <Button
          variant={isEditMode ? 'primary' : 'secondary'}
          onClick={() => setIsEditMode(!isEditMode)}
          className="flex items-center gap-2"
        >
          {isEditMode ? <Save size={18} /> : <Edit2 size={18} />}
          {isEditMode ? 'Done Overrides' : 'Manual Overrides'}
        </Button>
      </div>

      {!isEditMode && (
        <div className="space-y-6">
          <AutoSchedulerPanel
            status={autoSchedulerStatus}
            progress={autoSchedulerProgress}
            result={autoSchedulerResult}
            error={autoSchedulerError}
            onTrigger={handleAutoGenerate}
            onCancel={cancelAutoScheduler}
            onReset={resetAutoScheduler}
            disabled={dashboardLoading.practice || !team?.teams?.length}
          />

          <EvaluationPanel
            practiceData={{
              assignments: displayAssignments,
              teams: team?.teams || [],
              slots: practice.snapshot?.baseSlotDistribution || [],
              unassigned: practice.snapshot?.unassignedByReason || [],
            }}
            supabaseClient={supabase}
          />

          <PracticeReadinessPanel
            practiceReadinessSnapshot={practice.snapshot}
            practiceSummary={practice.summary}
            generatedAt={practice.generatedAt}
            timezone={timezone}
            scheduleEvaluation={practice.scheduleEvaluation}
          />
        </div>
      )}

      {isEditMode ? (
        <PracticeOverridePanel
          teams={team?.teams || []}
          baseSlots={practice.snapshot?.baseSlotDistribution || []}
        />
      ) : (
        <PracticeAssignmentList
          assignments={displayAssignments}
          loading={dashboardLoading.practice || assignmentsLoading}
          onToggleLock={updateAssignmentSource}
        />
      )}
    </div>
  );
}
