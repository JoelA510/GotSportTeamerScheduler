/**
 * Mock Supabase Client
 * Extracted from supabaseClient.js for clean separation between mock (E2E/dev)
 * and real (staging/production) environments.
 *
 * This module provides a sessionStorage-backed in-memory database that mimics
 * the Supabase JS client API surface used by SquadLogic's hooks and pages.
 */
import { logger } from './logger.js';

// ── Mock Data Seed ──────────────────────────────────────────────────────────
const initialMockData = {
  organizations: [{ id: 'org-1', name: 'SquadLogic FC' }],
  profiles: [
    { id: 'mock-admin-id', first_name: 'Mock', last_name: 'Admin', full_name: 'Mock Admin', email: import.meta.env.VITE_TEST_ADMIN_EMAIL || 'admin@example.com', role: 'admin' },
    { id: 'mock-coach-id', first_name: 'Mock', last_name: 'Coach', full_name: 'Mock Coach', email: import.meta.env.VITE_TEST_COACH_EMAIL || 'coach@example.com', role: 'coach' },
    { id: 'mock-parent-id', first_name: 'Mock', last_name: 'Parent', full_name: 'Mock Parent', email: 'parent@example.com', role: 'parent' }
  ],
  organization_members: [
    { organization_id: 'org-1', profile_id: 'mock-admin-id', role: 'admin' },
    { organization_id: 'org-1', profile_id: 'mock-coach-id', role: 'coach' }
  ],
  season_settings: [
    { id: 'season-1', organization_id: 'org-1', name: 'Fall 2024', status: 'active', created_at: new Date().toISOString() }
  ],
  divisions: [
    { id: 'u8-div-id', name: 'U8 Coed', organization_id: 'org-1', season_settings_id: 'season-1' },
    { id: 'u10-div-id', name: 'U10 Girls', organization_id: 'org-1', season_settings_id: 'season-1' }
  ],
  teams: [
    { id: 't1', name: 'Team A', division_id: 'u8-div-id', coach_id: 'mock-coach-id', organization_id: 'org-1' },
    { id: 't2', name: 'Team B', division_id: 'u8-div-id', coach_id: 'c2', organization_id: 'org-1' },
    { id: '00000000-0000-0000-0000-000000000001', name: 'Tigers', division_id: 'u8-div-id', organization_id: 'org-1' }
  ],
  team_players: [
    { team_id: '00000000-0000-0000-0000-000000000001', player_id: 'player-1' },
    { team_id: '00000000-0000-0000-0000-000000000001', player_id: 'player-2' }
  ],
  players: [
    { id: 'player-1', first_name: 'Alex', last_name: 'Smith', organization_id: 'org-1', team_id: '00000000-0000-0000-0000-000000000001', division_id: 'U8 Boys' },
    { id: 'player-2', first_name: 'Jamie', last_name: 'Jones', organization_id: 'org-1', team_id: '00000000-0000-0000-0000-000000000001', division_id: 'U8 Boys' }
  ],
  profile_players: [
    { profile_id: 'mock-parent-id', player_id: 'player-1' },
    { profile_id: 'mock-parent-id', player_id: 'player-2' }
  ],
  practice_slots: [
    { id: 'ps-1', day_of_week: 'tue', start_time: '18:00', end_time: '19:30', field_id: 'v1', organization_id: 'org-1' }
  ],
  practice_assignments: [
    {
      id: 'pa-1',
      team_id: '00000000-0000-0000-0000-000000000001',
      slot_id: 'ps-1',
      day_of_week: 'tue',
      start_time: '18:00',
      end_time: '19:30',
      field_id: 'v1',
      effective_date_range: '[2025-01-01,2025-12-31)'
    }
  ],
  event_rsvps: [
    { id: 'rsvp-1', organization_id: 'org-1', team_id: '00000000-0000-0000-0000-000000000001', player_id: 'player-1', reference_id: 'pa-1', event_type: 'practice', occurrence_date: '2025-01-07', status: 'attending', updated_at: new Date().toISOString() }
  ],
  locations: [{ id: 'loc-1', name: 'Central Park' }],
  fields: [
    { id: 'v1', name: 'Field 1', location_id: 'loc-1', organization_id: 'org-1', active: true, surface_type: 'Grass', size: '11v11' },
    { id: 'v2', name: 'Field 2', location_id: 'loc-1', organization_id: 'org-1', active: true, surface_type: 'Turf', size: '7v7' }
  ],
  game_slots: [
    { id: 'gs-1', field_id: 'v1', start: '2026-04-04T08:00:00Z', end: '2026-04-04T09:00:00Z', capacity: 1, organization_id: 'org-1' },
    { id: 'gs-2', field_id: 'v1', start: '2026-04-04T09:30:00Z', end: '2026-04-04T10:30:00Z', capacity: 1, organization_id: 'org-1' },
    { id: 'gs-3', field_id: 'v2', start: '2026-04-04T08:00:00Z', end: '2026-04-04T09:00:00Z', capacity: 1, organization_id: 'org-1' },
    { id: 'gs-4', field_id: 'v2', start: '2026-04-04T09:30:00Z', end: '2026-04-04T10:30:00Z', capacity: 1, organization_id: 'org-1' }
  ],
  game_assignments: [],
  games: [
    {
      id: 'g1',
      organization_id: 'org-1',
      season_id: 'season-1',
      home_team_id: 't1',
      away_team_id: 't2',
      start_time: new Date(Date.now() - 86400000).toISOString(),
      venue_id: 'v1',
      has_conflict: true,
      conflict_reason: 'Double-booked Field',
      score_home: 2,
      score_away: 1
    },
    {
      id: 'game-2',
      organization_id: 'org-1',
      season_id: 'season-1',
      home_team_id: 't1',
      away_team_id: 't2',
      start_time: new Date(Date.now() - 3600000).toISOString(),
      venue_id: 'v1',
      score_home: null,
      score_away: null
    }
  ],
  player_registrations: [
    { id: 'player-1', organization_id: 'org-1', season_id: 'season-1', first_name: 'Alex', last_name: 'Smith', status: 'Reviewing', gender: 'B', birth_year: 2015 },
    { id: 'player-2', organization_id: 'org-1', season_id: 'season-1', first_name: 'Sam', last_name: 'Jones', status: 'Approved', gender: 'G', birth_year: 2016 },
  ],
  registration_forms: [
    { id: 'f1', title: 'Spring 2026 Registration', status: 'active', organization_id: 'org-1' }
  ],
  scheduler_runs: [
    {
      id: 'run-practice-1',
      organization_id: 'org-1',
      season_id: 'season-1',
      run_type: 'practice',
      status: 'completed',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      results: {
        summary: { assignmentRate: 1.0, manualFollowUpRate: 0, unassignedTeams: 0 },
        baseSlotDistribution: [
          { baseSlotId: 'slot_mon_1800', day: 'Monday', totalCapacity: 10, totalAssigned: 1 },
          { baseSlotId: 'slot_wed_1800', day: 'Wednesday', totalCapacity: 10, totalAssigned: 0 }
        ]
      }
    },
    {
      id: 'run-game-1',
      organization_id: 'org-1',
      season_id: 'season-1',
      run_type: 'game',
      status: 'completed',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      results: {
        summary: { assignmentRate: 1.0, manualFollowUpRate: 0, unassignedTeams: 0 }
      }
    },
    {
      id: 'run-1',
      organization_id: 'org-1',
      season_settings_id: 'season-1',
      run_type: 'team',
      status: 'completed',
      results: {
        teamsByDivision: {
          'U8 Boys': [
            { id: 't1', name: 'Team A', division_id: 'U8 Boys', headCoach: 'Mock Admin' },
            { id: 't2', name: 'Team B', division_id: 'U8 Boys', headCoach: 'Mock Coach' }
          ]
        },
        rosterBalanceByDivision: {
          'U8 Boys': {
            summary: { totalPlayers: 24, totalCapacity: 30, averageFillRate: 0.8 },
            teamStats: [
              { teamId: 't1', slotsRemaining: 3 },
              { teamId: 't2', slotsRemaining: 3 }
            ]
          }
        },
        coachCoverageByDivision: {
          'U8 Boys': { totalTeams: 2, teamsWithCoach: 2, coverageRate: 1.0 }
        }
      },
      started_at: new Date(Date.now() - 3600000).toISOString(),
      completed_at: new Date().toISOString()
    }
  ],
  registrations: [
    {
      id: 'reg-1',
      organization_id: 'org-1',
      form_id: 'f1',
      player_id: 'player-1',
      profile_id: 'mock-admin-id',
      medical_cleared: false,
      waiver_signed: true,
      created_at: new Date().toISOString()
    }
  ],
  team_summaries: [
    {
      id: 'summary-1',
      organization_id: 'org-1',
      season_id: 'season-1',
      total_players: 24,
      total_teams: 2,
      unassigned_players: 0,
      skill_balance_score: 92,
      last_updated: new Date().toISOString()
    }
  ],
  imports: [
    {
      id: 'import-1',
      user_id: 'mock-admin-id',
      import_type: 'players',
      data: {
        totalRows: 2,
        validRows: 2,
        data: [
          { 'First Name': 'Alex', 'Last Name': 'Smith', 'Birthdate': '2015-05-15', 'Gender': 'm', 'Skill Level': 'advanced' },
          { 'First Name': 'Sam', 'Last Name': 'Jones', 'Birthdate': '2016-08-20', 'Gender': 'f', 'Skill Level': 'developing' }
        ],
        fileName: 'mock_players.csv'
      },
      created_at: new Date(Date.now() - 86400000).toISOString()
    }
  ],
  view_league_standings: [
    {
      organization_id: 'org-1', team_id: 't1', team_name: 'Team A',
      division: 'U8 Coed', wins: 1, losses: 0, draws: 0, games_played: 1,
      goals_for: 2, goals_against: 1, goal_differential: 1, points: 3
    },
    {
      organization_id: 'org-1', team_id: 't2', team_name: 'Team B',
      division: 'U8 Coed', wins: 0, losses: 1, draws: 0, games_played: 1,
      goals_for: 1, goals_against: 2, goal_differential: -1, points: 0
    }
  ],
  view_org_metrics: [
    { organization_id: 'org-1', total_players: 150, total_teams: 12, total_users: 25 }
  ],
  view_compliance_stats: [
    { organization_id: 'org-1', form_title: 'Spring 2026 Registration', total_registrations: 45, medical_cleared: 38 }
  ]
};

