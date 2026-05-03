/**
 * Mock Supabase Client
 * Extracted from supabaseClient.js for clean separation between mock (E2E/dev)
 * and real (staging/production) environments.
 *
 * This module provides a sessionStorage-backed in-memory database that mimics
 * the Supabase JS client API surface used by SquadLogic's hooks and pages.
 */
import { logger } from './logger.js';
import { HEADER_ALIASES } from '../utils/telemetryUtils.js';

// ── Mock Data Seed ──────────────────────────────────────────────────────────
const initialMockData = {
  organizations: [{ id: 'org-1', name: 'SquadLogic FC' }],
  audit_log: [
    {
      id: 'audit-1',
      organization_id: 'org-1',
      action: 'auth.password_updated',
      user_id: 'mock-admin-id',
      metadata: { user_id: 'mock-admin-id' },
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    {
      id: 'audit-2',
      organization_id: 'org-1',
      action: 'impersonation.started',
      user_id: 'mock-admin-id',
      metadata: { target_user_id: 'mock-coach-id', admin_email: 'admin@example.com' },
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 'audit-3',
      organization_id: 'org-1',
      action: 'settings.flags_updated',
      user_id: 'mock-coach-id',
      metadata: {
        impersonated_by: 'mock-admin-id',
        admin_email: 'admin@example.com',
        flags: { ADVANCED_FAIRNESS: true },
      },
      created_at: new Date(Date.now() - 1800000).toISOString(),
    },
  ],
  profiles: [
    {
      id: 'mock-admin-id',
      first_name: 'Mock',
      last_name: 'Admin',
      full_name: 'Mock Admin',
      email: import.meta.env.VITE_TEST_ADMIN_EMAIL || 'admin@example.com',
      role: 'admin',
    },
    {
      id: 'mock-coach-id',
      first_name: 'Mock',
      last_name: 'Coach',
      full_name: 'Mock Coach',
      email: import.meta.env.VITE_TEST_COACH_EMAIL || 'coach@example.com',
      role: 'coach',
    },
    {
      id: 'mock-parent-id',
      first_name: 'Mock',
      last_name: 'Parent',
      full_name: 'Mock Parent',
      email: 'parent@example.com',
      role: 'parent',
    },
  ],
  organization_members: [
    { organization_id: 'org-1', profile_id: 'mock-admin-id', role: 'admin' },
    { organization_id: 'org-1', profile_id: 'mock-coach-id', role: 'coach' },
  ],
  season_settings: [
    {
      id: 'season-1',
      organization_id: 'org-1',
      name: 'Fall 2024',
      status: 'active',
      season_start: '2025-01-01',
      season_end: '2025-12-31',
      timezone: 'America/Los_Angeles',
      school_day_end: '16:00',
      created_at: new Date().toISOString(),
    },
  ],
  divisions: [
    {
      id: 'u8-div-id',
      name: 'U8 Coed',
      organization_id: 'org-1',
      season_settings_id: 'season-1',
      max_roster_size: 10,
      min_roster_size: 7,
      target_team_size: 9,
      min_teams: 1,
      max_teams: 4,
    },
    {
      id: 'u10-div-id',
      name: 'U10 Girls',
      organization_id: 'org-1',
      season_settings_id: 'season-1',
      max_roster_size: 14,
      min_roster_size: 10,
      target_team_size: 12,
    },
  ],
  teams: [
    {
      id: 't1',
      name: 'Team A',
      division_id: 'u8-div-id',
      coach_id: 'mock-coach-id',
      organization_id: 'org-1',
    },
    {
      id: 't2',
      name: 'Team B',
      division_id: 'u8-div-id',
      coach_id: 'c2',
      organization_id: 'org-1',
    },
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Tigers',
      division_id: 'u8-div-id',
      organization_id: 'org-1',
      calendar_token: 'mock-calendar-token-tigers',
      calendar_token_expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    },
  ],
  team_players: [
    { team_id: '00000000-0000-0000-0000-000000000001', player_id: 'player-1' },
    { team_id: '00000000-0000-0000-0000-000000000001', player_id: 'player-2' },
  ],
  player_buddies: [],
  players: [
    {
      id: 'player-1',
      first_name: 'Alex',
      last_name: 'Smith',
      organization_id: 'org-1',
      team_id: '00000000-0000-0000-0000-000000000001',
      division_id: 'U8 Boys',
    },
    {
      id: 'player-2',
      first_name: 'Jamie',
      last_name: 'Jones',
      organization_id: 'org-1',
      team_id: '00000000-0000-0000-0000-000000000001',
      division_id: 'U8 Boys',
    },
  ],
  coaches: [
    {
      id: 'mock-coach-id',
      organization_id: 'org-1',
      profile_id: 'mock-coach-id',
      user_id: 'mock-coach-id',
      full_name: 'Mock Coach',
      email: import.meta.env.VITE_TEST_COACH_EMAIL || 'coach@example.com',
      phone: '555-0101',
      status: 'active',
      import_source: 'coach_import',
      last_imported_at: new Date(Date.now() - 7 * 86400000).toISOString(),
      can_coach_multiple_teams: true,
    },
    {
      id: 'c2',
      organization_id: 'org-1',
      full_name: 'Casey Rivera',
      email: 'casey.rivera@example.com',
      phone: '555-0102',
      status: 'active',
      import_source: 'coach_import',
      last_imported_at: new Date(Date.now() - 12 * 86400000).toISOString(),
      can_coach_multiple_teams: false,
    },
    {
      id: 'coach-lead-1',
      organization_id: 'org-1',
      full_name: 'Morgan Reyes',
      email: 'morgan.reyes@example.com',
      phone: '555-0103',
      status: 'interested',
      import_source: 'player_import_lead',
      last_imported_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      can_coach_multiple_teams: false,
    },
  ],
  coach_interested_programs: [
    {
      id: 'coach-interest-1',
      coach_id: 'coach-lead-1',
      division_id: 'u8-div-id',
      inferred_from_player_id: 'player-1',
      organization_id: 'org-1',
      created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
  ],
  profile_players: [
    { profile_id: 'mock-parent-id', player_id: 'player-1' },
    { profile_id: 'mock-parent-id', player_id: 'player-2' },
  ],
  practice_slots: [
    {
      id: 'ps-1',
      day_of_week: 'tue',
      start_time: '18:00',
      end_time: '19:30',
      capacity: 2,
      valid_from: '2025-01-01',
      valid_until: '2025-12-31',
      field_id: 'v1',
      organization_id: 'org-1',
    },
  ],
  practice_assignments: [
    {
      id: 'pa-1',
      team_id: '00000000-0000-0000-0000-000000000001',
      slot_id: 'ps-1',
      practice_slot_id: 'ps-1',
      run_id: 'run-practice-1',
      day_of_week: 'tue',
      start_time: '18:00',
      end_time: '19:30',
      field_id: 'v1',
      source: 'auto',
      effective_date_range: '[2025-01-01,2025-12-31)',
    },
  ],
  event_rsvps: [
    {
      id: 'rsvp-1',
      organization_id: 'org-1',
      team_id: '00000000-0000-0000-0000-000000000001',
      player_id: 'player-1',
      reference_id: 'pa-1',
      event_type: 'practice',
      occurrence_date: '2025-01-07',
      status: 'attending',
      updated_at: new Date().toISOString(),
    },
    {
      id: 'rsvp-2',
      organization_id: 'org-1',
      team_id: '00000000-0000-0000-0000-000000000001',
      player_id: 'player-2',
      reference_id: 'pa-1',
      event_type: 'practice',
      occurrence_date: '2025-01-07',
      status: 'pending',
      updated_at: new Date().toISOString(),
    },
  ],
  locations: [{ id: 'loc-1', name: 'Central Park' }],
  fields: [
    {
      id: 'v1',
      name: 'Field 1',
      location_id: 'loc-1',
      organization_id: 'org-1',
      active: true,
      surface_type: 'Grass',
      size: '11v11',
    },
    {
      id: 'v2',
      name: 'Field 2',
      location_id: 'loc-1',
      organization_id: 'org-1',
      active: true,
      surface_type: 'Turf',
      size: '7v7',
    },
  ],
  game_slots: [
    {
      id: 'gs-1',
      field_id: 'v1',
      start: '2026-04-04T08:00:00Z',
      end: '2026-04-04T09:00:00Z',
      capacity: 1,
      organization_id: 'org-1',
    },
    {
      id: 'gs-2',
      field_id: 'v1',
      start: '2026-04-04T09:30:00Z',
      end: '2026-04-04T10:30:00Z',
      capacity: 1,
      organization_id: 'org-1',
    },
    {
      id: 'gs-3',
      field_id: 'v2',
      start: '2026-04-04T08:00:00Z',
      end: '2026-04-04T09:00:00Z',
      capacity: 1,
      organization_id: 'org-1',
    },
    {
      id: 'gs-4',
      field_id: 'v2',
      start: '2026-04-04T09:30:00Z',
      end: '2026-04-04T10:30:00Z',
      capacity: 1,
      organization_id: 'org-1',
    },
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
      score_away: 1,
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
      score_away: null,
    },
  ],
  player_registrations: [
    {
      id: 'player-1',
      organization_id: 'org-1',
      season_id: 'season-1',
      first_name: 'Alex',
      last_name: 'Smith',
      status: 'Reviewing',
      gender: 'B',
      birth_year: 2015,
    },
    {
      id: 'player-2',
      organization_id: 'org-1',
      season_id: 'season-1',
      first_name: 'Sam',
      last_name: 'Jones',
      status: 'Approved',
      gender: 'G',
      birth_year: 2016,
    },
  ],
  registration_forms: [
    { id: 'f1', title: 'Spring 2026 Registration', status: 'active', organization_id: 'org-1' },
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
          { baseSlotId: 'slot_wed_1800', day: 'Wednesday', totalCapacity: 10, totalAssigned: 0 },
        ],
      },
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
        summary: { assignmentRate: 1.0, manualFollowUpRate: 0, unassignedTeams: 0 },
      },
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
            { id: 't2', name: 'Team B', division_id: 'U8 Boys', headCoach: 'Mock Coach' },
          ],
        },
        rosterBalanceByDivision: {
          'U8 Boys': {
            summary: { totalPlayers: 24, totalCapacity: 30, averageFillRate: 0.8 },
            teamStats: [
              { teamId: 't1', slotsRemaining: 3 },
              { teamId: 't2', slotsRemaining: 3 },
            ],
          },
        },
        coachCoverageByDivision: {
          'U8 Boys': { totalTeams: 2, teamsWithCoach: 2, coverageRate: 1.0 },
        },
      },
      started_at: new Date(Date.now() - 3600000).toISOString(),
      completed_at: new Date().toISOString(),
    },
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
      created_at: new Date().toISOString(),
    },
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
      last_updated: new Date().toISOString(),
    },
  ],
  imports: [
    {
      id: 'import-1',
      user_id: 'mock-admin-id',
      organization_id: 'org-1',
      import_type: 'players',
      data: {
        totalRows: 2,
        validRows: 2,
        data: [
          {
            'First Name': 'Alex',
            'Last Name': 'Smith',
            Birthdate: '2015-05-15',
            Gender: 'm',
            'Skill Level': 'advanced',
          },
          {
            'First Name': 'Sam',
            'Last Name': 'Jones',
            Birthdate: '2016-08-20',
            Gender: 'f',
            'Skill Level': 'developing',
          },
        ],
        fileName: 'mock_players.csv',
      },
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
  ],
  import_jobs: [],
  staging_players: [],
  staging_import_rows: [],
  import_application_records: [],
  view_league_standings: [
    {
      organization_id: 'org-1',
      team_id: 't1',
      team_name: 'Team A',
      division: 'U8 Coed',
      wins: 1,
      losses: 0,
      draws: 0,
      games_played: 1,
      goals_for: 2,
      goals_against: 1,
      goal_differential: 1,
      points: 3,
    },
    {
      organization_id: 'org-1',
      team_id: 't2',
      team_name: 'Team B',
      division: 'U8 Coed',
      wins: 0,
      losses: 1,
      draws: 0,
      games_played: 1,
      goals_for: 1,
      goals_against: 2,
      goal_differential: -1,
      points: 0,
    },
  ],
  view_org_metrics: [
    { organization_id: 'org-1', total_players: 150, total_teams: 12, total_users: 25 },
  ],
  view_compliance_stats: [
    {
      organization_id: 'org-1',
      form_title: 'Spring 2026 Registration',
      total_registrations: 45,
      medical_cleared: 38,
    },
  ],
};

