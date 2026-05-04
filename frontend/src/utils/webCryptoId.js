export const createWebCryptoId = () =>
  globalThis.crypto?.randomUUID?.() ||
  globalThis.crypto?.getRandomValues?.(new Uint32Array(4))?.join('-');
