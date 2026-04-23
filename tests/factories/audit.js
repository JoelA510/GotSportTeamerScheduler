export function makeAuditLogEntry(overrides = {}) {
  return {
    id: 'audit-1',
    created_at: '2026-01-01T00:00:00Z',
    user_id: 'user-1',
    organization_id: 'org-1',
    action: 'import.started',
    resource_type: null,
    resource_id: null,
    metadata: {},
    ip_address: null,
    ...overrides,
  };
}