// ── Realtime & Auth Event Plumbing ──────────────────────────────────────────
let mockSubscriptionCallback = null;
const realtimeCallbacks = [];
let pendingAuthEvents = [];

const triggerRealtimeEvent = (table, event, payload) => {
  logger.log(`[Mock Supabase] Triggering Realtime ${event} for ${table}`, payload);
  realtimeCallbacks.forEach(cb => {
    if (cb.table === table && (cb.event === '*' || cb.event === event)) {
      cb.callback(payload);
    }
  });
};

const triggerAuthEvent = (event, session) => {
  logger.log(`[Mock Supabase] Triggering ${event}`);
  if (mockSubscriptionCallback) {
    mockSubscriptionCallback(event, session);
  } else {
    pendingAuthEvents.push({ event, session });
  }
};

// ── Mock Data Management ────────────────────────────────────────────────────
const mergeSource = (db, source) => {
  if (!source) return db;
  Object.keys(source).forEach((key) => {
    if (Array.isArray(source[key])) {
      db[key] = db[key] || [];
      source[key].forEach((record) => {
        const idx = db[key].findIndex((r) => {
          if (r.id && record.id) return String(r.id) === String(record.id);
          if (key === 'organization_members') return String(r.organization_id) === String(record.organization_id) && String(r.profile_id) === String(record.profile_id);
          if (key === 'view_org_metrics') return String(r.organization_id) === String(record.organization_id);
          if (key === 'view_compliance_stats') return String(r.form_title) === String(record.form_title);
          if (key === 'view_league_standings') return String(r.team_id) === String(record.team_id);
          return false;
        });
        if (idx >= 0) {
          db[key][idx] = { ...db[key][idx], ...record };
        } else {
          db[key].push(record);
        }
      });
    } else if (source[key] && typeof source[key] === 'object') {
      db[key] = { ...(db[key] || {}), ...source[key] };
    } else {
      db[key] = source[key];
    }
  });
  return db;
};

