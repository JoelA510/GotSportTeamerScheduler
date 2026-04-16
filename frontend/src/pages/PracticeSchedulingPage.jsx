import React, { useState, useEffect, useCallback } from 'react';
import { useDashboardData } from '../hooks/useDashboardData.js';
import PracticeScheduleView from '../components/PracticeScheduleView.jsx';
import AutoSchedulerPanel from '../components/AutoSchedulerPanel.jsx';
import PracticeReadinessPanel from '../components/PracticeReadinessPanel.jsx';
import Button from '../components/ui/Button.jsx';
import ProgressBar from '../components/ui/ProgressBar.jsx';
import { Edit2, Save } from 'lucide-react';
import EvaluationPanel from '../components/EvaluationPanel.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { Sparkles, Calendar } from 'lucide-react';

export default function PracticeSchedulingPage() {
  const { practice, team, loading: dashboardLoading } = useDashboardData();
  const [assignments, setAssignments] = useState([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [timezone, setTimezone] = useState(null);

  // Auto-scheduler status
  const [autoSchedulerStatus, setAutoSchedulerStatus] = useState('idle');
  const [autoSchedulerProgress, setAutoSchedulerProgress] = useState(0);
  const [autoSchedulerResult, setAutoSchedulerResult] = useState(null);
  const [autoSchedulerError, setAutoSchedulerError] = useState(null);

  useEffect(() => {
    if (practice?.assignments) {
      setAssignments(practice.assignments);
    }
  }, [practice]);

  // Handle auto-scheduler trigger
  const handleAutoGenerate = useCallback(async () => {
    setAutoSchedulerStatus('running');
    setAutoSchedulerProgress(0);
    setAutoSchedulerError(null);

    try {
      // 1. Get current tenant/org context
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // 2. Mock call to edge function (scheduling-engine)
      // In a real app, this would be: await supabase.functions.invoke('schedule-practices', { body: { teamId: team.id } });
      const interval = setInterval(() => {
        setAutoSchedulerProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            return 100;
          }
          return prev + 5;
        });
      }, 100);

      // Simulate network delay and processing
      setTimeout(() => {
        clearInterval(interval);
        setAutoSchedulerProgress(100);
        setAutoSchedulerStatus('success');
        setAutoSchedulerResult({
          assignments: assignments, // Mocking unchanged for now
          summary: { conflictFree: 100, fieldUtilization: 88 },
        });
      }, 3000);
    } catch (err) {
      setAutoSchedulerStatus('error');
      setAutoSchedulerError(err.message);
    }
  }, [assignments, team]);

  const cancelAutoScheduler = () => {
    setAutoSchedulerStatus('idle');
    setAutoSchedulerProgress(0);
  };

  const resetAutoScheduler = () => {
    setAutoSchedulerStatus('idle');
    setAutoSchedulerResult(null);
  };

  const localAssignments =
    autoSchedulerStatus === 'success' && autoSchedulerResult
      ? autoSchedulerResult.assignments
      : assignments;

  const isColdStart = !team?.teams?.length;

  return (
    <div className="animate-fadeIn space-y-8 max-w-[65ch] mx-auto w-full">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Practice Scheduling</h1>
          <p className="text-white/60">Configure and optimize team field assignments.</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant={isEditMode ? 'primary' : 'secondary'}
            onClick={() => setIsEditMode(!isEditMode)}
            className="flex items-center gap-2"
          >
            {isEditMode ? <Save size={18} /> : <Edit2 size={18} />}
            {isEditMode ? 'Save Assignments' : 'Enter Manual Override'}
          </Button>
        </div>
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
            disabled={dashboardLoading.practice || isColdStart}
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
                  You haven't generated any teams yet. Practice scheduling requires assigned teams to calculate field availability and distribution.
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
            <PracticeScheduleView assignments={localAssignments} isEditMode={isEditMode} />
          </div>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <PracticeReadinessPanel
            practiceReadinessSnapshot={practice || {}}
            dashboardLoading={dashboardLoading}
            timezone={timezone}
          />
        </div>
      </div>
    </div>
  );
}
