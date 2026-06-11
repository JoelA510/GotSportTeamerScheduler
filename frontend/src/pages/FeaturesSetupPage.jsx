import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Info, Sparkles } from 'lucide-react';
import FeatureFlagSettings from '../components/settings/FeatureFlagSettings.jsx';
import Button from '../components/ui/Button.jsx';

/**
 * "Choose your tools" — the feature-configuration step of Season Setup.
 * Standalone (outside the dashboard chrome) like /setup, since it is
 * primarily visited before onboarding completes. Changes save immediately
 * through the audited feature-flags RPC.
 */
export default function FeaturesSetupPage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', overflow: 'auto' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px 64px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <span className="page-obj-icon" style={{ background: 'var(--primary)' }}>
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <div>
            <h1 className="page-title">Choose your tools</h1>
            <div className="page-sub">
              Turn on only what your club uses — you can change any of this later in Settings →
              Features.
            </div>
          </div>
        </header>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 14px',
            background: 'var(--primary-weak)',
            borderRadius: 'var(--r-md)',
            margin: '18px 0',
            fontSize: 13,
            color: 'var(--primary-text)',
            fontWeight: 600,
          }}
        >
          <Info size={18} style={{ flex: 'none' }} aria-hidden="true" />
          <span>
            Recreational clubs often track <b>Years Played</b> instead of rating players. Pick what
            fits — nothing here is permanent.
          </span>
        </div>

        <FeatureFlagSettings />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
          <Button variant="secondary" onClick={() => navigate('/setup')}>
            Back to setup
          </Button>
          <Button variant="primary" icon={ArrowRight} onClick={() => navigate('/import')}>
            Save &amp; continue to import
          </Button>
        </div>
      </div>
    </div>
  );
}