const getDB = () => {
  let db = JSON.parse(JSON.stringify(initialMockData));

  if (typeof window !== 'undefined') {
    const storedDB = sessionStorage.getItem('__MOCK_DB__');
    if (storedDB) {
      try {
        const parsed = JSON.parse(storedDB);
        db = mergeSource(db, parsed);
      } catch (e) {
        logger.error('[Mock Supabase] SessionStorage parse error:', e);
      }
    }
    if (window.__MOCK_DB__) {
      db = mergeSource(db, window.__MOCK_DB__);
    }
  }
  return db;
};

const saveDB = (db) => {
  if (typeof window !== 'undefined') {
    window.__MOCK_DB__ = db;
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  }
};

// Initial state load
if (typeof window !== 'undefined') {
  window.__MOCK_DB__ = getDB();
  logger.log('[Mock Supabase] DB Initialized. Tables:', Object.keys(window.__MOCK_DB__).map(k => `${k}(${window.__MOCK_DB__[k]?.length || 0})`).join(', '));
}

export const getMockData = (table, col, val) => {
  const db = getDB();
  let results = db[table] || [];

  if (col && val) {
    results = results.filter((item) => {
      const itemVal = item[col] !== undefined ? String(item[col]) : 'undefined';
      const filterVal = String(val);
      return itemVal === filterVal;
    });
  }

  return results;
};

