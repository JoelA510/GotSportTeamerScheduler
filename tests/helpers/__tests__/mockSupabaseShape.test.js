import { describe, it, expect } from 'vitest';
import { mockSupabaseShape } from '../mockSupabaseShape.js';

describe('mockSupabaseShape', () => {
  it('returns a { supabase } wrapper object', () => {
    const shape = mockSupabaseShape();
    expect(shape).toHaveProperty('supabase');
    expect(typeof shape.supabase).toBe('object');
  });

  it('exposes from, rpc as vi.fn spies', () => {
    const { supabase } = mockSupabaseShape();
    expect(typeof supabase.from).toBe('function');
    expect(typeof supabase.from.mock).toBe('object');
    expect(typeof supabase.rpc).toBe('function');
    expect(typeof supabase.rpc.mock).toBe('object');
  });

  it('exposes auth.getUser, onAuthStateChange, signOut as vi.fn spies', () => {
    const { supabase } = mockSupabaseShape();
    expect(typeof supabase.auth.getUser.mock).toBe('object');
    expect(typeof supabase.auth.onAuthStateChange.mock).toBe('object');
    expect(typeof supabase.auth.signOut.mock).toBe('object');
  });

  it('auth.getUser resolves to a null user by default', async () => {
    const { supabase } = mockSupabaseShape();
    await expect(supabase.auth.getUser()).resolves.toEqual({
      data: { user: null },
      error: null,
    });
  });

  it('auth.onAuthStateChange returns an unsubscribable subscription', () => {
    const { supabase } = mockSupabaseShape();
    const result = supabase.auth.onAuthStateChange(() => {});
    expect(typeof result.data.subscription.unsubscribe).toBe('function');
  });

  it('channel() returns an object with on/subscribe/unsubscribe spies', () => {
    const { supabase } = mockSupabaseShape();
    const ch = supabase.channel('test');
    expect(typeof ch.on.mock).toBe('object');
    expect(typeof ch.subscribe.mock).toBe('object');
    expect(typeof ch.unsubscribe.mock).toBe('object');
  });

  it('storage.from() returns upload + createSignedUrl spies', async () => {
    const { supabase } = mockSupabaseShape();
    const bucket = supabase.storage.from('avatars');
    expect(typeof bucket.upload.mock).toBe('object');
    expect(typeof bucket.createSignedUrl.mock).toBe('object');
    await expect(bucket.createSignedUrl('k', 60)).resolves.toEqual({
      data: { signedUrl: 'https://mock.url/signed' },
      error: null,
    });
  });

  it('returns a fresh shape on each call (spies are independent)', () => {
    const a = mockSupabaseShape();
    const b = mockSupabaseShape();
    expect(a.supabase.from).not.toBe(b.supabase.from);
  });
});
