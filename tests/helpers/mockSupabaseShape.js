import { vi } from 'vitest';

/**
 * Default object shape for `vi.mock('@/lib/supabaseClient', ...)`.
 *
 * Returns a fresh factory each call so mutating spies in one test does
 * not bleed into another. Usage:
 *
 *   import { mockSupabaseShape } from '../helpers/index.js';
 *   vi.mock('@/lib/supabaseClient', () => mockSupabaseShape());
 *
 * Extend a specific method per-test via `supabase.from.mockReturnValue(...)`
 * or by composing with `createChainMock`.
 */
export const mockSupabaseShape = () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: null, error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://mock.url/signed' },
          error: null,
        }),
      }),
    },
  },
});