// ── Chainable Mock Query Builder ────────────────────────────────────────────
const createMockQuery = (table, data = null) => {
  let results = data || getMockData(table);
  let isSingle = false;
  let isMaybeSingle = false;
  let queryContent = '';

  const proxy = {
    select: (query) => {
      queryContent = query;
      if (results && results.length > 0 && queryContent) {
        if (table === 'organization_members' && queryContent.includes('organizations')) {
          const orgs = getMockData('organizations');
          results = results.map((item) => ({
            ...item,
            organizations: orgs.find((o) => String(o.id) === String(item.organization_id)) || null,
          }));
        }
        if (table === 'registrations') {
          if (queryContent.includes('players')) {
            const players = getMockData('players');
            results = results.map((item) => {
              const p = players.find((player) => String(player.id) === String(item.player_id));
              return { ...item, players: p || null };
            });
          }
          if (queryContent.includes('profiles')) {
            const profiles = getMockData('profiles');
            results = results.map((item) => {
              const p = profiles.find((profile) => String(profile.id) === String(item.profile_id));
              return { ...item, profiles: p || null };
            });
          }
        }
        if (table === 'organization_members') {
          if (queryContent.includes('organizations')) {
            const orgs = getMockData('organizations');
            results = results.map((item) => {
              const org = orgs.find((o) => String(o.id) === String(item.organization_id));
              return { ...item, organizations: org || null };
            });
          }
        }
        if (table === 'fields') {
          if (queryContent.includes('field_subunits')) {
            const subunits = getMockData('field_subunits');
            results = results.map((item) => ({
              ...item,
              field_subunits: subunits.filter((s) => String(s.field_id) === String(item.id)) || [],
            }));
          }
          if (queryContent.includes('practice_slots')) {
            const slots = getMockData('practice_slots');
            results = results.map((item) => ({
              ...item,
              practice_slots: slots.filter((s) => String(s.field_id) === String(item.id)) || [],
            }));
          }
        }
        if ((table === 'team_players' || table === 'profile_players') && (queryContent.includes('players') || queryContent.includes('player'))) {
          const players = getMockData('players');
          results = results.map((item) => {
            const player = players.find((p) => String(p.id) === String(item.player_id)) || null;
            return { ...item, player: player, players: player };
          });
        }
        if (table === 'teams' && queryContent.includes('event_rsvps')) {
          const rsvps = getMockData('event_rsvps');
          results = results.map((item) => ({
            ...item,
            event_rsvps: rsvps.filter((r) => String(r.team_id) === String(item.id)) || [],
          }));
        }
        if (table === 'games' && (queryContent.includes('home_team') || queryContent.includes('away_team'))) {
          const teams = getMockData('teams');
          results = results.map((item) => ({
            ...item,
            home_team: teams.find((t) => String(t.id) === String(item.home_team_id)) || { id: item.home_team_id, name: 'Home Team', division: 'U10' },
            away_team: teams.find((t) => String(t.id) === String(item.away_team_id)) || { id: item.away_team_id, name: 'Away Team', division: 'U10' },
          }));
        }
        if (table === 'practice_assignments' && (queryContent.includes('practice_slots') || queryContent.includes('teams'))) {
          const slots = getMockData('practice_slots');
          const fields = getMockData('fields');
          const teams = getMockData('teams');
          const divisions = getMockData('divisions');

          results = results.map((item) => {
            const slot = slots.find(s => String(s.id) === String(item.slot_id));
            const team = teams.find(t => String(t.id) === String(item.team_id));

            let enrichedSlot = slot ? { ...slot } : null;
            if (enrichedSlot) {
              enrichedSlot.fields = fields.find(f => String(f.id) === String(slot.field_id)) || null;
            }

            let enrichedTeam = team ? { ...team } : null;
            if (enrichedTeam) {
              enrichedTeam.divisions = divisions.find(d => String(d.id) === String(team.division_id) || String(d.name) === String(team.division)) || null;
            }

            return { ...item, practice_slots: enrichedSlot, teams: enrichedTeam };
          });
        }
      }
      return proxy;
    },
    eq: (col, val) => {
      results = results.filter((item) => {
        const itemVal = item[col] !== undefined ? String(item[col]) : 'undefined';
        return itemVal === String(val);
      });
      return proxy;
    },
    lte: (col, val) => {
      results = results.filter((item) => {
        if (item[col] === undefined) return false;
        const itemDate = new Date(item[col]).getTime();
        const valDate = new Date(val).getTime();
        if (!isNaN(itemDate) && !isNaN(valDate)) {
          if (col === 'start_time' && item.id && item.id.startsWith('game-')) {
            return true;
          }
          return itemDate <= valDate;
        }
        return item[col] <= val;
      });
      return proxy;
    },
    neq: (col, val) => {
      results = results.filter((item) => String(item[col]) !== String(val));
      return proxy;
    },
    in: (col, vals) => {
      const valStrings = Array.isArray(vals) ? vals.map(String) : [];
      results = results.filter((item) => valStrings.includes(String(item[col])));
      return proxy;
    },
    order: (col, { ascending } = { ascending: true }) => {
      results = [...results].sort((a, b) => {
        if (a[col] < b[col]) return ascending ? -1 : 1;
        if (a[col] > b[col]) return ascending ? 1 : -1;
        return 0;
      });
      return proxy;
    },
    limit: (n) => {
      results = results.slice(0, n);
      return proxy;
    },
    or: () => proxy,
    abortSignal: () => proxy,
    single: () => {
      isSingle = true;
      return proxy;
    },
    maybeSingle: () => {
      isMaybeSingle = true;
      return proxy;
    },
    then: (onFulfilled, onRejected) => {
      let finalData = JSON.parse(JSON.stringify(results));
      let error = null;

      if (isSingle) {
        if (results.length > 0) {
          finalData = results[0];
        } else {
          finalData = null;
          error = { code: 'PGRST116', message: 'No rows found' };
        }
      } else if (isMaybeSingle) {
        finalData = results.length > 0 ? results[0] : null;
      }

      return Promise.resolve({ data: finalData, error }).then(onFulfilled, onRejected);
    },
    catch: (onRejected) => Promise.resolve({ data: null, error: 'Mock error' }).then(null, onRejected),
  };
  return proxy;
};

