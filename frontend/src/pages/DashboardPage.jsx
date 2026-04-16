import React, { useEffect, useState } from 'react';
import { useOrganization } from '../contexts/OrganizationContext';
import { useDashboardData } from '../hooks/useDashboardData';
import LeagueMetrics from '../components/Dashboard/LeagueMetrics';
import TeamGenerationStatus from '../components/Dashboard/TeamGenerationStatus';
import SchedulingConflictAlerts from '../components/Dashboard/SchedulingConflictAlerts';
import ComplianceSnapshot from '../components/Dashboard/ComplianceSnapshot';
import ActivityFeed from '../components/Dashboard/ActivityFeed';
import { LoadingScreen } from '../components/LoadingScreen';
import { logger } from '../lib/logger.js';

/**
 * DashboardPage component.
 * Displays various metrics and statuses for the organization.
 */
const DashboardPage = () => {
  const { currentOrganization, loading: orgLoading } = useOrganization();
  const { metrics, teams, schedRun, games, registrations, loading: dataLoading, error } = useDashboardData();
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    if (!orgLoading) {
      setIsInitializing(false);
    }
  }, [orgLoading]);

  // Show loading screen during initial organization context fetch or data aggregation
  if (isInitializing || dataLoading) {
    return <LoadingScreen message="Loading Dashboard..." />;
  }

  if (error) {
    logger.error('Dashboard failed to load:', error);
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-primary">
        <div className="text-center p-8 bg-bg-secondary rounded-xl border border-border-primary">
          <h2 className="text-xl font-bold text-text-primary mb-4">Dashboard Unavailable</h2>
          <p className="text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            League Management
          </h1>
          <p className="text-text-secondary">
            {currentOrganization?.name || 'Your Organization'} Dashboard
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-primary-500/10 text-primary-400 text-xs font-medium rounded-full border border-primary-500/20">
            Season: Fall 2024
          </span>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <LeagueMetrics metrics={metrics} />
      </div>

      {/* Status & Alerts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <TeamGenerationStatus run={schedRun} teams={teams} />
          <SchedulingConflictAlerts games={games} />
        </div>
        <div className="space-y-6">
          <ComplianceSnapshot registrations={registrations} />
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
