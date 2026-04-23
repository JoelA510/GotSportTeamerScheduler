export function makeOrganization(overrides = {}) {
  return {
    id: 'org-1',
    name: 'Test Organization',
    slug: 'test-org',
    contact_info: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeOrganizationMember(overrides = {}) {
  return {
    organization_id: 'org-1',
    profile_id: 'user-1',
    role: 'admin',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