// ── Realtime & Auth Event Plumbing ──────────────────────────────────────────
let mockSubscriptionCallback = null;
const realtimeCallbacks = [];
let pendingAuthEvents = [];

const triggerRealtimeEvent = (table, event, payload) => {
  logger.log(`[Mock Supabase] Triggering Realtime ${event} for ${table}`, payload);
  realtimeCallbacks.forEach((cb) => {
    if (cb.table === table && (cb.event === '*' || cb.event === event)) {
      // Include eventType in payload so Supabase Realtime subscription handlers can read it
      cb.callback({ ...payload, eventType: event });
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
          if (key === 'organization_members')
            return (
              String(r.organization_id) === String(record.organization_id) &&
              String(r.profile_id) === String(record.profile_id)
            );
          if (key === 'player_buddies')
            return (
              String(r.player_id) === String(record.player_id) &&
              String(r.buddy_player_id) === String(record.buddy_player_id)
            );
          if (key === 'view_org_metrics')
            return String(r.organization_id) === String(record.organization_id);
          if (key === 'view_compliance_stats')
            return String(r.form_title) === String(record.form_title);
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
  logger.log(
    '[Mock Supabase] DB Initialized. Tables:',
    Object.keys(/** @type {Object} */ (window.__MOCK_DB__))
      .map((k) => `${k}(${/** @type {any} */ (window.__MOCK_DB__)[k]?.length || 0})`)
      .join(', ')
  );
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
        if (
          (table === 'team_players' || table === 'profile_players') &&
          (queryContent.includes('players') || queryContent.includes('player'))
        ) {
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
        if (
          table === 'games' &&
          (queryContent.includes('home_team') || queryContent.includes('away_team'))
        ) {
          const teams = getMockData('teams');
          results = results.map((item) => ({
            ...item,
            home_team: teams.find((t) => String(t.id) === String(item.home_team_id)) || {
              id: item.home_team_id,
              name: 'Home Team',
              division: 'U10',
            },
            away_team: teams.find((t) => String(t.id) === String(item.away_team_id)) || {
              id: item.away_team_id,
              name: 'Away Team',
              division: 'U10',
            },
          }));
        }
        if (
          table === 'practice_assignments' &&
          (queryContent.includes('practice_slots') || queryContent.includes('teams'))
        ) {
          const slots = getMockData('practice_slots');
          const fields = getMockData('fields');
          const teams = getMockData('teams');
          const divisions = getMockData('divisions');

          results = results.map((item) => {
            const slot = slots.find((s) => String(s.id) === String(item.slot_id));
            const team = teams.find((t) => String(t.id) === String(item.team_id));

            let enrichedSlot = slot ? { ...slot } : null;
            if (enrichedSlot) {
              enrichedSlot.fields =
                fields.find((f) => String(f.id) === String(slot.field_id)) || null;
            }

            let enrichedTeam = team ? { ...team } : null;
            if (enrichedTeam) {
              enrichedTeam.divisions =
                divisions.find(
                  (d) =>
                    String(d.id) === String(team.division_id) ||
                    String(d.name) === String(team.division)
                ) || null;
            }

            return { ...item, practice_slots: enrichedSlot, teams: enrichedTeam };
          });
        }
      }
      return proxy;
    },
    eq: (col, val) => {
      results = results.filter((item) => {
        // Handle JSONB path navigation (e.g. 'metadata->user_id')
        if (col.includes('->')) {
          const parts = col.split('->');
          let current = item;
          for (const part of parts) {
            current = current?.[part];
          }
          return String(current) === String(val);
        }
        const itemVal = item[col] !== undefined ? String(item[col]) : 'undefined';
        return itemVal === String(val);
      });
      return proxy;
    },
    not: (col, op, val) => {
      results = results.filter((item) => {
        let current = item;
        if (col.includes('->')) {
          const parts = col.split('->');
          for (const part of parts) {
            current = current?.[part];
          }
        } else {
          current = item[col];
        }

        if (op === 'is' && val === null) {
          return current !== null && current !== undefined;
        }
        return String(current) !== String(val);
      });
      return proxy;
    },
    range: (from, to) => {
      results = results.slice(from, to + 1);
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
    or: (condition) => {
      const matchesClause = (item, { column, operator, value }) => {
        const current = item[column];
        if (operator === 'eq') return String(current) === String(value);
        if (operator === 'neq') return String(current) !== String(value);
        if (operator === 'is') {
          if (value === 'null') return current === null || current === undefined;
          if (value === 'not.null') return current !== null && current !== undefined;
          return String(current) === String(value);
        }
        if (operator === 'in') {
          const values = value
            .replace(/^\(/, '')
            .replace(/\)$/, '')
            .split(',')
            .map((entry) => entry.trim());
          return values.includes(String(current));
        }

        logger.warn(`[Mock Supabase] Unsupported OR operator "${operator}" in ${condition}`);
        return true;
      };

      const clauses = String(condition || '')
        .split(',')
        .map((clause) => clause.trim())
        .filter(Boolean)
        .map((clause) => {
          const [column, operator, ...valueParts] = clause.split('.');
          return {
            column,
            operator,
            value: valueParts.join('.'),
          };
        })
        .filter(({ column, operator, value }) => column && operator && value);

      if (clauses.length === 0) return proxy;

      results = results.filter(
        (item) =>
          clauses.every(({ column }) => !(column in item)) ||
          clauses.some((clause) => matchesClause(item, clause))
      );
      return proxy;
    },
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
    catch: (onRejected) =>
      Promise.resolve({ data: null, error: 'Mock error' }).then(null, onRejected),
  };
  return proxy;
};

// ── Mock Supabase Client ────────────────────────────────────────────────────

/** @type {any} */
export const mockSupabase = {
  auth: {
    signInWithPassword: async ({ email, password }) => {
      logger.log('[Mock Supabase] Login attempt:', email);
      const testPassword = import.meta.env.VITE_TEST_PASSWORD || 'test-password-123';
      if (password === testPassword) {
        const role = email.split('@')[0];
        const userId = `mock-${role}-id`;
        const session = {
          user: {
            id: userId,
            email,
            user_metadata: { full_name: `Mock ${role.charAt(0).toUpperCase() + role.slice(1)}` },
            app_metadata: { role: role === 'admin' || role === 'coach' ? role : 'parent' },
          },
          access_token: 'mock-token',
        };

        const db = (typeof window !== 'undefined' && window.__MOCK_DB__) || initialMockData;

        const typedDb = /** @type {any} */ (db);

        if (!typedDb.profiles.find((p) => p.id === userId)) {
          typedDb.profiles.push({
            id: userId,
            full_name: session.user.user_metadata.full_name,
            role: session.user.app_metadata.role,
          });
        }

        if (!typedDb.organization_members.find((m) => m.profile_id === userId)) {
          typedDb.organization_members.push({
            organization_id: 'org-1',
            profile_id: userId,
            role: session.user.app_metadata.role,
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
    signUp: async ({ email, password, options: _options }) => {
      if (password.length < 12) {
        return {
          data: { user: null, session: null },
          error: {
            message:
              'Database error: Password must be at least 12 characters long (Postgres Trigger Enforcement)',
          },
        };
      }
      // Simple mock signup
      return { data: { user: { id: 'new-user', email }, session: null }, error: null };
    },
    updateUser: async ({ password, data: _data }) => {
      if (password && password.length < 12) {
        return {
          data: { user: null },
          error: {
            message:
              'Database error: Password must be at least 12 characters long (Postgres Trigger Enforcement)',
          },
        };
      }
      return { data: { user: { id: 'mock-admin-id' } }, error: null };
    },
  },
  from: (table) => {
    const query = createMockQuery(table);
    return {
      ...query,
      insert: (records) => {
        const db = getDB();
        const newRecords = (Array.isArray(records) ? records : [records]).map((r) => {
          const id = r.id || Math.random().toString(36).substr(2, 9);
          if (table === 'fields' && r.supports_halves) {
            db.field_subunits = db.field_subunits || [];
            db.field_subunits.push({
              id: `sub-${id}-a`,
              field_id: id,
              label: 'A',
              organization_id: r.organization_id || 'org-1',
            });
            db.field_subunits.push({
              id: `sub-${id}-b`,
              field_id: id,
              label: 'B',
              organization_id: r.organization_id || 'org-1',
            });
          }
          return { id, created_at: new Date().toISOString(), ...r };
        });
        db[table] = [...(db[table] || []), ...newRecords];
        saveDB(db);
        const res = { data: Array.isArray(records) ? newRecords : newRecords[0], error: null };
        const chainable = {
          select: () => chainable,
          single: () =>
            Promise.resolve({
              data: newRecords[0] || null,
              error: null,
            }),
          maybeSingle: () =>
            Promise.resolve({
              data: newRecords[0] || null,
              error: null,
            }),
          then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected),
        };
        return chainable;
      },
      upsert: (records) => {
        const db = getDB();
        const newRecords = (Array.isArray(records) ? records : [records]).map((r) => ({
          id: r.id || Math.random().toString(36).substr(2, 9),
          created_at: r.created_at || new Date().toISOString(),
          ...r,
        }));
        const existing = db[table] || [];
        const eventsToFire = [];

        newRecords.forEach((rec) => {
          let idx = -1;
          if (table === 'event_rsvps') {
            idx = existing.findIndex(
              (item) =>
                String(item.player_id) === String(rec.player_id) &&
                String(item.reference_id) === String(rec.reference_id) &&
                String(item.occurrence_date) === String(rec.occurrence_date)
            );
          } else {
            idx = existing.findIndex((item) => String(item.id) === String(rec.id));
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
            payload: { new: rec, old: oldRecord },
          });

          if (table === 'fields' && rec.supports_halves !== undefined) {
            if (rec.supports_halves) {
              db.field_subunits = db.field_subunits || [];
              if (!db.field_subunits.some((s) => String(s.field_id) === String(rec.id))) {
                db.field_subunits.push({
                  id: `sub-${rec.id}-a`,
                  field_id: rec.id,
                  label: 'A',
                  organization_id: rec.organization_id || 'org-1',
                });
                db.field_subunits.push({
                  id: `sub-${rec.id}-b`,
                  field_id: rec.id,
                  label: 'B',
                  organization_id: rec.organization_id || 'org-1',
                });
              }
            } else {
              db.field_subunits = (db.field_subunits || []).filter((s) => {
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

        eventsToFire.forEach((e) => triggerRealtimeEvent(e.table, e.event, e.payload));

        const res = { data: newRecords, error: null };
        const chainable = {
          select: () => chainable,
          single: () =>
            Promise.resolve({
              data: newRecords[0] || null,
              error: null,
            }),
          maybeSingle: () =>
            Promise.resolve({
              data: newRecords[0] || null,
              error: null,
            }),
          then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected),
        };
        return chainable;
      },
      update: (updates) => {
        return {
          eq: (col, val) => {
            const db = getDB();
            let updatedItem = null;
            if (db[table]) {
              db[table] = db[table].map((item) => {
                if (String(item[col]) === String(val)) {
                  updatedItem = { ...item, ...updates };

                  if (table === 'games' && updates.score_home !== undefined) {
                    db.view_league_standings = db.view_league_standings || [];
                    const home = db.view_league_standings.find(
                      (s) => String(s.team_id) === String(item.home_team_id)
                    );
                    const away = db.view_league_standings.find(
                      (s) => String(s.team_id) === String(item.away_team_id)
                    );
                    if (home && away) {
                      const sh = Number(updates.score_home);
                      const sa = Number(updates.score_away);
                      if (
                        !(
                          isNaN(sh) ||
                          isNaN(sa) ||
                          updates.score_home === null ||
                          updates.score_away === null
                        )
                      ) {
                        if (sh > sa) {
                          home.wins++;
                          away.losses++;
                          home.points += 3;
                        } else if (sa > sh) {
                          away.wins++;
                          home.losses++;
                          away.points += 3;
                        } else {
                          home.draws++;
                          away.draws++;
                          home.points += 1;
                          away.points += 1;
                        }
                        home.games_played++;
                        away.games_played++;
                        home.goals_for += sh;
                        home.goals_against += sa;
                        away.goals_for += sa;
                        away.goals_against += sh;
                        home.goal_differential += sh - sa;
                        away.goal_differential += sa - sh;
                      }
                    }
                  }

                  if (table === 'fields' && updates.supports_halves !== undefined) {
                    if (updates.supports_halves) {
                      db.field_subunits = db.field_subunits || [];
                      if (!db.field_subunits.some((s) => String(s.field_id) === String(item.id))) {
                        const subA = {
                          id: `sub-${item.id}-a`,
                          field_id: item.id,
                          label: 'A',
                          organization_id: item.organization_id || 'org-1',
                        };
                        const subB = {
                          id: `sub-${item.id}-b`,
                          field_id: item.id,
                          label: 'B',
                          organization_id: item.organization_id || 'org-1',
                        };
                        db.field_subunits.push(subA, subB);
                        triggerRealtimeEvent('field_subunits', 'INSERT', { new: subA, old: null });
                        triggerRealtimeEvent('field_subunits', 'INSERT', { new: subB, old: null });
                      }
                    } else {
                      db.field_subunits = (db.field_subunits || []).filter((s) => {
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
              then: (onFulfilled, onRejected) => Promise.resolve(res).then(onFulfilled, onRejected),
            };
            return chainable;
          },
        };
      },
      delete: () => {
        return {
          eq: (col, val) => {
            const db = getDB();
            if (db[table]) {
              db[table] = db[table].filter((item) => String(item[col]) !== String(val));
              saveDB(db);
            }
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    };
  },
  channel: (name) => {
    const table = name.split(':')[0];
    return {
      on: (type, config, callback) => {
        realtimeCallbacks.push({
          table: config.table || table,
          event: config.event || '*',
          callback,
        });
        return {
          subscribe: () => ({
            unsubscribe: () => {
              const idx = realtimeCallbacks.findIndex((cb) => cb.callback === callback);
              if (idx >= 0) realtimeCallbacks.splice(idx, 1);
            },
          }),
        };
      },
      send: ({ type, event, payload }) => {
        logger.log(`[Mock Supabase] Broadcasting ${event} on channel ${name}`, payload);
        realtimeCallbacks.forEach((cb) => {
          // If the listener is for this channel name (or table) and event type
          if (cb.table === name || cb.table === table) {
            cb.callback({ event, payload, type });
          }
        });
        return Promise.resolve('ok');
      },
      subscribe: (statusCallback) => {
        if (statusCallback) setTimeout(() => statusCallback('SUBSCRIBED'), 0);
        return {
          unsubscribe: () => {
            // Cleanup if needed
          },
        };
      },
    };
  },
  removeChannel: (channel) => {
    if (channel && channel.unsubscribe) channel.unsubscribe();
  },
  rpc: async (name, params) => {
    const db = getDB();

    if (name === 'initialize_new_tenant') {
      const { p_name, p_slug, p_timezone, p_season_year } = params || {};
      const storedSession =
        typeof window !== 'undefined' ? sessionStorage.getItem('__MOCK_SESSION__') : null;
      const userId = storedSession ? JSON.parse(storedSession)?.user?.id : 'mock-admin-id';

      if (!userId) {
        return { data: null, error: { message: 'Not authenticated' } };
      }
      if (!p_name || typeof p_name !== 'string' || !p_name.trim()) {
        return { data: null, error: { message: 'Organization name is required' } };
      }
      if (
        !p_slug ||
        typeof p_slug !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p_slug.trim())
      ) {
        return { data: null, error: { message: 'Invalid slug format' } };
      }
      if (!p_timezone || typeof p_timezone !== 'string' || !p_timezone.trim()) {
        return { data: null, error: { message: 'Timezone is required' } };
      }
      if (!Number.isInteger(p_season_year) || p_season_year < 2000 || p_season_year > 3000) {
        return { data: null, error: { message: 'Invalid season year' } };
      }

      const normalizedSlug = p_slug.trim();
      const existing = (db.organizations || []).some(
        (org) => String(org.slug || '').toLowerCase() === normalizedSlug.toLowerCase()
      );
      if (existing) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
      }

      const orgId = crypto.randomUUID();
      const seasonId = crypto.randomUUID();
      db.organizations = db.organizations || [];
      db.organization_members = db.organization_members || [];
      db.season_settings = db.season_settings || [];
      db.audit_log = db.audit_log || [];

      db.organizations.push({
        id: orgId,
        name: p_name.trim(),
        slug: normalizedSlug,
        contact_info: { timezone: p_timezone.trim() },
      });
      db.organization_members.push({ organization_id: orgId, profile_id: userId, role: 'admin' });
      db.season_settings.push({
        id: seasonId,
        organization_id: orgId,
        name: `${p_season_year} Season`,
        status: 'active',
        season_year: p_season_year,
        season_label: `${p_season_year} Season`,
        created_at: new Date().toISOString(),
      });
      db.audit_log.push({
        id: crypto.randomUUID(),
        organization_id: orgId,
        action: 'settings.updated',
        user_id: userId,
        metadata: { action: 'initialization', creator: userId },
        created_at: new Date().toISOString(),
      });
      saveDB(db);
      return { data: orgId, error: null };
    }

    if (name === 'submit_registration') {
      const {
        p_organization_id,
        p_form_id,
        p_profile_id,
        p_responses,
        p_player_id,
        p_first_name,
        p_last_name,
      } = params;

      let playerId = p_player_id;
      if (!playerId && p_first_name && p_last_name) {
        playerId = Math.random().toString(36).substr(2, 9);
        db.players.push({
          id: playerId,
          first_name: p_first_name,
          last_name: p_last_name,
          organization_id: p_organization_id,
        });
        db.profile_players.push({
          profile_id: p_profile_id,
          player_id: playerId,
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
        created_at: new Date().toISOString(),
      };

      db.registrations = db.registrations || [];
      db.registrations.push(registration);
      saveDB(db);

      return { data: registration.id, error: null };
    }

    if (name === 'record_audit_event') {
      const { p_organization_id, p_action, p_user_id, p_metadata } = params;

      const event = {
        id: Math.random().toString(36).substr(2, 9),
        organization_id: p_organization_id,
        action: p_action,
        user_id: p_user_id,
        metadata: p_metadata,
        created_at: new Date().toISOString(),
      };

      db.audit_log = db.audit_log || [];
      db.audit_log.push(event);
      saveDB(db);

      logger.log(`[Mock Supabase] Audit event recorded: ${p_action}`, event);
      return { data: true, error: null };
    }

    if (name === 'rotate_calendar_token') {
      const newToken = 'mock-calendar-token-' + Math.random().toString(36).substr(2, 8);
      const teamId = params?.p_team_id;
      if (teamId) {
        const teams = db.teams || [];
        const team = teams.find((t) => String(t.id) === String(teamId));
        if (team) {
          team.calendar_token = newToken;
          team.calendar_token_expires_at = new Date(Date.now() + 90 * 86400000).toISOString();
          saveDB(db);
        }
      }
      return {
        data: { status: 'ok', calendar_token: newToken, message: 'Token rotated' },
        error: null,
      };
    }

    if (name === 'update_org_feature_flags') {
      return { data: true, error: null };
    }

    if (name === 'log_telemetry_event') {
      return { data: true, error: null };
    }

    if (name === 'finalize_onboarding') {
      return { data: true, error: null };
    }

    if (name === 'get_settings_audit_log') {
      const logs = (db.audit_log || [])
        .filter((e) => String(e.organization_id) === String(params?.p_organization_id))
        .map((e) => ({
          actor_name: 'Mock Admin',
          actor_email: 'admin@example.com',
          action: e.action,
          metadata: e.metadata,
          created_at: e.created_at,
        }));
      return { data: logs, error: null };
    }

    if (name === 'finalize_import_job') {
      const { p_import_job_id, p_validation_errors } = params || {};
      const job = (db.import_jobs || []).find(
        (item) => String(item.id) === String(p_import_job_id)
      );
      if (!job) {
        return { data: null, error: { message: 'Import job not found' } };
      }

      const validationErrors = Array.isArray(p_validation_errors) ? p_validation_errors : [];
      const now = new Date().toISOString();
      const stagedRows = (db.staging_players || []).filter(
        (row) => String(row.import_job_id) === String(p_import_job_id) && !row.promoted_at
      );

      let insertedPlayers = 0;
      let updatedPlayers = 0;
      db.players = db.players || [];

      stagedRows.forEach((row) => {
        const payload = row.normalized_payload || {};
        const externalId =
          payload.external_registration_id ||
          payload.gotsport_id ||
          payload.registration_id ||
          payload.player_id ||
          null;
        const division = (db.divisions || []).find(
          (item) =>
            String(item.organization_id) === String(job.organization_id) &&
            String(item.name).toLowerCase() === String(payload.division_name || '').toLowerCase()
        );
        const existing =
          externalId &&
          db.players.find(
            (player) =>
              String(player.organization_id) === String(job.organization_id) &&
              String(player.external_registration_id) === String(externalId)
          );
        const willingToCoach = [
          'true',
          't',
          'yes',
          'y',
          '1',
          'coach',
          'head coach',
          'assistant coach',
          'volunteer',
          'willing',
        ].includes(String(payload.willing_to_coach || '').toLowerCase());
        const basePlayer = {
          organization_id: job.organization_id,
          division_id: division?.id || payload.division_id || existing?.division_id || null,
          first_name: payload.first_name,
          last_name: payload.last_name,
          preferred_name: payload.preferred_name || payload.nickname || null,
          external_registration_id: externalId,
          date_of_birth: payload.date_of_birth,
          grade: payload.grade || null,
          gender: payload.gender || null,
          birth_year: payload.date_of_birth
            ? Number.parseInt(String(payload.date_of_birth).slice(0, 4), 10)
            : null,
          skill_tier: ['novice', 'developing', 'advanced'].includes(
            String(payload.skill_tier || '').toLowerCase()
          )
            ? String(payload.skill_tier).toLowerCase()
            : null,
          coach_volunteer: willingToCoach,
          willing_to_coach: willingToCoach,
          buddy_request: payload.buddy_request || null,
          mutual_buddy_code: payload.mutual_buddy_code || payload.buddy_code || null,
          import_source: 'gotsport',
          last_imported_at: now,
        };

        if (existing) {
          Object.assign(existing, basePlayer);
          updatedPlayers += 1;
        } else {
          db.players.push({
            id: Math.random().toString(36).substr(2, 9),
            created_at: now,
            ...basePlayer,
          });
          insertedPlayers += 1;
        }

        row.promoted_at = now;
        row.promoted_by = 'mock-admin-id';
      });

      const status = validationErrors.length > 0 ? 'completed_with_warnings' : 'completed';
      Object.assign(job, {
        status,
        processed_rows: stagedRows.length,
        progress_percent: 100,
        completed_at: now,
        error_summary: { rowErrors: validationErrors },
        warning_summary: {
          ...(job.warning_summary || {}),
          finalize: {
            staged_rows: stagedRows.length,
            valid_staged_rows: stagedRows.length,
            promoted_rows: stagedRows.length,
            inserted_players: insertedPlayers,
            updated_players: updatedPlayers,
            validation_error_rows: validationErrors.length,
            status,
            total_promoted_rows: (db.staging_players || []).filter(
              (row) => String(row.import_job_id) === String(p_import_job_id) && row.promoted_at
            ).length,
          },
        },
      });

      saveDB(db);
      return { data: job.warning_summary.finalize, error: null };
    }

    if (name === 'materialize_import_buddy_pairs') {
      const { p_import_job_id } = params || {};
      const job = (db.import_jobs || []).find(
        (item) => String(item.id) === String(p_import_job_id)
      );
      if (!job) {
        return { data: null, error: { message: 'Import job not found' } };
      }
      if (job.job_type !== 'registration') {
        return { data: null, error: { message: 'Import job is not registration' } };
      }

      const normalizeKey = (value) =>
        String(value || '')
          .trim()
          .toLowerCase();
      const readPayload = (payload, keys) => {
        for (const key of keys) {
          const value = payload?.[key];
          if (value !== undefined && String(value).trim() !== '') return String(value).trim();
        }
        return '';
      };
      const promotedRows = (db.staging_players || []).filter(
        (row) =>
          String(row.import_job_id) === String(p_import_job_id) &&
          String(row.organization_id) === String(job.organization_id) &&
          row.promoted_at
      );
      const promotedPayloads = promotedRows.map((row) => {
        const payload = row.normalized_payload || {};
        return {
          row,
          externalKey: normalizeKey(
            readPayload(payload, [
              'external_registration_id',
              'gotsport_id',
              'registration_id',
              'player_id',
            ])
          ),
          buddyRequestKey: normalizeKey(
            readPayload(payload, [
              'buddy_request',
              'buddy_id',
              'buddy_external_registration_id',
              'buddy_registration_id',
              'friend_request',
            ])
          ),
          mutualCodeKey: normalizeKey(
            readPayload(payload, ['mutual_buddy_code', 'buddy_code', 'friend_code'])
          ),
        };
      });
      const matchedSources = promotedPayloads
        .map((source) => {
          const player = (db.players || []).find(
            (item) =>
              String(item.organization_id) === String(job.organization_id) &&
              normalizeKey(item.external_registration_id) === source.externalKey
          );
          if (!player || (!source.buddyRequestKey && !source.mutualCodeKey)) return null;
          return {
            ...source,
            playerId: player.id,
            divisionId: player.division_id || null,
          };
        })
        .filter(Boolean);
      const byExternalKey = new Map(matchedSources.map((source) => [source.externalKey, source]));
      const pairKeys = new Map();
      let unmatchedRequestRows = 0;
      let selfRequestRows = 0;
      let nonreciprocalRequestRows = 0;
      let crossDivisionRequestRows = 0;

      matchedSources.forEach((source) => {
        if (!source.buddyRequestKey) return;
        const buddy = byExternalKey.get(source.buddyRequestKey);
        if (!buddy) {
          unmatchedRequestRows += 1;
          return;
        }
        if (String(buddy.playerId) === String(source.playerId)) {
          selfRequestRows += 1;
          return;
        }
        if (buddy.buddyRequestKey !== source.externalKey) {
          nonreciprocalRequestRows += 1;
          return;
        }
        if (String(buddy.divisionId || '') !== String(source.divisionId || '')) {
          crossDivisionRequestRows += 1;
          return;
        }
        const ids = [source.playerId, buddy.playerId].sort();
        pairKeys.set(ids.join(':'), ids);
      });

      const codeGroups = new Map();
      matchedSources.forEach((source) => {
        if (!source.mutualCodeKey) return;
        const group = codeGroups.get(source.mutualCodeKey) || [];
        group.push(source);
        codeGroups.set(source.mutualCodeKey, group);
      });

      let invalidCodeGroups = 0;
      for (const group of codeGroups.values()) {
        const uniqueByPlayer = Array.from(
          new Map(group.map((source) => [String(source.playerId), source])).values()
        );
        const divisions = new Set(uniqueByPlayer.map((source) => String(source.divisionId || '')));
        if (uniqueByPlayer.length !== 2 || divisions.size !== 1) {
          invalidCodeGroups += 1;
          continue;
        }
        const ids = uniqueByPlayer.map((source) => source.playerId).sort();
        pairKeys.set(ids.join(':'), ids);
      }

      db.player_buddies = db.player_buddies || [];
      let insertedRelationships = 0;
      for (const ids of pairKeys.values()) {
        const directional = [
          { player_id: ids[0], buddy_player_id: ids[1] },
          { player_id: ids[1], buddy_player_id: ids[0] },
        ];
        directional.forEach((relationship) => {
          const exists = db.player_buddies.some(
            (item) =>
              String(item.player_id) === String(relationship.player_id) &&
              String(item.buddy_player_id) === String(relationship.buddy_player_id)
          );
          if (!exists) {
            db.player_buddies.push({
              ...relationship,
              organization_id: job.organization_id,
              source_import_job: p_import_job_id,
              is_mutual: true,
              created_at: new Date().toISOString(),
            });
            insertedRelationships += 1;
          }
        });
      }

      const requestedRows = matchedSources.length;
      const missingExternalIdRows = promotedPayloads.filter(
        (source) => (source.buddyRequestKey || source.mutualCodeKey) && !source.externalKey
      ).length;
      const unmatchedPromotedRows = promotedPayloads.filter(
        (source) =>
          source.externalKey &&
          (source.buddyRequestKey || source.mutualCodeKey) &&
          !matchedSources.some((matched) => matched.externalKey === source.externalKey)
      ).length;
      const warningCount =
        missingExternalIdRows +
        unmatchedPromotedRows +
        unmatchedRequestRows +
        selfRequestRows +
        nonreciprocalRequestRows +
        crossDivisionRequestRows +
        invalidCodeGroups;
      const candidateRelationships = pairKeys.size * 2;
      const result = {
        status: warningCount > 0 ? 'completed_with_warnings' : 'completed',
        promoted_rows: promotedPayloads.length,
        requested_rows: requestedRows,
        materialized_pairs: pairKeys.size,
        candidate_relationships: candidateRelationships,
        inserted_relationships: insertedRelationships,
        existing_relationships: candidateRelationships - insertedRelationships,
        missing_external_id_rows: missingExternalIdRows,
        unmatched_promoted_rows: unmatchedPromotedRows,
        unmatched_request_rows: unmatchedRequestRows,
        self_request_rows: selfRequestRows,
        nonreciprocal_request_rows: nonreciprocalRequestRows,
        cross_division_request_rows: crossDivisionRequestRows,
        invalid_code_groups: invalidCodeGroups,
      };

      Object.assign(job, {
        status: warningCount > 0 ? 'completed_with_warnings' : job.status,
        warning_summary: {
          ...(job.warning_summary || {}),
          buddy_pairs: result,
        },
      });
      db.audit_log = db.audit_log || [];
      db.audit_log.push({
        id: 'audit-buddy-' + Math.random().toString(36).substr(2, 9),
        organization_id: job.organization_id,
        action: 'import.completed',
        user_id: 'mock-admin-id',
        resource_type: 'import_job',
        resource_id: p_import_job_id,
        metadata: { ...result, stage: 'buddy_pairs' },
        created_at: new Date().toISOString(),
      });
      saveDB(db);
      return { data: result, error: null };
    }

    if (name === 'finalize_coach_import_job') {
      const { p_import_job_id, p_validation_errors } = params || {};
      const job = (db.import_jobs || []).find(
        (item) => String(item.id) === String(p_import_job_id)
      );
      if (!job) {
        return { data: null, error: { message: 'Import job not found' } };
      }

      const validationErrors = Array.isArray(p_validation_errors) ? p_validation_errors : [];
      const now = new Date().toISOString();
      const stagedRows = (db.staging_import_rows || []).filter(
        (row) =>
          String(row.import_job_id) === String(p_import_job_id) &&
          row.import_type === 'coaches' &&
          !row.applied_at &&
          (!row.validation_errors || row.validation_errors.length === 0)
      );

      db.coaches = db.coaches || [];
      db.import_application_records = db.import_application_records || [];

      let insertedCoaches = 0;
      let updatedCoaches = 0;
      let invalidRows = 0;
      let crossOrgConflictRows = 0;

      stagedRows.forEach((row) => {
        const payload = row.normalized_payload || {};
        const email = String(payload.email || '')
          .trim()
          .toLowerCase();
        const fullName = String(payload.full_name || '').trim();
        const status = String(payload.status || 'active').toLowerCase();

        if (
          !email ||
          !fullName ||
          !['active', 'pending-confirmation', 'inactive'].includes(status)
        ) {
          invalidRows += 1;
          row.validation_errors = [
            {
              message: 'Coach row is missing full_name/email or has an invalid status',
              source_row_number: row.source_row_number,
            },
          ];
          return;
        }

        const existing = db.coaches.find(
          (coach) => String(coach.email || '').toLowerCase() === email
        );
        if (existing && String(existing.organization_id) !== String(job.organization_id)) {
          crossOrgConflictRows += 1;
          row.validation_errors = [
            {
              message: 'Coach email already belongs to another organization',
              source_row_number: row.source_row_number,
            },
          ];
          return;
        }

        if (existing) {
          const previous = { ...existing };
          const canCoachMultipleTeams =
            payload.can_coach_multiple_teams === undefined
              ? Boolean(existing.can_coach_multiple_teams)
              : ['true', 'yes', '1', 'y'].includes(
                  String(payload.can_coach_multiple_teams || '').toLowerCase()
                );
          Object.assign(existing, {
            full_name: fullName,
            email,
            phone: payload.phone || payload.contact_phone || null,
            status,
            can_coach_multiple_teams: canCoachMultipleTeams,
            contact_info: {
              email,
              phone: payload.phone || payload.contact_phone || null,
            },
            import_source: 'coach_csv',
            last_imported_at: now,
            custom_attributes: payload,
            updated_at: now,
          });
          db.import_application_records.push({
            id: Math.random().toString(36).substr(2, 9),
            organization_id: job.organization_id,
            import_job_id: p_import_job_id,
            import_type: 'coaches',
            target_table: 'coaches',
            target_id: existing.id,
            operation: 'updated',
            previous_payload: previous,
            applied_payload: { ...existing },
            applied_at: now,
            applied_by: 'mock-admin-id',
            rolled_back_at: null,
          });
          updatedCoaches += 1;
        } else {
          const coach = {
            id: Math.random().toString(36).substr(2, 9),
            organization_id: job.organization_id,
            full_name: fullName,
            email,
            phone: payload.phone || payload.contact_phone || null,
            status,
            can_coach_multiple_teams: ['true', 'yes', '1', 'y'].includes(
              String(payload.can_coach_multiple_teams || '').toLowerCase()
            ),
            contact_info: {
              email,
              phone: payload.phone || payload.contact_phone || null,
            },
            import_source: 'coach_csv',
            last_imported_at: now,
            custom_attributes: payload,
            created_at: now,
            updated_at: now,
          };
          db.coaches.push(coach);
          db.import_application_records.push({
            id: Math.random().toString(36).substr(2, 9),
            organization_id: job.organization_id,
            import_job_id: p_import_job_id,
            import_type: 'coaches',
            target_table: 'coaches',
            target_id: coach.id,
            operation: 'inserted',
            previous_payload: null,
            applied_payload: { ...coach },
            applied_at: now,
            applied_by: 'mock-admin-id',
            rolled_back_at: null,
          });
          insertedCoaches += 1;
        }

        row.applied_at = now;
        row.applied_by = 'mock-admin-id';
      });

      const status =
        validationErrors.length > 0 || invalidRows > 0 || crossOrgConflictRows > 0
          ? 'completed_with_warnings'
          : 'completed';
      const result = {
        status,
        staged_rows: (db.staging_import_rows || []).filter(
          (row) =>
            String(row.import_job_id) === String(p_import_job_id) && row.import_type === 'coaches'
        ).length,
        inserted_coaches: insertedCoaches,
        updated_coaches: updatedCoaches,
        invalid_rows: invalidRows,
        cross_org_conflict_rows: crossOrgConflictRows,
        blocked_assignment_rows: 0,
        validation_error_rows: validationErrors.length,
        total_applied_rows: (db.import_application_records || []).filter(
          (record) =>
            String(record.import_job_id) === String(p_import_job_id) &&
            record.import_type === 'coaches'
        ).length,
      };

      Object.assign(job, {
        status,
        processed_rows: result.total_applied_rows,
        progress_percent: 100,
        completed_at: now,
        error_summary: { rowErrors: validationErrors },
        warning_summary: {
          ...(job.warning_summary || {}),
          coach_finalize: result,
        },
      });

      saveDB(db);
      return { data: result, error: null };
    }

    if (name === 'rollback_coach_import_job') {
      const { p_import_job_id } = params || {};
      const job = (db.import_jobs || []).find(
        (item) => String(item.id) === String(p_import_job_id)
      );
      if (!job) {
        return { data: null, error: { message: 'Import job not found' } };
      }

      const now = new Date().toISOString();
      const records = (db.import_application_records || []).filter(
        (record) =>
          String(record.import_job_id) === String(p_import_job_id) &&
          record.import_type === 'coaches' &&
          !record.rolled_back_at
      );
      if (records.length === 0) {
        return {
          data: null,
          error: { message: 'Import job has no coach application records to roll back' },
        };
      }

      let deletedCoaches = 0;
      let restoredCoaches = 0;

      records
        .slice()
        .reverse()
        .forEach((record) => {
          if (record.operation === 'inserted') {
            db.coaches = (db.coaches || []).filter(
              (coach) => String(coach.id) !== String(record.target_id)
            );
            deletedCoaches += 1;
          } else if (record.operation === 'updated') {
            const coach = (db.coaches || []).find(
              (item) => String(item.id) === String(record.target_id)
            );
            if (coach && record.previous_payload) {
              Object.assign(coach, record.previous_payload, { updated_at: now });
              restoredCoaches += 1;
            }
          }
          record.rolled_back_at = now;
          record.rolled_back_by = 'mock-admin-id';
        });

      const result = {
        status: 'rolled_back',
        deleted_coaches: deletedCoaches,
        restored_coaches: restoredCoaches,
        blocked_assigned_coaches: 0,
      };
      Object.assign(job, {
        status: 'needs_fix',
        warning_summary: {
          ...(job.warning_summary || {}),
          coach_rollback: result,
        },
      });

      saveDB(db);
      return { data: result, error: null };
    }

    if (name === 'finalize_field_import_job') {
      const { p_import_job_id, p_validation_errors } = params || {};
      const job = (db.import_jobs || []).find(
        (item) => String(item.id) === String(p_import_job_id)
      );
      if (!job) {
        return { data: null, error: { message: 'Import job not found' } };
      }

      const validationErrors = Array.isArray(p_validation_errors) ? p_validation_errors : [];
      const now = new Date().toISOString();
      const stagedRows = (db.staging_import_rows || []).filter(
        (row) =>
          String(row.import_job_id) === String(p_import_job_id) &&
          row.import_type === 'fields' &&
          !row.applied_at &&
          (!row.validation_errors || row.validation_errors.length === 0)
      );

      db.locations = db.locations || [];
      db.fields = db.fields || [];
      db.field_subunits = db.field_subunits || [];
      db.practice_slots = db.practice_slots || [];
      db.game_slots = db.game_slots || [];
      db.import_application_records = db.import_application_records || [];

      let insertedLocations = 0;
      let insertedFields = 0;
      let insertedSubunits = 0;
      let insertedPracticeSlots = 0;
      let insertedGameSlots = 0;
      let invalidRows = 0;

      const makeId = () => Math.random().toString(36).substr(2, 9);
      const boolFromText = (value, fallback = false) => {
        if (value === undefined || value === null || value === '') return fallback;
        return ['true', 't', 'yes', 'y', '1'].includes(String(value).trim().toLowerCase());
      };
      const ledger = (targetTable, target, operation, previousPayload = null) => {
        if (
          db.import_application_records.some(
            (record) =>
              String(record.import_job_id) === String(p_import_job_id) &&
              record.target_table === targetTable &&
              String(record.target_id) === String(target.id)
          )
        ) {
          return;
        }
        db.import_application_records.push({
          id: makeId(),
          organization_id: job.organization_id,
          import_job_id: p_import_job_id,
          import_type: 'fields',
          target_table: targetTable,
          target_id: target.id,
          operation,
          previous_payload: previousPayload,
          applied_payload: { ...target },
          applied_at: now,
          applied_by: 'mock-admin-id',
          rolled_back_at: null,
        });
      };

      stagedRows.forEach((row) => {
        const payload = row.normalized_payload || {};
        const locationName = String(payload.location || payload.location_name || '').trim();
        const fieldName = String(payload.name || payload.field || payload.field_name || '').trim();
        const slotType = String(payload.type || payload.slot_type || '').toLowerCase();
        const start = String(payload.start || payload.start_time || '').trim();
        const end = String(payload.end || payload.end_time || '').trim();
        const day = String(payload.day || payload.day_of_week || '')
          .trim()
          .toLowerCase();
        const validFrom = payload.valid_from || payload.start_date || '';
        const validUntil = payload.valid_until || payload.end_date || '';
        const slotDate = payload.slot_date || payload.date || validFrom || '';

        if (
          !locationName ||
          !fieldName ||
          !['practice', 'game'].includes(slotType) ||
          !start ||
          !end ||
          (slotType === 'practice' && (!day || !validFrom || !validUntil)) ||
          (slotType === 'game' && !slotDate)
        ) {
          invalidRows += 1;
          row.validation_errors = [
            {
              message:
                'Field row is missing required location/field/slot data or has an invalid slot window',
              source_row_number: row.source_row_number,
            },
          ];
          return;
        }

        let location = db.locations.find(
          (item) =>
            String(item.organization_id) === String(job.organization_id) &&
            String(item.name || '').toLowerCase() === locationName.toLowerCase()
        );
        if (!location) {
          location = {
            id: makeId(),
            organization_id: job.organization_id,
            name: locationName,
            address: payload.address || null,
            lighting_available: boolFromText(payload.lighting_available, false),
            created_at: now,
            updated_at: now,
          };
          db.locations.push(location);
          ledger('locations', location, 'inserted');
          insertedLocations += 1;
        }

        let field = db.fields.find(
          (item) =>
            String(item.organization_id) === String(job.organization_id) &&
            String(item.location_id) === String(location.id) &&
            String(item.name || '').toLowerCase() === fieldName.toLowerCase()
        );
        if (!field) {
          field = {
            id: makeId(),
            organization_id: job.organization_id,
            location_id: location.id,
            name: fieldName,
            surface_type: payload.surface_type || payload.surface || null,
            size: payload.size || null,
            supports_halves:
              Boolean(payload.subunit) || boolFromText(payload.supports_halves, false),
            max_age: payload.max_age || null,
            priority_rating: Number.parseInt(String(payload.priority_rating || '1'), 10) || 1,
            active: boolFromText(payload.active, true),
            created_at: now,
            updated_at: now,
          };
          db.fields.push(field);
          ledger('fields', field, 'inserted');
          insertedFields += 1;
        }

        let subunit = null;
        if (payload.subunit) {
          subunit = db.field_subunits.find(
            (item) =>
              String(item.field_id) === String(field.id) &&
              String(item.label || '').toLowerCase() === String(payload.subunit).toLowerCase()
          );
          if (!subunit) {
            subunit = {
              id: makeId(),
              organization_id: job.organization_id,
              field_id: field.id,
              label: String(payload.subunit),
              created_at: now,
              updated_at: now,
            };
            db.field_subunits.push(subunit);
            ledger('field_subunits', subunit, 'inserted');
            insertedSubunits += 1;
          }
        }

        if (slotType === 'practice') {
          const slot = {
            id: makeId(),
            organization_id: job.organization_id,
            field_id: field.id,
            field_subunit_id: subunit?.id || null,
            day_of_week: day.slice(0, 3),
            start_time: start,
            end_time: end,
            capacity: Number.parseInt(String(payload.capacity || '1'), 10) || 1,
            valid_from: validFrom,
            valid_until: validUntil,
            label: payload.label || null,
            created_at: now,
            updated_at: now,
          };
          db.practice_slots.push(slot);
          ledger('practice_slots', slot, 'inserted');
          insertedPracticeSlots += 1;
        } else {
          const slot = {
            id: makeId(),
            organization_id: job.organization_id,
            field_id: field.id,
            division_id: payload.division_id || null,
            slot_date: slotDate,
            start_time: start,
            end_time: end,
            week_index: Number.parseInt(String(payload.week_index || '1'), 10) || 1,
            capacity: Number.parseInt(String(payload.capacity || '1'), 10) || 1,
            created_at: now,
            updated_at: now,
          };
          db.game_slots.push(slot);
          ledger('game_slots', slot, 'inserted');
          insertedGameSlots += 1;
        }

        row.applied_at = now;
        row.applied_by = 'mock-admin-id';
      });

      const status =
        validationErrors.length > 0 || invalidRows > 0 ? 'completed_with_warnings' : 'completed';
      const result = {
        status,
        staged_rows: (db.staging_import_rows || []).filter(
          (row) =>
            String(row.import_job_id) === String(p_import_job_id) && row.import_type === 'fields'
        ).length,
        inserted_locations: insertedLocations,
        updated_locations: 0,
        inserted_fields: insertedFields,
        updated_fields: 0,
        inserted_field_subunits: insertedSubunits,
        inserted_practice_slots: insertedPracticeSlots,
        updated_practice_slots: 0,
        inserted_game_slots: insertedGameSlots,
        updated_game_slots: 0,
        invalid_rows: invalidRows,
        validation_error_rows: validationErrors.length,
        total_applied_rows: (db.import_application_records || []).filter(
          (record) =>
            String(record.import_job_id) === String(p_import_job_id) &&
            record.import_type === 'fields'
        ).length,
      };

      Object.assign(job, {
        status,
        processed_rows: result.total_applied_rows,
        progress_percent: 100,
        completed_at: now,
        error_summary: { rowErrors: validationErrors },
        warning_summary: {
          ...(job.warning_summary || {}),
          field_finalize: result,
        },
      });

      saveDB(db);
      return { data: result, error: null };
    }

    if (name === 'rollback_field_import_job') {
      const { p_import_job_id } = params || {};
      const job = (db.import_jobs || []).find(
        (item) => String(item.id) === String(p_import_job_id)
      );
      if (!job) {
        return { data: null, error: { message: 'Import job not found' } };
      }

      const now = new Date().toISOString();
      const records = (db.import_application_records || []).filter(
        (record) =>
          String(record.import_job_id) === String(p_import_job_id) &&
          record.import_type === 'fields' &&
          !record.rolled_back_at
      );
      if (records.length === 0) {
        return {
          data: null,
          error: { message: 'Import job has no field application records to roll back' },
        };
      }

      let deletedLocations = 0;
      let deletedFields = 0;
      let deletedSubunits = 0;
      let deletedPracticeSlots = 0;
      let deletedGameSlots = 0;
      const order = {
        game_slots: 1,
        practice_slots: 2,
        field_subunits: 3,
        fields: 4,
        locations: 5,
      };

      records
        .slice()
        .sort((a, b) => (order[a.target_table] || 99) - (order[b.target_table] || 99))
        .forEach((record) => {
          if (record.operation === 'inserted') {
            if (record.target_table === 'game_slots') {
              db.game_slots = (db.game_slots || []).filter(
                (item) => String(item.id) !== String(record.target_id)
              );
              deletedGameSlots += 1;
            } else if (record.target_table === 'practice_slots') {
              db.practice_slots = (db.practice_slots || []).filter(
                (item) => String(item.id) !== String(record.target_id)
              );
              deletedPracticeSlots += 1;
            } else if (record.target_table === 'field_subunits') {
              db.field_subunits = (db.field_subunits || []).filter(
                (item) => String(item.id) !== String(record.target_id)
              );
              deletedSubunits += 1;
            } else if (record.target_table === 'fields') {
              db.fields = (db.fields || []).filter(
                (item) => String(item.id) !== String(record.target_id)
              );
              deletedFields += 1;
            } else if (record.target_table === 'locations') {
              db.locations = (db.locations || []).filter(
                (item) => String(item.id) !== String(record.target_id)
              );
              deletedLocations += 1;
            }
          }
          record.rolled_back_at = now;
          record.rolled_back_by = 'mock-admin-id';
        });

      const result = {
        status: 'rolled_back',
        deleted_locations: deletedLocations,
        deleted_fields: deletedFields,
        deleted_field_subunits: deletedSubunits,
        deleted_practice_slots: deletedPracticeSlots,
        deleted_game_slots: deletedGameSlots,
        restored_records: 0,
        blocked_records: 0,
      };
      Object.assign(job, {
        status: 'needs_fix',
        warning_summary: {
          ...(job.warning_summary || {}),
          field_rollback: result,
        },
      });

      saveDB(db);
      return { data: result, error: null };
    }

    if (name === 'set_import_job_coach_lead_summary') {
      const { p_import_job_id, p_summary, p_status } = params || {};
      const job = (db.import_jobs || []).find(
        (item) => String(item.id) === String(p_import_job_id)
      );
      if (!job) {
        return { data: null, error: { message: 'Import job not found' } };
      }

      job.warning_summary = {
        ...(job.warning_summary || {}),
        coach_leads: p_summary || {},
      };
      if (p_status) job.status = p_status;
      saveDB(db);
      return { data: true, error: null };
    }

    if (name === 'upsert_coach_leads') {
      const leads = Array.isArray(params?.p_leads) ? params.p_leads : null;
      if (!leads) {
        return { data: null, error: { message: 'p_leads must be an array' } };
      }

      const normalizeEmail = (email) =>
        String(email || '')
          .trim()
          .toLowerCase();
      const validLeads = leads
        .map((lead) => ({
          email: normalizeEmail(lead.email),
          full_name: String(lead.full_name || '').trim(),
          organization_id: lead.organization_id,
          division_id: lead.division_id || null,
          player_id: lead.player_id || null,
        }))
        .filter((lead) => lead.email && lead.full_name && lead.organization_id);

      db.coaches = db.coaches || [];
      db.coach_interested_programs = db.coach_interested_programs || [];

      for (const lead of validLeads) {
        if (
          lead.division_id &&
          !(db.divisions || []).some(
            (division) =>
              String(division.id) === String(lead.division_id) &&
              String(division.organization_id) === String(lead.organization_id)
          )
        ) {
          return {
            data: null,
            error: { message: 'Coach lead references a division outside its organization' },
          };
        }

        if (
          lead.player_id &&
          !(db.players || []).some(
            (player) =>
              String(player.id) === String(lead.player_id) &&
              String(player.organization_id) === String(lead.organization_id)
          )
        ) {
          return {
            data: null,
            error: { message: 'Coach lead references a player outside its organization' },
          };
        }
      }

      let leadsCreated = 0;
      let programsLinked = 0;
      const coachCandidateEmails = new Set();

      validLeads.forEach((lead) => {
        if (coachCandidateEmails.has(lead.email)) return;
        coachCandidateEmails.add(lead.email);

        const existingGlobalCoach = db.coaches.find(
          (coach) => normalizeEmail(coach.email) === lead.email
        );
        if (!existingGlobalCoach) {
          db.coaches.push({
            id: Math.random().toString(36).substr(2, 9),
            organization_id: lead.organization_id,
            full_name: lead.full_name,
            email: lead.email,
            status: 'interested',
            import_source: 'player_import_lead',
            last_imported_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          });
          leadsCreated += 1;
        } else if (String(existingGlobalCoach.organization_id) === String(lead.organization_id)) {
          existingGlobalCoach.last_imported_at = new Date().toISOString();
        }
      });

      validLeads.forEach((lead) => {
        const coach = db.coaches.find(
          (item) =>
            normalizeEmail(item.email) === lead.email &&
            String(item.organization_id) === String(lead.organization_id)
        );
        if (!coach || !lead.division_id) return;

        const existingLink = db.coach_interested_programs.find(
          (item) =>
            String(item.coach_id) === String(coach.id) &&
            String(item.division_id) === String(lead.division_id) &&
            String(item.inferred_from_player_id || '') === String(lead.player_id || '')
        );
        if (existingLink) return;

        db.coach_interested_programs.push({
          id: Math.random().toString(36).substr(2, 9),
          coach_id: coach.id,
          division_id: lead.division_id,
          inferred_from_player_id: lead.player_id,
          organization_id: lead.organization_id,
          created_at: new Date().toISOString(),
        });
        programsLinked += 1;
      });

      saveDB(db);
      return {
        data: {
          leads_created: leadsCreated,
          programs_linked: programsLinked,
          skipped_existing: validLeads.length - leadsCreated,
        },
        error: null,
      };
    }

    if (name === 'admin_update_coach_status') {
      const { p_organization_id, p_coach_id, p_status } = params || {};
      const validStatuses = new Set(['active', 'pending-confirmation', 'inactive', 'interested']);
      if (!validStatuses.has(p_status)) {
        return { data: null, error: { message: `invalid coach status: ${p_status}` } };
      }

      const session =
        typeof window !== 'undefined'
          ? JSON.parse(sessionStorage.getItem('__MOCK_SESSION__') || 'null')
          : null;
      const member = (db.organization_members || []).find(
        (item) =>
          String(item.organization_id) === String(p_organization_id) &&
          String(item.profile_id) === String(session?.user?.id)
      );
      if (!['admin', 'tenant_admin'].includes(String(member?.role || ''))) {
        return { data: null, error: { message: 'Access denied: admin role required' } };
      }

      const coach = (db.coaches || []).find(
        (item) =>
          String(item.id) === String(p_coach_id) &&
          String(item.organization_id) === String(p_organization_id)
      );
      if (!coach) {
        return { data: null, error: { message: 'Coach not found in organization' } };
      }

      const assignedTeamCount = (db.teams || []).filter(
        (team) =>
          String(team.organization_id) === String(p_organization_id) &&
          String(team.coach_id) === String(p_coach_id)
      ).length;
      if (['inactive', 'interested'].includes(p_status) && assignedTeamCount > 0) {
        return {
          data: null,
          error: { message: `Cannot set an assigned coach to status ${p_status}` },
        };
      }

      const previousStatus = coach.status;
      coach.status = p_status;
      coach.updated_at = new Date().toISOString();
      db.audit_log = db.audit_log || [];
      if (previousStatus !== p_status) {
        db.audit_log.push({
          id: Math.random().toString(36).substr(2, 9),
          organization_id: p_organization_id,
          user_id: session?.user?.id,
          action:
            previousStatus === 'interested' && p_status === 'active'
              ? 'coach.promoted'
              : 'coach.status_updated',
          resource_type: 'coach',
          resource_id: p_coach_id,
          metadata: {
            coach_id: p_coach_id,
            previous_status: previousStatus,
            status: p_status,
            assigned_team_count: assignedTeamCount,
          },
          created_at: new Date().toISOString(),
        });
      }
      saveDB(db);
      return {
        data: {
          coach_id: p_coach_id,
          organization_id: p_organization_id,
          previous_status: previousStatus,
          status: p_status,
          changed: previousStatus !== p_status,
        },
        error: null,
      };
    }

    if (name === 'admin_assign_team_coach') {
      const { p_organization_id, p_team_id, p_coach_id } = params || {};
      const session =
        typeof window !== 'undefined'
          ? JSON.parse(sessionStorage.getItem('__MOCK_SESSION__') || 'null')
          : null;
      const member = (db.organization_members || []).find(
        (item) =>
          String(item.organization_id) === String(p_organization_id) &&
          String(item.profile_id) === String(session?.user?.id)
      );
      if (!['admin', 'tenant_admin'].includes(String(member?.role || ''))) {
        return { data: null, error: { message: 'Access denied: admin role required' } };
      }

      const team = (db.teams || []).find(
        (item) =>
          String(item.id) === String(p_team_id) &&
          String(item.organization_id) === String(p_organization_id)
      );
      if (!team) {
        return { data: null, error: { message: 'Team not found in organization' } };
      }

      const previousCoachId = team.coach_id || null;
      if (p_coach_id) {
        const coach = (db.coaches || []).find(
          (item) =>
            String(item.id) === String(p_coach_id) &&
            String(item.organization_id) === String(p_organization_id)
        );
        if (!coach) {
          return { data: null, error: { message: 'Coach not found in organization' } };
        }
        if (!['active', 'pending-confirmation'].includes(String(coach.status))) {
          return {
            data: null,
            error: { message: 'Coach must be active or pending-confirmation before assignment' },
          };
        }

        const otherAssignments = (db.teams || []).filter(
          (item) =>
            String(item.organization_id) === String(p_organization_id) &&
            String(item.coach_id) === String(p_coach_id) &&
            String(item.id) !== String(p_team_id)
        );
        if (!coach.can_coach_multiple_teams && otherAssignments.length > 0) {
          return { data: null, error: { message: 'Coach is already assigned to another team' } };
        }
      }

      if (String(previousCoachId || '') === String(p_coach_id || '')) {
        return {
          data: {
            team_id: p_team_id,
            organization_id: p_organization_id,
            previous_coach_id: previousCoachId,
            coach_id: p_coach_id || null,
            changed: false,
          },
          error: null,
        };
      }

      team.coach_id = p_coach_id || null;
      team.updated_at = new Date().toISOString();
      db.audit_log = db.audit_log || [];
      db.audit_log.push({
        id: Math.random().toString(36).substr(2, 9),
        organization_id: p_organization_id,
        user_id: session?.user?.id,
        action: p_coach_id
          ? previousCoachId
            ? 'team.coach_swapped'
            : 'team.coach_assigned'
          : 'team.coach_unassigned',
        resource_type: 'team',
        resource_id: p_team_id,
        metadata: {
          team_id: p_team_id,
          previous_coach_id: previousCoachId,
          coach_id: p_coach_id || null,
        },
        created_at: new Date().toISOString(),
      });
      saveDB(db);
      return {
        data: {
          team_id: p_team_id,
          organization_id: p_organization_id,
          previous_coach_id: previousCoachId,
          coach_id: p_coach_id || null,
          changed: true,
        },
        error: null,
      };
    }

    if (name === 'persist_evaluation_run') {
      return { data: { id: 'eval-' + Math.random().toString(36).substr(2, 6) }, error: null };
    }

    logger.warn(`[Mock Supabase] RPC "${name}" not implemented — returning empty success`);
    return { data: null, error: null };
  },
  functions: {
    invoke: async (name, options) => {
      logger.log(`[Mock Supabase] functions.invoke("${name}")`, options?.body);
      if (name === 'import-validation') {
        const body = options?.body || {};
        const aliases = HEADER_ALIASES;
        const requiredFields = {
          players: ['first_name', 'last_name', 'date_of_birth'],
          coaches: ['full_name', 'email'],
          fields: ['location', 'name', 'type', 'start', 'end'],
        };
        const normalizeHeader = (header) => aliases[String(header).toLowerCase().trim()] || header;
        const sanitize = (value) =>
          value === null || value === undefined
            ? ''
            : String(value).trim().slice(0, 500).replaceAll('<', '').replaceAll('>', '');

        const validatedData = [];
        const stagedRows = [];
        const stagedImportRows = [];
        const validationErrors = [];
        const required = requiredFields[body.import_type] || [];

        (body.rows || []).forEach((rawRow, index) => {
          const row = {};
          Object.entries(rawRow).forEach(([key, value]) => {
            row[normalizeHeader(key)] = sanitize(value);
          });

          required.forEach((field) => {
            if (!row[field]) {
              validationErrors.push({
                row: index + 1,
                field,
                message: `Missing required field: ${field}`,
              });
            }
          });

          if (body.import_type === 'players' && row.date_of_birth) {
            const dob = new Date(row.date_of_birth);
            if (Number.isNaN(dob.getTime())) {
              validationErrors.push({
                row: index + 1,
                field: 'date_of_birth',
                message: `Invalid date format: ${row.date_of_birth}`,
              });
            }
          }

          const hasRowError = validationErrors.some((error) => error.row === index + 1);
          if (!hasRowError) {
            validatedData.push(row);
            if (body.import_type === 'players' && body.import_job_id) {
              stagedRows.push({
                id: Math.random().toString(36).substr(2, 9),
                organization_id: body.organization_id,
                import_job_id: body.import_job_id,
                source_row_number: (body.row_offset || 0) + index + 1,
                raw_payload: rawRow,
                normalized_payload: row,
                validation_errors: [],
                created_at: new Date().toISOString(),
              });
            } else if (body.import_type !== 'players' && body.import_job_id) {
              stagedImportRows.push({
                id: Math.random().toString(36).substr(2, 9),
                organization_id: body.organization_id,
                import_job_id: body.import_job_id,
                import_type: body.import_type,
                source_row_number: (body.row_offset || 0) + index + 1,
                raw_payload: rawRow,
                normalized_payload: row,
                validation_errors: [],
                created_at: new Date().toISOString(),
              });
            }
          }
        });

        if (stagedRows.length > 0 || stagedImportRows.length > 0) {
          const db = getDB();
          if (stagedRows.length > 0) {
            const rowNumbers = new Set(stagedRows.map((row) => String(row.source_row_number)));
            db.staging_players = (db.staging_players || []).filter(
              (row) =>
                String(row.import_job_id) !== String(body.import_job_id) ||
                !rowNumbers.has(String(row.source_row_number))
            );
            db.staging_players.push(...stagedRows);
          }
          if (stagedImportRows.length > 0) {
            const rowNumbers = new Set(
              stagedImportRows.map((row) => String(row.source_row_number))
            );
            db.staging_import_rows = (db.staging_import_rows || []).filter(
              (row) =>
                String(row.import_job_id) !== String(body.import_job_id) ||
                !rowNumbers.has(String(row.source_row_number))
            );
            db.staging_import_rows.push(...stagedImportRows);
          }
          saveDB(db);
        }

        return {
          data: {
            status: 'success',
            import_type: body.import_type,
            total_rows: body.rows?.length || 0,
            valid_rows: validatedData.length,
            error_rows: validationErrors.length,
            staged_rows: stagedRows.length + stagedImportRows.length,
            validated_data: validatedData,
            validation_errors: validationErrors,
          },
          error: null,
        };
      }
      // Return a plausible empty success for any edge function call
      return { data: null, error: null };
    },
  },
};
