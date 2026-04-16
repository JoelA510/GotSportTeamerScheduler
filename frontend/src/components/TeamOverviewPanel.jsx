import React from 'react';
import PropTypes from 'prop-types';
import SummaryGrid from './SummaryGrid.jsx';
import { Users, UserCheck, ShieldAlert, Award } from 'lucide-react';
import { formatDateTime } from '../utils/formatters.js';

export default function TeamOverviewPanel({ totals, divisions, generatedAt, timezone }) {
  const summaryItems = [
    {
      label: 'Assigned Players',
      value: totals.playersAssigned,
      icon: Users,
      color: 'blue',
    },
    {
      label: 'Target Players',
      value: totals.playersTarget,
      icon: UserCheck,
      color: 'green',
    },
    {
      label: 'Manual Review',
      value: totals.manualReviewRequired,
      icon: ShieldAlert,
      color: totals.manualReviewRequired > 0 ? 'amber' : 'green',
    },
    {
      label: 'Teams Formed',
      value: totals.totalTeams,
      icon: Award,
      color: 'purple',
    },
  ];

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-text-primary">Teaming Overview</h2>
        {generatedAt && (
          <span className="text-sm text-text-secondary">
            Generated {formatDateTime(generatedAt)}
          </span>
        )}
      </div>

      <SummaryGrid items={summaryItems} />

      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-4">Division Breakdown</h3>
        <div className="insights-grid">
          {divisions.map((division) => (
            <article
              key={division.divisionId}
              className="insight-card card-glass hover:bg-bg-surface-hover transition-colors"
              aria-labelledby={`heading-div-${division.divisionId}`}
            >
              <h3 className="text-brand-400 font-bold mb-1" id={`heading-div-${division.divisionId}`}>{division.divisionId}</h3>
              <p className="text-text-secondary mb-3">
                {division.totalTeams} teams · {division.playersAssigned} players
              </p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Roster Utilization</span>
                  <span className="text-text-primary font-medium">
                    {Math.round((division.playersAssigned / (division.totalTeams * 12)) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full"
                    style={{
                      width: `${Math.min(100, (division.playersAssigned / (division.totalTeams * 12)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

TeamOverviewPanel.propTypes = {
  totals: PropTypes.object.isRequired,
  divisions: PropTypes.array.isRequired,
  generatedAt: PropTypes.string,
  timezone: PropTypes.string,
};
