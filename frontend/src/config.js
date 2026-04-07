/**
 * Frontend configuration.
 * Centralizes environment variable access for both Vite (browser) and Node (test) environments.
 */

function getEnvVar(key) {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
}

export const SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL') || getEnvVar('SUPABASE_URL');
export const SUPABASE_ANON_KEY =
  getEnvVar('VITE_SUPABASE_ANON_KEY') || getEnvVar('SUPABASE_ANON_KEY');

export const API_BASE_URL =
  getEnvVar('VITE_SUPABASE_PERSISTENCE_URL') || 'http://localhost:54321/functions/v1';

export const PRACTICE_PERSISTENCE_URL = `${API_BASE_URL}/practice-persistence`;
export const GAME_PERSISTENCE_URL = `${API_BASE_URL}/game-persistence`;

export const USE_MOCK_SUPABASE = getEnvVar('VITE_USE_MOCK_SUPABASE') === 'true';
export const IS_MOCK_MODE = !SUPABASE_URL || !SUPABASE_ANON_KEY || USE_MOCK_SUPABASE;

/**
 * Production Safety Guard
 * Prevents the application from running in mock mode on production domains.
 * This ensures that a misconfigured deployment can never serve mock data to real users.
 */
if (typeof window !== 'undefined' && IS_MOCK_MODE) {
  const hostname = window.location.hostname;
  const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1';
  const isPreviewDeploy = hostname.endsWith('.vercel.app');

  if (!isLocalDev && !isPreviewDeploy) {
    const errorRoot = document.getElementById('root');
    if (errorRoot) {
      errorRoot.innerHTML = `
        <div style="
          display: flex; align-items: center; justify-content: center;
          min-height: 100vh; background: #0f172a; color: #f1f5f9;
          font-family: system-ui, -apple-system, sans-serif; padding: 2rem;
        ">
          <div style="
            max-width: 480px; text-align: center; padding: 2.5rem;
            background: rgba(30, 41, 59, 0.8); border-radius: 1rem;
            border: 1px solid rgba(248, 113, 113, 0.3);
            box-shadow: 0 0 40px rgba(248, 113, 113, 0.1);
          ">
            <div style="font-size: 3rem; margin-bottom: 1rem;">&#9888;</div>
            <h1 style="font-size: 1.5rem; font-weight: 700; color: #f87171; margin-bottom: 0.75rem;">
              Configuration Error
            </h1>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 1.5rem;">
              SquadLogic cannot start in mock mode on a production domain.
              Please verify that <code style="color: #fbbf24; background: rgba(251,191,36,0.1); padding: 0.125rem 0.375rem; border-radius: 0.25rem;">VITE_SUPABASE_URL</code> and
              <code style="color: #fbbf24; background: rgba(251,191,36,0.1); padding: 0.125rem 0.375rem; border-radius: 0.25rem;">VITE_SUPABASE_ANON_KEY</code>
              are set in your deployment environment.
            </p>
            <p style="color: #64748b; font-size: 0.875rem;">
              See <strong>docs/operations/ENVIRONMENT.md</strong> for setup instructions.
            </p>
          </div>
        </div>
      `;
    }
    throw new Error(
      '[SquadLogic] FATAL: Mock mode is active on a production domain (' +
        hostname +
        '). Aborting initialization. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
}