// ── Mock Supabase Client ────────────────────────────────────────────────────

/** @type {any} */
export const mockSupabase = {
  auth: {
    signInWithPassword: async ({ email, password }) => {
      logger.log('[Mock Supabase] Login attempt:', email);
      const testPassword = import.meta.env.VITE_TEST_PASSWORD || 'test-password-fallback';
      if (password === testPassword) {
        const role = email.split('@')[0];
        const userId = `mock-${role}-id`;
        const session = {
          user: {
            id: userId,
            email,
            user_metadata: { full_name: `Mock ${role.charAt(0).toUpperCase() + role.slice(1)}` },
            app_metadata: { role: role === 'admin' || role === 'coach' ? role : 'parent' }
          },
          access_token: 'mock-token',
        };

        const db = (typeof window !== 'undefined' && window.__MOCK_DB__) || initialMockData;

        if (!db.profiles.find(p => p.id === userId)) {
          db.profiles.push({
            id: userId,
            full_name: session.user.user_metadata.full_name,
            role: session.user.app_metadata.role
          });
        }

        if (!db.organization_members.find(m => m.profile_id === userId)) {
          db.organization_members.push({
            organization_id: 'org-1',
            profile_id: userId,
            role: session.user.app_metadata.role
          });
        }

        if (typeof window !== 'undefined') {
          sessionStorage.setItem('__MOCK_SESSION__', JSON.stringify(session));
          window.__MOCK_DB__ = db;
        }

        setTimeout(() => triggerAuthEvent('SIGNED_IN', session), 50);
        return { data: { session, user: session.user }, error: null };
      }
      return { data: { session: null, user: null }, error: { message: 'Invalid credentials' } };
    },
    signOut: async () => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('__MOCK_SESSION__');
      }
      setTimeout(() => triggerAuthEvent('SIGNED_OUT', null), 50);
      return { error: null };
    },
    onAuthStateChange: (callback) => {
      logger.log('[Mock Supabase] onAuthStateChange listener registered');
      mockSubscriptionCallback = callback;
      let session = null;
      if (typeof window !== 'undefined') {
        const stored = sessionStorage.getItem('__MOCK_SESSION__');
        if (stored) session = JSON.parse(stored);
      }
      setTimeout(() => callback(session ? 'SIGNED_IN' : 'INITIAL_SESSION', session), 0);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              mockSubscriptionCallback = null;
            },
          },
        },
      };
    },
    getSession: async () => {
      let session = null;
      if (typeof window !== 'undefined') {
        const stored = sessionStorage.getItem('__MOCK_SESSION__');
        if (stored) session = JSON.parse(stored);
      }
      return { data: { session }, error: null };
    },
    getUser: async () => {
      let session = null;
      if (typeof window !== 'undefined') {
        const stored = sessionStorage.getItem('__MOCK_SESSION__');
        if (stored) session = JSON.parse(stored);
      }
      return { data: { user: session?.user || null }, error: null };
    },
  },
  from: (table) => {
    const query = createMockQuery(table);
    return {
      ...query,
      insert: (records) => {
        const db = getDB();
        const newRecords = (Array.isArray(records) ? records : [records]).map(r => {
          const id = r.id || Math.random().toString(36).substr(2, 9);
          if (table === 'fields' && r.supports_halves) {
            db.field_subunits = db.field_subunits || [];
            db.field_subunits.push({ id: `sub-${id}-a`, field_id: id, label: 'A', organization_id: r.organization_id || 'org-1' });
            db.field_subunits.push({ id: `sub-${id}-b`, field_id: id, label: 'B', organization_id: r.organization_id || 'org-1' });
          }
          return { id, created_at: new Date().toISOString(), ...r };
        });
        db[table] = [...(db[table] || []), ...newRecords];
        saveDB(db);
        const res = { data: Array.isArray(records) ? newRecords : newRecords[0], error: null };
        const chainable = {
          select: () => chainable,
          single: () => Promise.resolve({ data: Array.isArray(records) ? newRecords[0] : newRecords, error: null }),
          maybeSingle: () => Promise.resolve({ data: Array.isArray(records) ? newRecords[0] : newRecords, error: null }),
          then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
        };
        return chainable;
      },
      upsert: (records) => {
        const db = getDB();
        const newRecords = (Array.isArray(records) ? records : [records]).map(r => ({
          id: r.id || Math.random().toString(36).substr(2, 9),
          created_at: r.created_at || new Date().toISOString(),
          ...r
        }));
        const existing = db[table] || [];
        const eventsToFire = [];

        newRecords.forEach(rec => {
          let idx = -1;
          if (table === 'event_rsvps') {
            idx = existing.findIndex(item =>
              String(item.player_id) === String(rec.player_id) &&
              String(item.reference_id) === String(rec.reference_id) &&
              String(item.occurrence_date) === String(rec.occurrence_date)
            );
          } else {
            idx = existing.findIndex(item => String(item.id) === String(rec.id));
          }

          const oldRecord = idx >= 0 ? { ...existing[idx] } : null;
          if (idx >= 0) {
            existing[idx] = { ...existing[idx], ...rec };
          } else {
            existing.push(rec);
          }

          eventsToFire.push({
            table,
            event: idx >= 0 ? 'UPDATE' : 'INSERT',
            payload: { new: rec, old: oldRecord }
          });

          if (table === 'fields' && rec.supports_halves !== undefined) {
            if (rec.supports_halves) {
              db.field_subunits = db.field_subunits || [];
              if (!db.field_subunits.some(s => String(s.field_id) === String(rec.id))) {
                db.field_subunits.push({ id: `sub-${rec.id}-a`, field_id: rec.id, label: 'A', organization_id: rec.organization_id || 'org-1' });
                db.field_subunits.push({ id: `sub-${rec.id}-b`, field_id: rec.id, label: 'B', organization_id: rec.organization_id || 'org-1' });
              }
            } else {
              db.field_subunits = (db.field_subunits || []).filter(s => {
                if (String(s.field_id) === String(rec.id)) {
                  triggerRealtimeEvent('field_subunits', 'DELETE', { new: null, old: s });
                  return false;
                }
                return true;
              });
            }
          }
        });

        db[table] = existing;
        saveDB(db);

        eventsToFire.forEach(e => triggerRealtimeEvent(e.table, e.event, e.payload));

        const res = { data: newRecords, error: null };
        const chainable = {
          select: () => chainable,
          single: () => Promise.resolve({ data: Array.isArray(records) ? newRecords[0] : newRecords, error: null }),
          maybeSingle: () => Promise.resolve({ data: Array.isArray(records) ? newRecords[0] : newRecords, error: null }),
          then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
        };
        return chainable;
      },
      update: (updates) => {
        return {
          eq: (col, val) => {
            const db = getDB();
            let updatedItem = null;
            if (db[table]) {
              db[table] = db[table].map(item => {
                if (String(item[col]) === String(val)) {
                  updatedItem = { ...item, ...updates };

                  if (table === 'games' && updates.score_home !== undefined) {
                    db.view_league_standings = db.view_league_standings || [];
                    const home = db.view_league_standings.find(s => String(s.team_id) === String(item.home_team_id));
                    const away = db.view_league_standings.find(s => String(s.team_id) === String(item.away_team_id));
                    if (home && away) {
                      const sh = Number(updates.score_home);
                      const sa = Number(updates.score_away);
                      if (!(isNaN(sh) || isNaN(sa) || updates.score_home === null || updates.score_away === null)) {
                        if (sh > sa) { home.wins++; away.losses++; home.points += 3; }
                        else if (sa > sh) { away.wins++; home.losses++; away.points += 3; }
                        else { home.draws++; away.draws++; home.points += 1; away.points += 1; }
                        home.games_played++; away.games_played++;
                        home.goals_for += sh; home.goals_against += sa;
                        away.goals_for += sa; away.goals_against += sh;
                        home.goal_differential += (sh - sa);
                        away.goal_differential += (sa - sh);
                      }
                    }
                  }

                  if (table === 'fields' && updates.supports_halves !== undefined) {
                    if (updates.supports_halves) {
                      db.field_subunits = db.field_subunits || [];
                      if (!db.field_subunits.some(s => String(s.field_id) === String(item.id))) {
                        const subA = { id: `sub-${item.id}-a`, field_id: item.id, label: 'A', organization_id: item.organization_id || 'org-1' };
                        const subB = { id: `sub-${item.id}-b`, field_id: item.id, label: 'B', organization_id: item.organization_id || 'org-1' };
                        db.field_subunits.push(subA, subB);
                        triggerRealtimeEvent('field_subunits', 'INSERT', { new: subA, old: null });
                        triggerRealtimeEvent('field_subunits', 'INSERT', { new: subB, old: null });
                      }
                    } else {
                      db.field_subunits = (db.field_subunits || []).filter(s => {
                        if (String(s.field_id) === String(item.id)) {
                          triggerRealtimeEvent('field_subunits', 'DELETE', { new: null, old: s });
                          return false;
                        }
                        return true;
                      });
                    }
                  }
                  return updatedItem;
                }
                return item;
              });
              saveDB(db);
            }
            const res = { data: updatedItem, error: null };
            const chainable = {
              select: () => chainable,
              single: () => Promise.resolve({ data: updatedItem, error: null }),
              maybeSingle: () => Promise.resolve({ data: updatedItem, error: null }),
              then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected)
            };
            return chainable;
          }
        };
      },
      delete: () => {
        return {
          eq: (col, val) => {
            const db = getDB();
            if (db[table]) {
              db[table] = db[table].filter(item => String(item[col]) !== String(val));
              saveDB(db);
            }
            return Promise.resolve({ data: [], error: null });
          }
        };
      }
    };
  },
  channel: (name) => {
    const table = name.split(':')[0];
    return {
      on: (type, config, callback) => {
        realtimeCallbacks.push({ table: config.table || table, event: config.event || '*', callback });
        return {
          subscribe: () => ({
            unsubscribe: () => {
              const idx = realtimeCallbacks.findIndex(cb => cb.callback === callback);
              if (idx >= 0) realtimeCallbacks.splice(idx, 1);
            }
          })
        };
      }
    };
  },
  removeChannel: (channel) => {
    if (channel && channel.unsubscribe) channel.unsubscribe();
  },
  rpc: async (name, params) => {
    const db = getDB();

    if (name === 'submit_registration') {
      const { p_organization_id, p_form_id, p_profile_id, p_responses, p_player_id, p_first_name, p_last_name } = params;

      let playerId = p_player_id;
      if (!playerId && p_first_name && p_last_name) {
        playerId = Math.random().toString(36).substr(2, 9);
        db.players.push({
          id: playerId,
          first_name: p_first_name,
          last_name: p_last_name,
          organization_id: p_organization_id
        });
        db.profile_players.push({
          profile_id: p_profile_id,
          player_id: playerId
        });
      }

      const registration = {
        id: Math.random().toString(36).substr(2, 9),
        organization_id: p_organization_id,
        form_id: p_form_id,
        player_id: playerId,
        profile_id: p_profile_id,
        responses: p_responses,
        waiver_signed: true,
        medical_cleared: false,
        created_at: new Date().toISOString()
      };

      db.registrations = db.registrations || [];
      db.registrations.push(registration);
      saveDB(db);

      return { data: registration.id, error: null };
    }

    return { data: null, error: { message: `Mock RPC ${name} not implemented` } };
  }
};
