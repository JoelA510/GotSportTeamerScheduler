import React, { useState, useMemo } from 'react';
import DashboardWorkflow from '../components/DashboardWorkflow';
import { useDashboardData } from '../hooks/useDashboardData';
import { useTeamPersistence } from '../hooks/useTeamPersistence';
import { useImport } from '../contexts/ImportContext';
import { useTheme } from '../contexts/ThemeContext';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import LoadingScreen from '../components/LoadingScreen';
import { Building2, Calendar, Users, Trophy } from 'lucide-react';

export default function DashboardPage() {
  const { loading, roadmap, team, practice, game } = useDashboardData();
  const { persistenceSnapshot } = useTeamPersistence();
  const { importedData, setImportedData } = useImport();
  const { timezone } = useTheme();
  const { currentOrganization, currentSeasonSetting } = useOrganization();
  const [activeStep, setActiveStep] = useState(1);

  // Readiness Score: 4×25% binary components
  const readinessScore = useMemo(() => {
    let score = 0;
    if (importedData && importedData.totalRows > 0) score += 25;
    if (team?.generatedAt) score += 25;
    if (practice?.generatedAt) score += 25;
    if (game?.generatedAt) score += 25;
    return score;
  }, [importedData, team, practice, game]);

  if (loading.team && loading.practice && loading.game) {
    return <LoadingScreen />;
  }

  const handleImport = (data) => {
    setImportedData(data);
  };

  return (
    <div className="animate-fadeIn">
      {/* Page Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-display font-bold text-text-primary tracking-tight mb-1">
          Season Setup Workflow
        </h1>
        <p className="text-text-secondary">
          Follow these steps to configure and generate your league schedule.
        </p>
      </header>

      {/* 2/3 + 1/3 Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Workflow Steps (2/3) */}
        <div className="lg:col-span-2">
          <DashboardWorkflow
            loading={loading}
            teamData={team}
            practiceData={practice}
            gameData={game}
            persistenceSnapshot={persistenceSnapshot}
            onImport={handleImport}
            importedData={importedData}
            controlledActiveStep={activeStep}
            onStepChange={setActiveStep}
            timezone={timezone}
          />
        </div>

        {/* Right: League Status (1/3) */}
        <div className="lg:col-span-1">
          <div className="glass-panel sticky top-8 p-6">
            <h3 className="text-lg font-bold text-text-primary mb-4 border-b border-border-subtle pb-4">
              League Status
            </h3>

            <div className="space-y-4">
              {/* Active Org */}
              <div className="flex justify-between items-center">
                <span className="text-text-muted text-sm flex items-center gap-1.5">
                  <Building2 size={14} />
                  Active Club
                </span>
                <span className="font-semibold text-text-primary bg-brand-glow px-2.5 py-1 rounded text-xs border border-brand-400/30">
                  {currentOrganization?.name || '—'}
                </span>
              </div>

              {/* Active Season */}
              <div className="flex justify-between items-center">
                <span className="text-text-muted text-sm flex items-center gap-1.5">
                  <Calendar size={14} />
                  Active Season
                </span>
                <span className="font-semibold text-text-primary bg-brand-glow px-2.5 py-1 rounded text-xs border border-brand-400/30">
                  {currentSeasonSetting?.name || '—'}
                </span>
              </div>

              {/* Stats */}
              <div className="flex justify-between items-center">
                <span className="text-text-muted text-sm flex items-center gap-1.5">
                  <Users size={14} />
                  Total Players
                </span>
                <span className="font-mono text-text-primary">
                  {importedData?.totalRows || 0}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-text-muted text-sm flex items-center gap-1.5">
                  <Trophy size={14} />
                  Total Teams
                </span>
                <span className="font-mono text-text-primary">
                  {team?.totals?.teamCount || 0}
                </span>
              </div>

              {/* Readiness Score */}
              <div className="pt-4 border-t border-border-subtle">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-text-muted text-sm font-semibold">Readiness Score</span>
                  <span
                    className={`font-mono text-sm font-bold ${
                      readinessScore === 100
                        ? 'text-status-success'
                        : readinessScore >= 50
                          ? 'text-status-warning'
                          : 'text-text-muted'
                    }`}
                  >
                    {readinessScore}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-bg-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${
                      readinessScore === 100
                        ? 'bg-status-success shadow-[0_0_10px_var(--color-status-success-glow)]'
                        : readinessScore >= 50
                          ? 'bg-status-warning shadow-[0_0_10px_var(--color-status-warning-glow)]'
                          : 'bg-brand-400 shadow-[0_0_10px_var(--color-primary-glow)]'
                    }`}
                    style={{ width: `${readinessScore}%` }}
                  />
                </div>

                {/* Individual step indicators */}
                <div className="mt-3 space-y-1.5">
                  {[
                    { label: 'Data Import', done: importedData?.totalRows > 0 },
                    { label: 'Team Generation', done: !!team?.generatedAt },
                    { label: 'Practice Schedule', done: !!practice?.generatedAt },
                    { label: 'Game Schedule', done: !!game?.generatedAt },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2 text-xs">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          item.done
                            ? 'bg-status-success shadow-[0_0_5px_var(--color-status-success-glow)]'
                            : 'bg-text-muted opacity-40'
                        }`}
                      />
                      <span className={item.done ? 'text-text-secondary' : 'text-text-muted'}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity placeholder */}
              <div className="pt-4 border-t border-border-subtle">
                <h4 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wider">
                  Recent Activity
                </h4>
                <div className="space-y-3">
                  {team?.generatedAt && (
                    <div className="flex gap-3 items-start">
                      <div className="w-2 h-2 rounded-full bg-status-success mt-1.5 shadow-[0_0_5px_var(--color-status-success-glow)]" />
                      <div>
                        <p className="text-sm text-text-secondary">Teams Generated</p>
                        <p className="text-xs text-text-muted">
                          {new Date(team.generatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  )}
                  {practice?.generatedAt && (
                    <div className="flex gap-3 items-start">
                      <div className="w-2 h-2 rounded-full bg-brand-400 mt-1.5 shadow-[0_0_5px_var(--color-primary-glow)]" />
                      <div>
                        <p className="text-sm text-text-secondary">Practice Schedule Generated</p>
                        <p className="text-xs text-text-muted">
                          {new Date(practice.generatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  )}
                  {!team?.generatedAt && !practice?.generatedAt && (
                    <p className="text-xs text-text-muted">No activity yet for this season.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

