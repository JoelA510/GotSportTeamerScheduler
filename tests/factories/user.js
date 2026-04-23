export function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    full_name: 'Test User',
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeAuthSession(overrides = {}) {
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_at: 1767225600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      email: 'test@example.com',
      aud: 'authenticated',
      role: 'authenticated',
    },
    ...overrides,
  };
}
