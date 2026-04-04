import React from 'react';
import SettingsAuditLog from './SettingsAuditLog.jsx';

/**
 * Wrapper component for the settings audit log to maintain modular structure
 * and support future enhancements such as export or filtering.
 */
export default function AuditLogSettings() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-lg font-medium text-text-primary">Audit Log</h3>
          <p className="text-text-muted text-sm pb-1">Traceability for all organization-level configuration changes.</p>
        </div>
      </div>
      <SettingsAuditLog />
    </div>
  );
}
