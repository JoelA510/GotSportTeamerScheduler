import React from 'react';
import PropTypes from 'prop-types';
import InsightSection from './InsightSection.jsx';
import { formatDateTime } from '../utils/formatters.js';

export default function PracticeReadinessPanel({
  practiceReadinessSnapshot,
  dashboardLoading,
  timezone,
}) {
  if (dashboardLoading.practice) {
    return (
      <div className="glass-panel p-8 animate-pulse">
        <div className="h-6 w-1/3 bg-white/10 rounded mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white/5 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-text-primary">Practice Readiness</h2>
        {practiceReadinessSnapshot.lastCalculated && (
          <span className="text-sm text-text-secondary">
            Generated {formatDateTime(practiceReadinessSnapshot.lastCalculated)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <InsightSection
          label="Field Distribution"
          value={`${practiceReadinessSnapshot.balancedScore}%`}
          status={practiceReadinessSnapshot.balancedScore > 85 ? 'good' : 'warning'}
          description="Evenness of primary vs secondary fields"
        />
        <InsightSection
          label="Manual Actions"
          value={practiceReadinessSnapshot.manualActionRequiredCount}
          status={
            practiceReadinessSnapshot.manualActionRequiredCount === 0 ? 'good' : 'warning'
          }
          description="Teams requiring manual slot assignment"
        />
        <InsightSection
          label="Venue Saturation"
          value={practiceReadinessSnapshot.venueSaturation}
          status={practiceReadinessSnapshot.venueSaturation === 'Low' ? 'good' : 'warning'}
          description="Current capacity utilization"
        />
        <InsightSection
          label="Conflict Free"
          value={`${practiceReadinessSnapshot.conflictFreeTeams}%`}
          status={practiceReadinessSnapshot.conflictFreeTeams > 95 ? 'good' : 'warning'}
          description="Teams without schedule overlapping"
        />
      </div>

      <div className="insights-grid">
        <article className="insight-card" aria-labelledby="manual-follow-ups">
          <h3 className="insight-card__title" id="manual-follow-ups">Manual follow-up reasons</h3>
          {!practiceReadinessSnapshot.unassignedByReason?.length ? (
            <p className="insight-card__empty">All teams assigned automatically.</p>
          ) : (
            <ul className="insight-card__list">
              {practiceReadinessSnapshot.unassignedByReason.map((reason, idx) => (
                <li key={idx} className="insight-card__list-item">
                  <span className="font-medium">{reason.reason}:</span>{' '}
                  {reason.count} teams
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </div>
  );
}

PracticeReadinessPanel.propTypes = {
  practiceReadinessSnapshot: PropTypes.object.isRequired,
  dashboardLoading: PropTypes.object.isRequired,
  timezone: PropTypes.string,
};
