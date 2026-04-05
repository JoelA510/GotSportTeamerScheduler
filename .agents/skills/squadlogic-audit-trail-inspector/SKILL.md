# SquadLogic Audit Trail Inspector

Protocol for analyzing the `audit_log` to detect configuration anomalies and security risks.

## Overview

Status: Production Ready
Database: `audit_log` table
RPC: `get_settings_audit_log`
UI: `SettingsAuditLog.jsx`

## Implementation Protocol

When inspecting the audit trail:

1. Use the `get_settings_audit_log` RPC to retrieve scoped events.
2. Filter for `settings.updated` and `feature_flags.updated` events.
3. Compare the `old_value` and `new_value` in the `change_summary` JSON.
4. Verify the `actor_id` against known organization admins.
5. Report any flags enabled without a corresponding ticket or Jira reference.

## Best Practices

- **Security**: Treat the audit log as Read-Only for standard users.
- **Data Integrity**: Every configuration change MUST create a row in the `audit_log`.
- **Anomalies**: Look for "Flag Flip-Flopping" (enabling and disabling the same flag repeatedly in a short period).
- **Searchability**: Always ensure search filters in the UI include both `event_type` and `actor` metadata.
