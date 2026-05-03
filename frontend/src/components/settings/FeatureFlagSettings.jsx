import React, { useState } from 'react';
import { Shield, Info, AlertTriangle } from 'lucide-react';
import { useOrganization } from '../../contexts/OrganizationContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { FEATURE_FLAGS, ALL_FLAGS } from '../../constants/featureFlags.js';
import Button from '../ui/Button.jsx';
import LoadingScreen from '../LoadingScreen.jsx';

export default function FeatureFlagSettings() {
  const { featureFlags, updateFeatureFlags, loading, currentOrganization } = useOrganization();
  const { user, isImpersonating } = useAuth();
  const [localFlags, setLocalFlags] = useState({ ...featureFlags });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const handleToggle = (flagKey) => {
    setLocalFlags((prev) => ({
      ...prev,
      [flagKey]: !prev[flagKey],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateFeatureFlags(localFlags);
      if (result.success) {
        // Audit the change
        const orgId = currentOrganization?.id;
        if (orgId) {
          await supabase.rpc('record_audit_event', {
            p_organization_id: orgId,
            p_action: 'settings.flags_updated',
            p_metadata: {
              user_id: user?.id,
              flags: localFlags,
              ...(isImpersonating && {
                target_user_id: user?.profile?.id,
                impersonated_by: user?.id,
                admin_email: user?.email,
              }),
            },
          });
        }
        setMessage({ type: 'success', text: 'Feature flags updated successfully.' });
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update flags.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen />;

  const flagMetadata = {
    [FEATURE_FLAGS.ADVANCED_FAIRNESS]: {
      label: 'Advanced Fairness Evaluation',
      description:
        'Enables multi-weighted metrics for team balancing including commute time and coach experience.',
    },
    [FEATURE_FLAGS.COACH_OVERLAP_STRICT]: {
      label: 'Strict Coach Conflict Enforcement',
      description:
        'Prevents any scheduling that results in a coach having overlapping practice slots across multiple teams.',
    },
    [FEATURE_FLAGS.LIST_VIEW_TOGGLE]: {
      label: 'Enable Dashboard List View',
      description: 'Allows users to toggle between graphical and tabular views of the dashboard.',
    },
    [FEATURE_FLAGS.FUZZY_IMPORT_MAPPING]: {
      label: 'Fuzzy Data Alignment (AI)',
      description:
        'Uses intelligent string matching to automatically align CSV headers with internal data fields.',
    },
    // Add other metadata as needed
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-2 mb-6">
        <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg">
          <Shield size={20} aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-text-primary">Executive Control Panel</h3>
          <p className="text-text-muted text-sm px-1">
            Manage high-impact architectural toggles for your organization.
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg flex items-center gap-3 border ${
            message.type === 'success'
              ? 'bg-green-500/10 border-green-500/20 text-green-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}
        >
          <Info size={18} aria-hidden="true" />
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      <div className="grid gap-4">
        {ALL_FLAGS.map((flag) => {
          const meta = flagMetadata[flag] || {
            label: flag
              .split('_')
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' '),
            description: 'Organization-level feature toggle.',
          };
          const isEnabled = localFlags[flag] || false;
          const descriptionId = `feature-flag-${flag}-description`;
          const switchLabel = `${meta.label}${flag.includes('advanced') ? ' Enterprise' : ''}`;

          return (
            <div
              key={flag}
              className={`p-4 rounded-xl border transition-all ${
                isEnabled
                  ? 'bg-brand-glow/5 border-brand-500/30'
                  : 'bg-bg-surface border-white/5 opacity-80'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-text-primary font-medium flex items-center gap-2">
                    {meta.label}
                    {flag.includes('advanced') && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400 uppercase font-bold tracking-wider">
                        Enterprise
                      </span>
                    )}
                  </h4>
                  <p
                    id={descriptionId}
                    className="text-xs text-text-muted max-w-lg leading-relaxed"
                  >
                    {meta.description}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={switchLabel}
                  aria-describedby={descriptionId}
                  onClick={() => handleToggle(flag)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface ${
                    isEnabled ? 'bg-brand-500' : 'bg-white/10'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-3 pt-6 border-t border-white/10 mt-8">
        <Button
          variant="secondary"
          size="md"
          onClick={() => setLocalFlags({ ...featureFlags })}
          disabled={saving}
        >
          Reset
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={saving || JSON.stringify(localFlags) === JSON.stringify(featureFlags)}
        >
          {saving ? 'Saving...' : 'Apply Changes'}
        </Button>
      </div>

      <div className="mt-4 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg flex gap-3">
        <AlertTriangle className="text-yellow-500 shrink-0" size={18} aria-hidden="true" />
        <p className="text-xs text-yellow-500/80 leading-relaxed">
          <strong>Caution</strong>: Modifying these flags can fundamentally alter teaming and
          scheduling outcomes. ensure all stakeholders are informed before performing structural
          changes.
        </p>
      </div>
    </div>
  );
}
