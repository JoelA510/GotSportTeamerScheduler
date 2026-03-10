import React, { useState } from 'react';
import PracticeReadinessPanel from '../components/PracticeReadinessPanel.jsx';
import PracticeOverridePanel from '../components/PracticeOverridePanel.jsx';
import { useDashboardData } from '../hooks/useDashboardData.js';
import { useTheme } from '../contexts/ThemeContext.jsx';
import Button from '../components/ui/Button.jsx';
import { Edit2, Save } from 'lucide-react';

export default function PracticeSchedulingPage() {
  const { practice, team } = useDashboardData();
  const { timezone } = useTheme();
  const [isEditMode, setIsEditMode] = useState(false);

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

      {isEditMode ? (
        <PracticeOverridePanel
          teams={team?.teams || []}
          baseSlots={practice.snapshot?.baseSlotDistribution || []}
        />
      ) : (
        <PracticeReadinessPanel
          practiceReadinessSnapshot={practice.snapshot}
          practiceSummary={practice.summary}
          generatedAt={practice.generatedAt}
          timezone={timezone}
          scheduleEvaluation={practice.scheduleEvaluation}
        />
      )}
    </div>
  );
}
