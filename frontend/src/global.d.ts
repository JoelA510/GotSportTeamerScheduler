// This file is used to extend the global Window interface for TypeScript.
// It ensures that __MOCK_DB__ is recognized across the project.

export {};

declare global {
  interface Window {
    __MOCK_DB__: Record<string, unknown>;
    __FORCE_ERROR__: boolean | undefined;
  }
}
