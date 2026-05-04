import React, { useState } from 'react';
import { Settings, Shield, History, Ticket } from 'lucide-react';
import GeneralSettings from '../components/settings/GeneralSettings.jsx';
import FeatureFlagSettings from '../components/settings/FeatureFlagSettings.jsx';
import AuditLogSettings from '../components/settings/AuditLogSettings.jsx';
import InvitesSettings from '../components/settings/InvitesSettings.jsx';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { PERMISSIONS } from '../constants/permissions.js';

/**
 * SettingsPage - Organization Control Center
 * Refactored in Phase 2 for high modularity.
 * Under 100 lines shell pattern.
 */
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const { permissions } = useOrganization();

  // RBAC check for architectural toggles
  const canManageFlags = permissions.includes(PERMISSIONS.MANAGE_GLOBAL_SETTINGS);
  const canManageInvites = permissions.includes(PERMISSIONS.MANAGE_ORGANIZATION);

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    ...(canManageInvites ? [{ id: 'invites', label: 'Invites', icon: Ticket }] : []),
    ...(canManageFlags ? [{ id: 'flags', label: 'Feature Flags', icon: Shield }] : []),
    { id: 'audit', label: 'Audit Log', icon: History },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings />;
      case 'invites':
        return <InvitesSettings />;
      case 'flags':
        return <FeatureFlagSettings />;
      case 'audit':
        return <AuditLogSettings />;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary flex items-center gap-3">
          <Settings className="text-brand-400" size={32} />
          Organization Settings
        </h1>
        <p className="text-text-muted mt-2">
          Configure your league&apos;s identity, behavior, and structural configurations.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Organization settings tabs"
        className="flex border-b border-white/5 mb-8 overflow-x-auto scrollbar-hide"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => {
              const index = tabs.findIndex((t) => t.id === tab.id);
              let nextIndex = index;

              if (e.key === 'ArrowRight') {
                nextIndex = (index + 1) % tabs.length;
              } else if (e.key === 'ArrowLeft') {
                nextIndex = (index - 1 + tabs.length) % tabs.length;
              } else if (e.key === 'Home') {
                nextIndex = 0;
              } else if (e.key === 'End') {
                nextIndex = tabs.length - 1;
              } else {
                return;
              }

              e.preventDefault();
              setActiveTab(tabs[nextIndex].id);
              document.getElementById(`tab-${tabs[nextIndex].id}`)?.focus();
            }}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all relative whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset ${
              activeTab === tab.id ? 'text-brand-400' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <tab.icon size={18} aria-hidden="true" />
            {tab.label}
            {activeTab === tab.id && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-full"
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>

      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className="bg-bg-surface p-8 rounded-2xl border border-white/5 shadow-xl glass-effect min-h-[400px]"
      >
        {renderContent()}
      </div>
    </div>
  );
}
