import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_MOCK_MODE } from '../config.js';

if (IS_MOCK_MODE) {
  console.log('[Mock Supabase] Initializing MOCK client');
  console.warn('Using mock Supabase client due to missing or placeholder environment variables.');
} else {
  console.log('[Mock Supabase] Initializing REAL client');
}

let mockSubscriptionCallback = null;
let pendingAuthEvents = [];

const triggerAuthEvent = (event, session) => {
  console.log(`[Mock Supabase] Triggering ${event}`);
  if (mockSubscriptionCallback) {
    mockSubscriptionCallback(event, session);
  } else {
    console.log(`[Mock Supabase] No listener yet, buffering ${event}`);
    pendingAuthEvents.push({ event, session });
  }
};

const getMockData = (table, col, val) => {
  const data = {
    organizations: [{ id: 'mock-org-id', name: 'Mock Organization' }],
    profiles: [{ id: 'mock-user-id', full_name: 'Mock Admin', role: 'admin' }],
    season_settings: [{ id: 1, season_label: 'Fall Recreation', season_year: 2024 }],
    divisions: [
      { id: 'u8-div-id', name: 'U8 Coed', season_settings_id: 1 },
      { id: 'u10-div-id', name: 'U10 Girls', season_settings_id: 1 }
    ],
    teams: [
      { id: 't1', name: 'Firebolts', division_id: 'u8-div-id', coach_id: 'c1' },
      { id: 't2', name: 'River Runners', division_id: 'u8-div-id', coach_id: 'c2' }
    ],
    players: [
      { id: 'p1', first_name: 'Emma', last_name: 'Johnson', division_id: 'u8-div-id' },
      { id: 'p2', first_name: 'Liam', last_name: 'Patel', division_id: 'u8-div-id' }
    ],
    registration_forms: [
      { id: 'f1', name: 'Fall 2024 Registration', status: 'active' }
    ],
    scheduler_runs: [
      { 
        id: 'run1', 
        run_type: 'team', 
        status: 'completed', 
        metrics: { progress: 100, total_players: 2, total_teams: 2 }, 
        results: { 
          teamsByDivision: { 'U8 Coed': [{ id: 't1', name: 'Firebolts' }] },
          rosterBalanceByDivision: { 'U8 Coed': { summary: { averageFillRate: 0.8 } } }
        },
        created_at: new Date().toISOString() 
      }
    ]
  };
  
  let results = data[table] || [];
  if (col && val) {
    results = results.filter(item => item[col] === val);
  }
  return results;
};

// Helper to create a chainable mock query
const createMockQuery = (table, data = null) => {
  const results = data || getMockData(table);
  const proxy = {
    select: () => proxy,
    eq: () => proxy,
    in: () => proxy,
    order: () => proxy,
    limit: () => proxy,
    single: () => Promise.resolve({ data: results[0] || {}, error: null }),
    maybeSingle: () => Promise.resolve({ data: results[0] || null, error: null }),
    then: (onFullfilled) => Promise.resolve({ data: results, error: null }).then(onFullfilled),
    catch: (onRejected) => Promise.resolve({ data: results, error: null }).catch(onRejected),
  };
  return proxy;
};

export const supabase =
  IS_MOCK_MODE
    ? {
        auth: {
          signInWithPassword: async ({ email, password }) => {
            console.log('[Mock Supabase] Login attempt:', email);
            if (password === 'password123' || password === 'test-password-123') {
              const session = {
                user: { id: 'mock-user-id', email, user_metadata: { full_name: 'Mock User' } },
                access_token: 'mock-token',
              };
              setTimeout(() => triggerAuthEvent('SIGNED_IN', session), 50);
              return { data: { session, user: session.user }, error: null };
            }
            return { data: { session: null, user: null }, error: { message: 'Invalid credentials' } };
          },
          signOut: async () => {
            setTimeout(() => triggerAuthEvent('SIGNED_OUT', null), 50);
            return { error: null };
          },
          onAuthStateChange: (callback) => {
            console.log('[Mock Supabase] onAuthStateChange listener registered');
            mockSubscriptionCallback = callback;
            setTimeout(() => callback('INITIAL_SESSION', null), 0);
            while (pendingAuthEvents.length > 0) {
              const { event, session } = pendingAuthEvents.shift();
              setTimeout(() => callback(event, session), 10);
            }
            return { data: { subscription: { unsubscribe: () => { mockSubscriptionCallback = null; } } } };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
          getUser: async () => ({ data: { user: null }, error: null }),
        },
        from: (table) => ({
          ...createMockQuery(table),
          insert: () => Promise.resolve({ data: [], error: null }),
          update: () => Promise.resolve({ data: [], error: null }),
          upsert: () => Promise.resolve({ data: [], error: null }),
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      }
    : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
