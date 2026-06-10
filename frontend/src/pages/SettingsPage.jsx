import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import GeneralSettings from '../components/settings/GeneralSettings.jsx';
import FeatureFlagSettings from '../components/settings/FeatureFlagSettings.jsx';
import AuditLogSettings from '../components/settings/AuditLogSettings.jsx';
import InvitesSettings from '../components/settings/InvitesSettings.jsx';
import Page from '../components/chrome/Page.jsx';
import PageHeader from '../components/chrome/PageHeader.jsx';
import Tabs from '../components/ui/Tabs.jsx';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { PERMISSIONS } from '../constants/permissions.js';

/**
 * SettingsPage — organization control center (general, invites, features,
 * audit) on the Lightning-class page scaffold.
 */
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const { permissions, currentOrganization, currentSeasonSetting } = useOrganization();

  // RBAC check for architectural toggles
  const canManageFlags = permissions.includes(PERMISSIONS.MANAGE_GLOBAL_SETTINGS);
  const canManageInvites = permissions.includes(PERMISSIONS.MANAGE_ORGANIZATION);

  const tabs = [
    { id: 'general', label: 'General' },
    ...(canManageInvites ? [{ id: 'invites', label: 'Invites' }] : []),
    ...(canManageFlags ? [{ id: 'features', label: 'Features' }] : []),
    { id: 'audit', label: 'Audit Log' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings />;
      case 'invites':
        return <InvitesSettings />;
      case 'features':
        return <FeatureFlagSettings />;
      case 'audit':
        return <AuditLogSettings />;
      default:
        return null;
    }
  };

  const subtitle = [currentOrganization?.name, currentSeasonSetting?.name]
    .filter(Boolean)
    .join(' · ');

  return (
    <Page
      header={
        <PageHeader
          title="Settings"
          subtitle={subtitle || "Configure your league's identity, behavior, and features."}
          icon={
            <span className="page-obj-icon" style={{ background: 'var(--text-secondary)' }}>
              <Settings size={20} aria-hidden="true" />
            </span>
          }
          tabs={
            <Tabs
              tabs={tabs}
              activeTab={activeTab}
              onChange={setActiveTab}
              label="Organization settings tabs"
              panelId={`panel-${activeTab}`}
            />
          }
        />
      }
    >
      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-label={tabs.find((tab) => tab.id === activeTab)?.label}
        style={{ maxWidth: 760 }}
      >
        {renderContent()}
      </div>
    </Page>
  );
}
