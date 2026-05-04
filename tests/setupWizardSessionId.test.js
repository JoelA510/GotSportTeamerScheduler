import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebCryptoId } from '../frontend/src/utils/webCryptoId.js';

describe('createWebCryptoId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses randomUUID when available', () => {
    const randomUUID = vi.fn(() => 'setup-session-uuid');
    const getRandomValues = vi.fn();

    vi.stubGlobal('crypto', { randomUUID, getRandomValues });

    expect(createWebCryptoId()).toBe('setup-session-uuid');
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((array) => {
      array.set([101, 202, 303, 404]);
      return array;
    });

    vi.stubGlobal('crypto', { getRandomValues });

    expect(createWebCryptoId()).toBe('101-202-303-404');
    expect(getRandomValues).toHaveBeenCalledWith(expect.any(Uint32Array));
  });

  it('returns undefined when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);

    expect(createWebCryptoId()).toBeUndefined();
  });
});
