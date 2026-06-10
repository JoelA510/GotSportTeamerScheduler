import React from 'react';
import { Users } from 'lucide-react';
import Page from '../components/chrome/Page.jsx';
import PageHeader from '../components/chrome/PageHeader.jsx';
import InvitesSettings from '../components/settings/InvitesSettings.jsx';

/**
 * Members & Roles — organization membership management. Reuses the
 * invites module (create/revoke invite links per role); direct member
 * role editing arrives with a later phase.
 */
export default function MembersPage() {
  return (
    <Page
      header={
        <PageHeader
          title="Members & Roles"
          subtitle="Invite admins, coaches, and parents — manage who can access this organization."
          icon={
            <span className="page-obj-icon" style={{ background: 'var(--accent-violet)' }}>
              <Users size={20} aria-hidden="true" />
            </span>
          }
        />
      }
    >
      <div style={{ maxWidth: 760 }}>
        <InvitesSettings />
      </div>
    </Page>
  );
}
