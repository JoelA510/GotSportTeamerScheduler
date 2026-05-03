import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDashboardData } from '../hooks/useDashboardData.js';
import PracticeAssignmentList from '../components/PracticeAssignmentList.jsx';
import PracticeOverridePanel from '../components/PracticeOverridePanel.jsx';
import AutoSchedulerPanel from '../components/scheduling/AutoSchedulerPanel.jsx';
import PracticeReadinessPanel from '../components/PracticeReadinessPanel.jsx';
import Button from '../components/ui/Button.jsx';
import { Edit2, Save, Sparkles, Calendar } from 'lucide-react';
import EvaluationPanel from '../components/EvaluationPanel.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { PERMISSIONS } from '../constants/permissions.js';

export default function PracticeSchedulingPage() {
  const { practice, team, loading: dashboardLoading } = useDashboardData();
  const { permissions = [] } = useOrganization();
  const [assignments, setAssignments] = useState(practice?.assignments ?? []);
  const [isEditMode, setIsEditMode] = useState(false);
  const [assignmentSaveError, setAssignmentSaveError] = useState(null);
  const canManageSchedule =
    permissions.includes(PERMISSIONS.MANAGE_SCHEDULE) ||
    permissions.includes(PERMISSIONS.MANAGE_ORGANIZATION);
  const canEditSchedule = canManageSchedule && isEditMode;

  // Auto-scheduler status
  const [autoSchedulerStatus, setAutoSchedulerStatus] = useState('idle');
  const [autoSchedulerProgress, setAutoSchedulerProgress] = useState(0);
  const [autoSchedulerResult, setAutoSchedulerResult] = useState(null);
  const [autoSchedulerError, setAutoSchedulerError] = useState(null);
  const autoSchedulerIntervalRef = useRef(null);
  const autoSchedulerTimeoutRef = useRef(null);

  useEffect(() => {
    if (practice?.assignments) {
      setAssignments(practice.assignments);
    }
    // Depend on stable signals — useDashboardData returns a fresh `practice` object
    // every render, so `[practice?.assignments]` alone would loop.
  }, [practice?.assignments?.length, practice?.snapshot?.lastCalculated]);

  // Ensure simulation timers can't outlive the component.
  useEffect(() => {
    return () => {
      if (autoSchedulerIntervalRef.current) clearInterval(autoSchedulerIntervalRef.current);
      if (autoSchedulerTimeoutRef.current) clearTimeout(autoSchedulerTimeoutRef.current);
      autoSchedulerIntervalRef.current = null;
      autoSchedulerTimeoutRef.current = null;
    };
  }, []);

  const stopAutoSchedulerTimers = useCallback(() => {
    if (autoSchedulerIntervalRef.current) {
      clearInterval(autoSchedulerIntervalRef.current);
      autoSchedulerIntervalRef.current = null;
    }
    if (autoSchedulerTimeoutRef.current) {
      clearTimeout(autoSchedulerTimeoutRef.current);
      autoSchedulerTimeoutRef.current = null;
    }
  }, []);

  // Handle auto-scheduler trigger
  const handleAutoGenerate = useCallback(async () => {
    if (!canManageSchedule) return;

    stopAutoSchedulerTimers();
    setAutoSchedulerStatus('running');
    setAutoSchedulerProgress(0);
    setAutoSchedulerError(null);

    try {
      // Ensure we have a signed-in session before kicking off the mock progress loop.
      await supabase.auth.getUser();
      const testWindow =
        typeof window !== 'undefined'
          ? /** @type {Window & { __SQUADLOGIC_E2E_AUTO_SCHEDULER_ERROR__?: boolean }} */ (window)
          : null;
      if (testWindow?.__SQUADLOGIC_E2E_AUTO_SCHEDULER_ERROR__) {
        throw new Error('Auto-scheduler service unavailable');
      }

      // Mock call to edge function (scheduling-engine).
      // In production this would be: await supabase.functions.invoke('schedule-practices', { body: { teamId: team.id } });
      autoSchedulerIntervalRef.current = setInterval(() => {
        setAutoSchedulerProgress((prev) => {
          if (prev >= 100) {
            if (autoSchedulerIntervalRef.current) {
              clearInterval(autoSchedulerIntervalRef.current);
              autoSchedulerIntervalRef.current = null;
            }
            return 100;
          }
          return prev + 5;
        });
      }, 100);

      // Simulate network delay and processing
      autoSchedulerTimeoutRef.current = setTimeout(() => {
        stopAutoSchedulerTimers();
        setAutoSchedulerProgress(100);
        setAutoSchedulerStatus('completed');
        setAutoSchedulerResult({
          assignments: assignments, // Mocking unchanged for now
          summary: { conflictFree: 100, fieldUtilization: 88 },
        });
      }, 3000);
    } catch (err) {
      stopAutoSchedulerTimers();
      setAutoSchedulerStatus('failed');
      setAutoSchedulerError(err.message);
    }
  }, [assignments, canManageSchedule, stopAutoSchedulerTimers]);

  const cancelAutoScheduler = useCallback(() => {
    stopAutoSchedulerTimers();
    setAutoSchedulerStatus('idle');
    setAutoSchedulerProgress(0);
  }, [stopAutoSchedulerTimers]);

  const resetAutoScheduler = useCallback(() => {
    stopAutoSchedulerTimers();
    setAutoSchedulerStatus('idle');
    setAutoSchedulerResult(null);
  }, [stopAutoSchedulerTimers]);

  const localAssignments =
    autoSchedulerStatus === 'completed' && autoSchedulerResult
      ? autoSchedulerResult.assignments
      : assignments;

  const isColdStart = !team?.teams?.length;
  const overrideTeams = team?.teams ?? [];
  const overrideBaseSlots = practice?.snapshot?.baseSlotDistribution ?? [];

  const handleToggleLock = useCallback(
    async (assignmentId, nextSource) => {
      if (!canManageSchedule) return;

      const previousAssignments = assignments;
      setAssignmentSaveError(null);
      setAssignments((current) =>
        current.map((a) => (a.id === assignmentId ? { ...a, source: nextSource } : a))
      );
      const { error } = await supabase
        .from('practice_assignments')
        .update({ source: nextSource })
        .eq('id', assignmentId);
      if (error) {
        console.error('Failed to persist practice lock state:', error);
        setAssignments(previousAssignments);
        setAssignmentSaveError('Practice lock change could not be saved. Please retry.');
      }
    },
    [assignments, canManageSchedule]
  );

  return (
    <div className="animate-fadeIn space-y-8 max-w-[65ch] mx-auto w-full">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Practice Scheduling</h1>
          <p className="text-white/60">Configure and optimize team field assignments.</p>
        </div>
        {canManageSchedule && (
          <div className="flex gap-3">
            <Button
              variant={canEditSchedule ? 'primary' : 'secondary'}
              onClick={() => setIsEditMode(!isEditMode)}
              className="flex items-center gap-2"
            >
              {canEditSchedule ? <Save size={18} /> : <Edit2 size={18} />}
              {canEditSchedule ? 'Save Assignments' : 'Enter Manual Override'}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <AutoSchedulerPanel
            status={autoSchedulerStatus}
            progress={autoSchedulerProgress}
            result={autoSchedulerResult}
            error={autoSchedulerError}
            onTrigger={handleAutoGenerate}
            onCancel={cancelAutoScheduler}
            onReset={resetAutoScheduler}
            disabled={dashboardLoading.practice || isColdStart || !canManageSchedule}
          />

          {isColdStart && (
            <div className="glass-panel p-12 text-center animate-fadeIn border-brand-400/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                <Calendar size={120} className="text-brand-400" />
              </div>
              <div className="max-w-md mx-auto relative z-10">
                <h2 className="text-2xl font-display font-bold text-white mb-4">
                  Ready to Schedule Practices?
                </h2>
                <p className="text-white/60 mb-8">
                  You haven&apos;t generated any teams yet. Practice scheduling requires assigned
                  teams to calculate field availability and distribution.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    variant="primary"
                    size="lg"
                    className="flex items-center gap-2 mx-auto"
                    onClick={() => (window.location.hash = '#/teaming')}
                  >
                    Go to Team Generation <Sparkles size={18} />
                  </Button>
                </div>
              </div>
            </div>
          )}

          <EvaluationPanel
            practiceData={{
              assignments: localAssignments,
            }}
          />

          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden shadow-2xl backdrop-blur-sm mt-8">
            {assignmentSaveError && (
              <div
                role="alert"
                className="border-b border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                {assignmentSaveError}
              </div>
            )}
            <PracticeAssignmentList
              assignments={localAssignments}
              onToggleLock={canEditSchedule ? handleToggleLock : undefined}
              loading={dashboardLoading?.practice}
            />
          </div>
          {canEditSchedule && (
            <PracticeOverridePanel teams={overrideTeams} baseSlots={overrideBaseSlots} />
          )}
        </div>

        <div className="lg:col-span-1 space-y-6">
          <PracticeReadinessPanel
            practiceReadinessSnapshot={practice?.snapshot || {}}
            dashboardLoading={dashboardLoading || {}}
          />
        </div>
      </div>
    </div>
  );
}
