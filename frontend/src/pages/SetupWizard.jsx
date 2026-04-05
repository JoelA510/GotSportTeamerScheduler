import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Shield,
  Rocket,
  AlertTriangle,
  Info,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { ALL_FLAGS } from '../constants/featureFlags.js';
import { PERMISSIONS } from '../constants/permissions.js';
import Button from '../components/ui/Button.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import BrandingModule from '../components/settings/modules/BrandingModule.jsx';

/**
 * Premium Error Banner for critical setup failures.
 */
const ErrorBanner = ({ message, onRetry, onClose }) => (
  <div
    role="alert"
    aria-live="assertive"
    className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 backdrop-blur-xl animate-fadeIn flex items-start gap-4"
  >
    <div className="p-2 bg-red-500/20 text-red-400 rounded-xl">
      <XCircle size={20} />
    </div>
    <div className="flex-1">
      <h4 className="text-red-400 font-bold text-sm uppercase tracking-wider">
        Setup Synchronization Error
      </h4>
      <p className="text-red-300/80 text-xs mt-1 leading-relaxed">{message}</p>
      <div className="flex gap-3 mt-4">
        <Button variant="danger" size="sm" onClick={onRetry} icon={RefreshCw}>
          Retry Finalization
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-red-400/60 hover:text-red-400"
        >
          Dismiss
        </Button>
      </div>
    </div>
  </div>
);

/**
 * Layout-Stable Skeleton to prevent Cumulative Layout Shift (CLS).
 */
const SetupSkeleton = () => (
  <div className="min-h-screen bg-bg-main flex items-center justify-center p-6">
    <div className="max-w-3xl w-full bg-bg-surface border border-white/5 rounded-3xl glass-effect flex flex-col min-h-[600px] animate-pulse">
      <div className="p-8 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/5 rounded-xl" />
          <div className="space-y-2">
            <div className="h-5 w-32 bg-white/5 rounded-md" />
            <div className="h-3 w-48 bg-white/5 rounded-md" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-1.5 w-12 bg-white/10 rounded-full" />
          <div className="h-1.5 w-12 bg-white/5 rounded-full" />
          <div className="h-1.5 w-12 bg-white/5 rounded-full" />
        </div>
      </div>
      <div className="flex-1 p-8 space-y-8">
        <div className="space-y-3">
          <div className="h-8 w-64 bg-white/5 rounded-lg" />
          <div className="h-4 w-full bg-white/5 rounded-lg" />
        </div>
        <div className="space-y-6">
          <div className="h-12 w-full bg-white/5 rounded-xl" />
          <div className="h-64 w-full bg-white/5 rounded-2xl" />
        </div>
      </div>
      <div className="p-8 border-t border-white/5 flex justify-end">
        <div className="h-10 w-32 bg-white/5 rounded-full" />
      </div>
    </div>
  </div>
);

