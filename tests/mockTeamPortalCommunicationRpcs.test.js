import { describe, it, expect, beforeEach } from 'vitest';
import { mockSupabase as supabase, getMockData } from '../frontend/src/lib/mockSupabaseClient.js';

const TEAM_ID = '00000000-0000-0000-0000-000000000001';

const setMockSession = (userId) => {
  sessionStorage.setItem('__MOCK_SESSION__', JSON.stringify({ user: { id: userId } }));
};

describe('mock team portal communication rpcs', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__MOCK_DB__;
    setMockSession('mock-parent-id');
  });

  it('upserts RSVPs through the team portal RPC with idempotent audit behavior', async () => {
    const { data, error } = await supabase.rpc('upsert_team_event_rsvp', {
      p_team_id: TEAM_ID,
      p_player_id: 'player-1',
      p_reference_id: 'pa-1',
      p_event_type: 'practice',
      p_occurrence_date: '2025-01-07',
      p_status: 'declined',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ changed: true });
    expect(data.rsvp).toMatchObject({
      team_id: TEAM_ID,
      player_id: 'player-1',
      status: 'declined',
    });
    expect(
      getMockData('audit_log').filter((row) => row.action === 'team.rsvp_updated')
    ).toHaveLength(1);

    const { data: repeat, error: repeatError } = await supabase.rpc('upsert_team_event_rsvp', {
      p_team_id: TEAM_ID,
      p_player_id: 'player-1',
      p_reference_id: 'pa-1',
      p_event_type: 'practice',
      p_occurrence_date: '2025-01-07',
      p_status: 'declined',
    });

    expect(repeatError).toBeNull();
    expect(repeat).toMatchObject({ changed: false });
    expect(
      getMockData('audit_log').filter((row) => row.action === 'team.rsvp_updated')
    ).toHaveLength(1);
  });

  it('creates team messages through the team portal RPC without storing audit content', async () => {
    const { data, error } = await supabase.rpc('create_team_message', {
      p_team_id: TEAM_ID,
      p_content: '  See you at practice.  ',
    });

    expect(error).toBeNull();
    expect(data.message).toMatchObject({
      team_id: TEAM_ID,
      author_id: 'mock-parent-id',
      content: 'See you at practice.',
    });

    const auditRows = getMockData('audit_log').filter(
      (row) => row.action === 'team.message_created'
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata).toMatchObject({
      team_id: TEAM_ID,
      content_length: 'See you at practice.'.length,
    });
    expect(JSON.stringify(auditRows[0].metadata)).not.toContain('See you at practice');
  });

  it('rejects invalid or unauthorized communication RPC requests', async () => {
    const { error: blankError } = await supabase.rpc('create_team_message', {
      p_team_id: TEAM_ID,
      p_content: '   ',
    });
    expect(blankError?.message).toContain('Message content is required');

    setMockSession('mock-coach-id');
    const { error: rsvpError } = await supabase.rpc('upsert_team_event_rsvp', {
      p_team_id: TEAM_ID,
      p_player_id: 'player-1',
      p_reference_id: 'pa-1',
      p_event_type: 'practice',
      p_occurrence_date: '2025-01-07',
      p_status: 'maybe',
    });
    expect(rsvpError?.message).toContain('Caller cannot manage RSVP for this player');
  });
});
