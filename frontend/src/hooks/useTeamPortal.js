import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * useTeamPortal
 * Fetches and manages data for the Team Portal.
 * Handles practice expansion based on timezone and real-time updates.
 */
export function useTeamPortal(teamId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [team, setTeam] = useState(null);
  const [roster, setRoster] = useState([]);
  const [events, setEvents] = useState([]);
  const [rsvps, setRsvps] = useState([]);
  const [messages, setMessages] = useState([]);
  const [myPlayers, setMyPlayers] = useState([]);

  const fetchData = useCallback(async () => {
    if (!teamId) return;

    try {
      setLoading(true);

      // 1. Fetch Team Details + League Timezone
      const { data: teamData, error: teamError } = await supabase
        .from('teams')
        .select(`
          *,
          division:divisions (
            id,
            name,
            season:season_settings (
              id,
              timezone,
              season_start,
              season_end
            )
          )
        `)
        .eq('id', teamId)
        .single();

      if (teamError) throw teamError;
      setTeam(teamData);

      const timezone = teamData.division?.season?.timezone || 'UTC';

      // 2. Fetch Roster
      const { data: rosterData, error: rosterError } = await supabase
        .from('team_players')
        .select(`
          player:players (
            id,
            first_name,
            last_name
          )
        `)
        .eq('team_id', teamId);

      if (rosterError) throw rosterError;
      setRoster(rosterData.map((r) => r.player));

      // 3. Fetch Games
      const { data: gamesData, error: gamesError } = await supabase
        .from('games')
        .select(`
          *,
          game_slot:game_slots (
            slot_date,
            start_time,
            end_time,
            field:fields (
              name,
              location:locations (name)
            )
          ),
          home_team:teams!home_team_id (name),
          away_team:teams!away_team_id (name)
        `)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);

      if (gamesError) throw gamesError;

      const mappedGames = gamesData.map((g) => ({
        id: g.id,
        type: 'game',
        date: g.game_slot?.slot_date,
        startTime: g.game_slot?.start_time,
        endTime: g.game_slot?.end_time,
        location: `${g.game_slot?.field?.location?.name} - ${g.game_slot?.field?.name}`,
        homeTeam: g.home_team?.name,
        awayTeam: g.away_team?.name,
        opponent: g.home_team_id === teamId ? g.away_team?.name : g.home_team?.name,
        description: `vs ${g.home_team_id === teamId ? g.away_team?.name : g.home_team?.name}`
      }));

      // 4. Fetch Practices and Expand
      const { data: practiceAssignments, error: practiceError } = await supabase
        .from('practice_assignments')
        .select(`
          *,
          slot:practice_slots (
            day_of_week,
            start_time,
            end_time,
            field:fields (
              name,
              location:locations (name)
            )
          )
        `)
        .eq('team_id', teamId);

      if (practiceError) throw practiceError;

      const expandedPractices = expandPractices(practiceAssignments, timezone);

      // 5. Combine and Sort Events
      const allEvents = [...mappedGames, ...expandedPractices].sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.startTime}`);
        const dateB = new Date(`${b.date}T${b.startTime}`);
        return dateA.getTime() - dateB.getTime();
      });
      setEvents(allEvents);

      // 6. Fetch RSVPs
      const { data: rsvpData, error: rsvpError } = await supabase
        .from('event_rsvps')
        .select('*')
        .eq('team_id', teamId);

      if (rsvpError) throw rsvpError;
      setRsvps(rsvpData);

      // 7. Fetch My Players (for RSVPing)
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { data: myPlayerData } = await supabase
          .from('profile_players')
          .select('player_id')
          .eq('profile_id', authData.user.id);
        
        if (myPlayerData) {
          const myIds = myPlayerData.map(mp => mp.player_id);
          const matchedPlayers = [];
          rosterData?.forEach(r => {
            const p = Array.isArray(r.player) ? r.player[0] : r.player;
            if (p) {
            }
            if (p && myIds.includes(p.id)) {
              matchedPlayers.push(p);
            }
          });
          setMyPlayers(matchedPlayers);
        }
      } else {
        console.warn('[DEBUG] [useTeamPortal] No authenticated user found for RSVP section');
      }

      // 8. Fetch Messages
      const { data: msgData, error: msgError } = await supabase
        .from('team_messages')
        .select(`
          *,
          author:profiles (
            full_name
          )
        `)
        .eq('team_id', teamId)
        .order('created_at', { ascending: true });

      if (msgError) throw msgError;
      setMessages(msgData);

    } catch (err) {
      console.error('Error fetching Team Portal data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchData();

    // Set up Realtime Subscription for Messages
    const messageChannel = supabase
      .channel(`team_messages:${teamId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `team_id=eq.${teamId}`
        },
        async (payload) => {
          // Fetch the author's name to match the state format
          const { data: authorData } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', payload.new.author_id)
            .single();

          const newMessage = {
            ...payload.new,
            author: authorData || { full_name: 'Unknown User' }
          };
          setMessages((current) => [...current, newMessage]);
        }
      )
      .subscribe();

    // Set up Realtime Subscription for RSVPs
    const rsvpChannel = supabase
      .channel(`event_rsvps:${teamId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_rsvps',
          filter: `team_id=eq.${teamId}`
        },
        () => {
          // Simplest approach: refetch RSVPs when one changes
          // A more surgical update of the state could be done for performance
          const refetchRsvps = async () => {
            const { data } = await supabase
              .from('event_rsvps')
              .select('*')
              .eq('team_id', teamId);
            if (data) setRsvps(data);
          };
          refetchRsvps();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(rsvpChannel);
    };
  }, [teamId, fetchData]);

  const updateRsvp = async (playerId, referenceId, eventType, occurrenceDate, status) => {
    try {
      const { data: profileData } = await supabase.auth.getUser();
      if (!profileData.user) throw new Error('Not authenticated');

      const { data: orgData } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', profileData.user.id)
        .single();

      if (!orgData) throw new Error('No organization found for profile');

      const { error: upsertError } = await supabase
        .from('event_rsvps')
        .upsert({
          organization_id: orgData.organization_id,
          team_id: teamId,
          player_id: playerId,
          reference_id: referenceId,
          event_type: eventType,
          occurrence_date: occurrenceDate,
          status,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'player_id,reference_id,occurrence_date'
        });

      if (upsertError) throw upsertError;
    } catch (err) {
      console.error('Error updating RSVP:', err);
      // You could expose an error state for mutations if needed
    }
  };

  const sendMessage = async (content) => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error('Not authenticated');

      const { data: profileData } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', authData.user.id)
        .single();

      if (!profileData) throw new Error('No organization found for profile');

      // Optimistic UI Update
      const optimisticMsg = {
        id: Date.now(),
        author: { full_name: authData.user.user_metadata?.full_name || 'You' },
        content,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, optimisticMsg]);

      const { error: sendError } = await supabase
        .from('team_messages')
        .insert({
          organization_id: profileData.organization_id,
          team_id: teamId,
          author_id: authData.user.id,
          content
        });

      if (sendError) throw sendError;
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  return {
    loading,
    error,
    team,
    roster,
    events,
    rsvps,
    messages,
    myPlayers,
    updateRsvp,
    sendMessage,
    refresh: fetchData
  };
}

/**
 * expandPractices
 * Expands a practice assignment range into individual dates based on day_of_week.
 */
function expandPractices(assignments, timezone) {
  const expanded = [];
  const daysMap = {
    mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0
  };

  assignments.forEach((assignment) => {
    const slot = assignment.slot;
    if (!slot) return;

    // Parse daterange string: [2025-01-01,2025-03-01)
    const range = assignment.effective_date_range.replace(/[\[\)\(]/g, '').split(',');
    const startDate = new Date(range[0]);
    const endDate = new Date(range[1]);
    const targetDay = daysMap[slot.day_of_week];

    let current = new Date(startDate);
    while (current < endDate) {
      if (current.getDay() === targetDay) {
        expanded.push({
          id: assignment.id,
          type: 'practice',
          date: current.toISOString().split('T')[0],
          startTime: slot.start_time,
          endTime: slot.end_time,
          location: `${slot.field?.location?.name} - ${slot.field?.name}`,
          description: 'Practice'
        });
      }
      current.setDate(current.getDate() + 1);
    }
  });

  return expanded;
}
