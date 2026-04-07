import React, { useState, useEffect } from 'react';
import { logger } from '../lib/logger.js';
import { Loader2, AlertCircle, CheckCircle2, Save, Activity, ShieldCheck, Zap } from 'lucide-react';

/**
 * EvaluationPanel - Enterprise Glass component for real-time fairness scoring.
 * Refined for Phase 7 with composite Deno-based engine support.
 */
export default function EvaluationPanel({ practiceData = null, gameData = null, supabaseClient }) {
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [message, setMessage] = useState('');

  // Trigger server-side evaluation when inputs change
  useEffect(() => {
    let active = true;

    const triggerEvaluation = async () => {
      // Logic requirement: Require at least one data source
      if (!practiceData && !gameData) {
        setEvaluation(null);
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabaseClient.functions.invoke('fairness-scoring', {
          body: {
            // Refined Payload: Pass null if missing, or the expected object structure
            practice: practiceData
              ? {
                  assignments: practiceData.assignments || [],
                  teams: practiceData.teams || [],
                  slots: practiceData.slots || [],
                  unassigned: practiceData.unassigned || [],
                }
              : null,
            games: gameData
              ? {
                  games: gameData.games || [],
                  teams: gameData.teams || [],
                }
              : null,
            persist: false,
          },
        });

        if (error) throw error;
        if (active) setEvaluation(data);
      } catch (err) {
        logger.error('Edge Function Evaluation failed:', err);
        if (active) {
          setMessage('Engine connectivity issue. Retrying...');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    const debounceTimer = setTimeout(triggerEvaluation, 800);
    return () => {
      active = false;
      clearTimeout(debounceTimer);
    };
  }, [practiceData, gameData, supabaseClient]);

  const handleSave = async () => {
    if (!evaluation || !supabaseClient) return;

    setPersisting(true);
    setMessage('Hardening results in audit trail...');

    try {
      const { data, error } = await supabaseClient.functions.invoke('fairness-scoring', {
        body: {
          practice: practiceData,
          games: gameData,
          persist: true,
          metadata: {
            source: 'EvaluationPanel_ManualSave',
            timestamp: new Date().toISOString(),
          },
        },
      });

      if (error) throw error;

      setMessage('A-1 Audit: Evaluation persisted successfully.');
      setTimeout(() => setMessage(''), 4000);
    } catch (err) {
      logger.error('Edge Function Persistence failed:', err);
      setMessage(`Save sync failed: ${err.message}`);
    } finally {
      setPersisting(false);
    }
  };

  // Enterprise Glass Loading Skeleton
  if (loading && !evaluation) {
    return (
      <div
        className="glass-panel p-6 rounded-xl border border-white/10 animate-pulse transition-all duration-500"
        role="status"
        aria-busy="true"
        aria-label="Fairness scoring engine is evaluating data"
      >
        <div className="flex items-center gap-6">
          <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center border border-white/5">
            <Activity
              className="w-6 h-6 text-indigo-400 rotate-12 transition-transform duration-1000 animate-spin"
              aria-hidden="true"
            />
          </div>
          <div className="flex-1 space-y-3">
            <div className="h-5 w-48 bg-white/10 rounded-full" />
            <div className="h-4 w-64 bg-white/5 rounded-full" />
          </div>
          <div className="h-10 w-32 bg-white/5 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!evaluation && !loading) {
    return null;
  }

  const statusConfig = {
    ok: {
      label: 'SLA Compliant',
      color: 'text-emerald-400',
      glow: 'shadow-emerald-500/20',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      icon: <ShieldCheck size={18} />,
    },
    'attention-needed': {
      label: 'Optimizations Available',
      color: 'text-amber-400',
      glow: 'shadow-amber-500/20',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      icon: <Zap size={18} />,
    },
    'action-required': {
      label: 'Critical Violation',
      color: 'text-rose-400',
      glow: 'shadow-rose-500/20',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/20',
      icon: <AlertCircle size={18} />,
    },
  };

  const currentStatus = statusConfig[evaluation?.status] || statusConfig.ok;
  const score = evaluation?.metrics?.combinedScore * 100 || 0;

  return (
    <div
      className="glass-panel p-6 rounded-xl border border-white/10 relative overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10"
      aria-live="polite"
    >
      {/* Background Micro-Gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-blue-500/5 pointer-events-none" />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div
            className={`p-3.5 rounded-xl ${currentStatus.bg} border ${currentStatus.border} ${currentStatus.glow} shadow-lg transition-transform hover:scale-110`}
            aria-hidden="true"
          >
            {loading ? (
              <Loader2 className="w-6 h-6 text-white animate-spin" aria-hidden="true" />
            ) : (
              <span className={currentStatus.color}>{currentStatus.icon}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-display font-bold text-white tracking-tight">
                Fairness Scoring Engine
              </h2>
              <span
                className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${currentStatus.border} ${currentStatus.color}`}
              >
                {currentStatus.label}
              </span>
            </div>
            <div className="text-sm text-white/50 mt-1.5 flex items-center gap-3">
              <span>
                Fairness Index:{' '}
                <span className="text-white font-mono font-bold">{score.toFixed(1)}%</span>
              </span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span>
                Issues:{' '}
                <span
                  className={evaluation?.issues?.length > 0 ? 'text-amber-400' : 'text-emerald-400'}
                >
                  {evaluation?.issues?.length || 0}
                </span>
              </span>
              {evaluation?.metrics?.executionTimeMs && (
                <>
                  <span className="w-1 h-1 rounded-full bg-white/20" />
                  <span className="text-[10px] opacity-40 font-mono tracking-tighter">
                    LATENCY: {evaluation.metrics.executionTimeMs}ms
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {message && (
            <span className="text-[11px] text-indigo-300 animate-fadeIn font-mono font-medium tracking-tight bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20">
              {message}
            </span>
          )}

          <button
            onClick={handleSave}
            disabled={persisting || loading || !evaluation}
            title="Persist evaluation results to the audit trail"
            aria-busy={persisting}
            aria-describedby="save-audit-desc"
            className="flex items-center gap-2.5 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg shadow-xl shadow-indigo-600/30 transition-all hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed group font-display font-bold"
          >
            {persisting ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <Save
                size={18}
                className="group-hover:translate-y-[-1px] transition-transform"
                aria-hidden="true"
              />
            )}
            <span>{persisting ? 'Hardening...' : 'Sync to Audit'}</span>
          </button>
          <span id="save-audit-desc" className="sr-only">
            Saves the current fairness index and conflict metrics into the permanent cryptographic
            audit trail.
          </span>
        </div>
      </div>

      {evaluation?.issues?.length > 0 && (
        <section
          className="mt-6 space-y-2 max-h-56 overflow-y-auto pr-3 custom-scrollbar"
          aria-label="Evaluation Issue Details"
        >
          <ul className="space-y-2">
            {evaluation.issues.map((issue, idx) => (
              <li
                key={`${issue.category}-${idx}`}
                className={`group flex items-start gap-4 p-3.5 rounded-xl border transition-all hover:translate-x-1 ${
                  issue.severity === 'error'
                    ? 'bg-rose-500/[0.03] border-rose-500/10 text-rose-200/90 hover:bg-rose-500/[0.08]'
                    : 'bg-amber-500/[0.03] border-amber-500/10 text-amber-200/90 hover:bg-amber-500/[0.08]'
                }`}
              >
                <div
                  className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 shadow-sm ${issue.severity === 'error' ? 'bg-rose-500 shadow-rose-500/50' : 'bg-amber-500 shadow-amber-500/50'}`}
                  aria-hidden="true"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold uppercase tracking-[0.15em] text-[9px] opacity-50">
                      {issue.category.replace('_', ' ')}
                    </span>
                    {issue.details && (
                      <span className="text-[10px] opacity-40 font-mono tracking-tighter italic">
                        {issue.details}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-snug font-medium">{issue.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
