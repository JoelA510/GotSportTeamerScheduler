import { describe, it, expect } from 'vitest';
import { makeUser, makeAuthSession } from '../user.js';

describe('makeUser', () => {
  it('returns deterministic defaults with no args', () => {
    expect(makeUser()).toEqual({
      id: 'user-1',
      email: 'test@example.com',
      full_name: 'Test User',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
  });

  it('merges overrides, with override keys winning', () => {
    const u = makeUser({ id: 'user-2', email: 'u2@example.com' });
    expect(u.id).toBe('user-2');
    expect(u.email).toBe('u2@example.com');
    expect(u.full_name).toBe('Test User');
  });

  it('respects explicit undefined overrides', () => {
    const u = makeUser({ email: undefined });
    expect(u.email).toBeUndefined();
  });
});

describe('makeAuthSession', () => {
  it('returns deterministic defaults with no args', () => {
    const s = makeAuthSession();
    expect(s.access_token).toBe('mock-access-token');
    expect(s.refresh_token).toBe('mock-refresh-token');
    expect(s.expires_at).toBe(1767229200);
    expect(s.expires_in).toBe(3600);
    expect(s.token_type).toBe('bearer');
    expect(s.user.id).toBe('user-1');
    expect(s.user.email).toBe('test@example.com');
    expect(s.user.aud).toBe('authenticated');
    expect(s.user.role).toBe('authenticated');
  });

  it('defaults to a future expires_at so callers do not see a pre-expired session', () => {
    const s = makeAuthSession();
    expect(s.expires_at * 1000).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('merges top-level overrides, with override keys winning', () => {
    const s = makeAuthSession({ access_token: 'custom-token' });
    expect(s.access_token).toBe('custom-token');
    expect(s.refresh_token).toBe('mock-refresh-token');
  });

  it('deep-merges the user object so partial user overrides preserve other fields', () => {
    const s = makeAuthSession({ user: { id: 'user-2' } });
    expect(s.user.id).toBe('user-2');
    expect(s.user.email).toBe('test@example.com');
    expect(s.user.aud).toBe('authenticated');
    expect(s.user.role).toBe('authenticated');
  });

  it('respects explicit undefined overrides', () => {
    const s = makeAuthSession({ access_token: undefined });
    expect(s.access_token).toBeUndefined();
  });
});