export default function SetupWizard() {
  const navigate = useNavigate();
  const { currentOrganization, featureFlags, permissions } = useOrganization();
  const { leagueName, updateLeagueName } = useTheme();

  const [step, setStep] = useState(1);
  const [localFlags, setLocalFlags] = useState({});
  const [localLeagueName, setLocalLeagueName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Telemetry session initialization
  const sessionId = useMemo(() => Math.random().toString(36).substring(2, 15), []);

  const isTenantAdmin = permissions?.includes(PERMISSIONS.MANAGE_GLOBAL_SETTINGS);

  // Sync initials when data is ready
  useEffect(() => {
    if (featureFlags && Object.keys(localFlags).length === 0) {
      setLocalFlags({ ...featureFlags });
    }
    if (leagueName && !localLeagueName) {
      setLocalLeagueName(leagueName);
    }
  }, [featureFlags, leagueName]);

  useEffect(() => {
    if (permissions.length > 0 && !isTenantAdmin && currentOrganization) {
      navigate('/');
    }
  }, [isTenantAdmin, currentOrganization, navigate, permissions]);

  const logTelemetry = async (eventType, payload = {}) => {
    try {
      await supabase.from('telemetry_log').insert({
        org_id: currentOrganization?.id,
        session_id: sessionId,
        event_type: eventType,
        payload: { ...payload, step },
      });
    } catch (err) {
      logger.error('Telemetry failed', err);
    }
  };

  const handleNext = () => {
    setError(null);
    logTelemetry('wizard.step_completed');
    setStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setError(null);
    setStep((prev) => prev - 1);
  };

  const handleToggle = (flag) => {
    setLocalFlags((prev) => ({ ...prev, [flag]: !prev[flag] }));
  };

  const finalizeSetup = async () => {
    setSaving(true);
    setError(null);
    try {
      // 1. Update League Name if changed
      if (localLeagueName !== leagueName) {
        updateLeagueName(localLeagueName);
      }

      // 2. Call finalize_onboarding RPC
      const { error: rpcError } = await supabase.rpc('finalize_onboarding', {
        p_org_id: currentOrganization.id,
        p_flags: localFlags,
      });

      if (rpcError) throw rpcError;

      await logTelemetry('wizard.finalized', { final_flags: localFlags });

      // Force reload to pick up new organization state
      window.location.href = '/?onboarded=true';
    } catch (err) {
      logger.error('Finalization failed', err);
      setError(
        err.message ||
          'An unexpected error occurred while finalizing your organization setup. Please verify your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!currentOrganization || !featureFlags || permissions.length === 0) {
    return <SetupSkeleton />;
  }

  if (!isTenantAdmin) return null;

  return (
    <main
      role="main"
      className="min-h-screen bg-bg-main flex items-center justify-center p-6 animate-fadeIn"
    >
      <div className="max-w-3xl w-full bg-bg-surface border border-white/5 rounded-3xl shadow-2xl overflow-hidden glass-effect flex flex-col min-h-[600px]">
        {/* Header / Progress */}
        <div className="p-8 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-500/20 text-brand-400 rounded-xl flex items-center justify-center">
              <Rocket size={24} />
            </div>
            <div>
              <h1 id="wizard-title" className="text-xl font-bold text-text-primary">
                SquadLogic Setup
              </h1>
              <p className="text-text-muted text-sm px-1">Phase 2: Smart Architecture Activation</p>
            </div>
          </div>
          <div
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={3}
            aria-label={`Step ${step} of 3: ${step === 1 ? 'Branding' : step === 2 ? 'Architecture' : 'Launch'}`}
            className="flex gap-2"
          >
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                aria-hidden="true"
                className={`h-1.5 w-12 rounded-full transition-all duration-500 ${s <= step ? 'bg-brand-400' : 'bg-white/10'}`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          {error && (
            <ErrorBanner message={error} onRetry={finalizeSetup} onClose={() => setError(null)} />
          )}

          {step === 1 && (
            <section
              aria-labelledby="step-1-title"
              aria-current="step"
              className="space-y-8 animate-slideInRight"
            >
              <div className="space-y-2">
                <h2
                  id="step-1-title"
                  className="text-2xl font-bold text-text-primary uppercase tracking-tight"
                >
                  Welcome to the Enterprise Tier
                </h2>
                <p className="text-text-muted">
                  Refine your league's identity and branding before activating advanced features.
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    League Display Name
                  </label>
                  <input
                    type="text"
                    value={localLeagueName}
                    onChange={(e) => setLocalLeagueName(e.target.value)}
                    className="w-full bg-bg-surface border border-border-subtle rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
                  />
                </div>
                <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  <BrandingModule />
                </div>
              </div>
            </section>
          )}

          {step === 2 && (
            <section
              aria-labelledby="step-2-title"
              aria-current="step"
              className="space-y-8 animate-slideInRight"
            >
              <div className="space-y-2">
                <h2
                  id="step-2-title"
                  className="text-2xl font-bold text-text-primary uppercase tracking-tight"
                >
                  Smart Architecture
                </h2>
                <p className="text-text-muted">
                  Enable specialized logic handlers for your organization's unique requirements.
                </p>
              </div>

              <div className="grid gap-4">
                {ALL_FLAGS.map((flag) => (
                  <label
                    key={flag}
                    className={`p-5 rounded-2xl border cursor-pointer transition-all flex items-start gap-4 ${
                      localFlags[flag]
                        ? 'bg-brand-glow/10 border-brand-500/40 shadow-lg shadow-brand-500/5'
                        : 'bg-white/5 border-white/5 hover:border-white/20'
                    }`}
                  >
                    <div
                      className={`mt-1 p-2 rounded-lg ${localFlags[flag] ? 'bg-brand-500/20 text-brand-400' : 'bg-white/10 text-white/40'}`}
                    >
                      <Shield size={20} />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-text-primary font-bold uppercase tracking-tight text-sm">
                        {flag.replace(/_/g, ' ')}
                      </h4>
                      <p className="text-xs text-text-muted mt-1 leading-relaxed">
                        Activates the high-conversion {flag.replace(/_/g, ' ')} logic within your
                        ingestion pipeline.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={!!localFlags[flag]}
                      onChange={() => handleToggle(flag)}
                    />
                    <div
                      className={`w-12 h-6 rounded-full relative transition-colors ${localFlags[flag] ? 'bg-brand-500' : 'bg-white/10'}`}
                    >
                      <div
                        className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${localFlags[flag] ? 'translate-x-6' : 'translate-x-0'}`}
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl flex gap-3 text-blue-400">
                <Info size={18} className="shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  <strong>Architectural Note</strong>: These toggles enforce RPC-only persistence.
                  Changing them will be recorded in the persistent Audit Log.
                </p>
              </div>
            </section>
          )}

          {step === 3 && (
            <section
              aria-labelledby="step-3-title"
              aria-current="step"
              className="space-y-8 text-center animate-slideInRight py-6"
            >
              <div className="w-20 h-20 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle size={48} />
              </div>
              <div className="space-y-3 max-w-md mx-auto">
                <h2
                  id="step-3-title"
                  className="text-3xl font-bold text-text-primary uppercase tracking-tight"
                >
                  Ready to Launch
                </h2>
                <p className="text-text-muted">
                  Your organization is now configured with a custom architecture. We've initialized
                  a telemetry session for this setup.
                </p>
              </div>

              <div className="p-6 bg-white/5 border border-white/5 rounded-2xl text-left space-y-4">
                <div className="flex justify-between items-center px-2">
                  <span className="text-sm font-medium text-text-secondary">
                    Selected Architectures
                  </span>
                  <span className="text-xs bg-brand-500/20 text-brand-400 px-2 py-0.5 rounded-full font-bold">
                    {Object.values(localFlags).filter(Boolean).length} Active
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_FLAGS.filter((f) => localFlags[f]).map((f) => (
                    <div
                      key={f}
                      className="text-[10px] text-text-muted truncate bg-white/5 p-2 rounded-lg border border-white/5"
                    >
                      {f.replace(/_/g, ' ')}
                    </div>
                  ))}
                  {Object.values(localFlags).filter(Boolean).length === 0 && (
                    <div className="col-span-2 text-center text-xs py-4 text-text-muted italic opacity-50">
                      Standalone Legacy Ingestion (No Smart Flags)
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-500 text-left">
                <AlertTriangle size={20} className="shrink-0" />
                <p className="text-xs leading-relaxed font-bold">
                  By clicking 'Complete Setup', you finalize the enterprise transition and will be
                  granted access to the production dashboard.
                </p>
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="p-8 border-t border-white/5 flex gap-4 bg-bg-surface/50">
          {step > 1 && (
            <Button
              variant="secondary"
              onClick={handleBack}
              className="flex items-center gap-2"
              disabled={saving}
            >
              <ChevronLeft size={18} /> Back
            </Button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <Button
              variant="primary"
              onClick={handleNext}
              className="flex items-center gap-2 group"
            >
              Continue{' '}
              <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={finalizeSetup}
              disabled={saving}
              className="px-8 shadow-glow-brand"
            >
              {saving ? 'Finalizing...' : 'Complete Setup'}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
