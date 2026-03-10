import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

// Helper to reliably expand date ranges in specific timezone
const getDatesInRangeForDay = (startDateStr, endDateStr, dayOfWeekStr) => {
  const dates = [];

  // Create a UTC date at noon to avoid timezone shift on parsing
  let currentDate = new Date(`${startDateStr}T12:00:00Z`);
  const endDate = new Date(`${endDateStr}T12:00:00Z`);

  // JS getUTCDay: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const targetDay = dayMap[dayOfWeekStr.toLowerCase()];

  // Find the first occurrence
  while (currentDate.getUTCDay() !== targetDay) {
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  while (currentDate <= endDate) {
    // Format the UTC date back to YYYY-MM-DD
    const isoString = currentDate.toISOString().split('T')[0];
    dates.push(isoString);
    currentDate.setUTCDate(currentDate.getUTCDate() + 7);
  }

  return dates;
};

// Parse postgres daterange string like "[2025-01-01,2025-03-01)"
const parseDateRange = (dateRangeStr) => {
  if (!dateRangeStr) return { start: null, end: null };
  const cleaned = dateRangeStr.replace(/\[|\]|\(|\)/g, '');
  const [start, end] = cleaned.split(',');
  return { start: start?.trim(), end: end?.trim() };
};

export function useTeamPortal(teamId) {
  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);
  const [events, setEvents] = useState([]); // Unified games & practices
  const [rsvps, setRsvps] = useState([]);
  const [messages, setMessages] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { currentOrganization } = useOrganization();
  const { session } = useAuth();
  const userId = session?.user?.id;

  // Clear-and-refetch: reset state when org or team context changes
  useEffect(() => {
    setTeam(null);
    setPlayers([]);
    setEvents([]);
    setRsvps([]);
    setMessages([]);
    setError(null);
  }, [currentOrganization?.id, teamId]);

  const fetchTeamData = useCallback(async () => {
    if (!currentOrganization?.id || !teamId || !userId) return;

    try {
      setLoading(true);
      setError(null);

      // 1. Fetch team & timezone settings
      const [teamRes, settingsRes, myPlayersRes] = await Promise.all([
        supabase
          .from('teams')
          .select('*, coaches(first_name, last_name)')
          .eq('id', teamId)
          .single(),
        supabase
          .from('season_settings')
          .select('timezone')
          .eq('organization_id', currentOrganization.id)
          .maybeSingle(),
        supabase.from('profile_players').select('player_id()').eq('profile_id', userId),
      ]);

      if (teamRes.error) throw teamRes.error;
      setTeam(teamRes.data);
      const timezone = settingsRes.data?.timezone || 'America/Los_Angeles'; // Default fallback

      // 2. Fetch roster
      const { data: rosterData, error: rosterErr } = await supabase
        .from('roster_assignments')
        .select(
          `
          player_id,
          players ( first_name, last_name )
        `
        )
        .eq('team_id', teamId);

      if (rosterErr) throw rosterErr;

      // Figure out which players this user is authorized for
      let authPlayerIds = [];
      if (myPlayersRes.data) {
        authPlayerIds = myPlayersRes.data.map((p) => p.player_id);
      }

      const enrichedPlayers = rosterData.map((r) => ({
        id: r.player_id,
        name: `${r.players.first_name} ${r.players.last_name}`,
        isMyChild: authPlayerIds.includes(r.player_id),
      }));
      setPlayers(enrichedPlayers);

      // 3. Fetch Practice Assignments
      const { data: practiceData, error: pracErr } = await supabase
        .from('practice_assignments')
        .select(
          `
          id,
          effective_date_range,
          practice_slots ( day_of_week, start_time, end_time, fields(name, locations(name)) )
        `
        )
        .eq('team_id', teamId);
      if (pracErr) throw pracErr;

      // 4. Fetch Games
      const { data: gameData, error: gameErr } = await supabase
        .from('games')
        .select(
          `
          id,
          game_slot_id,
          home_team_id,
          away_team_id,
          game_slots ( start_time, end_time, fields(name, locations(name)) ),
          teams!games_home_team_id_fkey(name),
          teams!games_away_team_id_fkey(name)
        `
        )
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
      if (gameErr) throw gameErr;

      // 5. Expand & Unify Events
      let unifiedEvents = [];

      practiceData?.forEach((p) => {
        const { start, end } = parseDateRange(p.effective_date_range);
        if (!start || !end) return;

        const slot = p.practice_slots;
        if (!slot) return;

        const expandedDates = getDatesInRangeForDay(start, end, slot.day_of_week, timezone);
        expandedDates.forEach((date) => {
          unifiedEvents.push({
            id: `${p.id}_${date}`, // Synthetic ID for UI keys mapping
            reference_id: p.id,
            event_type: 'practice',
            occurrence_date: date,
            title: 'Practice',
            start_time: slot.start_time,
            end_time: slot.end_time,
            location: `${slot.fields?.locations?.name || 'Venue'}, ${slot.fields?.name || 'Field'}`,
            sort_datetime: new Date(`${date}T${slot.start_time || '00:00:00'}`),
          });
        });
      });

      gameData?.forEach((g) => {
        const slot = g.game_slots;
        if (!slot) return;

        const date = slot.start_time.split('T')[0]; // Extract date from ISO timestamp
        const time = slot.start_time.split('T')[1]?.substring(0, 5);

        const isHome = g.home_team_id === teamId;
        const opponent = isHome ? g.teams.name : g.teams.name; // Simplistic mapping

        unifiedEvents.push({
          id: g.id,
          reference_id: g.id,
          event_type: 'game',
          occurrence_date: date,
          title: `Game vs ${opponent}`,
          start_time: time || 'TBD',
          end_time: slot.end_time?.split('T')[1]?.substring(0, 5) || 'TBD',
          location: `${slot.fields?.locations?.name || 'Venue'}, ${slot.fields?.name || 'Field'}`,
          sort_datetime: new Date(slot.start_time),
        });
      });

      unifiedEvents.sort((a, b) => a.sort_datetime - b.sort_datetime);
      setEvents(unifiedEvents);

      // 6. Fetch RSVPs
      const { data: rsvpData, error: rsvpErr } = await supabase
        .from('event_rsvps')
        .select('*')
        .eq('team_id', teamId);
      if (rsvpErr) throw rsvpErr;
      setRsvps(rsvpData || []);

      // 7. Fetch Messages
      const { data: msgData, error: msgErr } = await supabase
        .from('team_messages')
        .select('*, profiles(first_name, last_name)')
        .eq('team_id', teamId)
        .order('created_at', { ascending: true });
      if (msgErr) throw msgErr;
      setMessages(msgData || []);
    } catch (err) {
      console.error('Error loading team portal:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id, teamId, userId]);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  // Realtime subscription for team chat
  useEffect(() => {
    if (!teamId) return;

    const channel = supabase
      .channel(`team_messages_${teamId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          // Optimistically we want to append, but payload lacks the foreign key join for profiles name.
          // A safe pattern is refetching, or we insert it raw and mock the name until full refresh.
          // We do a small refetch to get the profile name attached.
          supabase
            .from('team_messages')
            .select('*, profiles(first_name, last_name)')
            .eq('id', payload.new.id)
            .single()
            .then(({ data }) => {
              if (data) setMessages((prev) => [...prev, data]);
            });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId]);

  const updateRsvp = async (playerId, referenceId, eventType, occurrenceDate, status) => {
    try {
      const payload = {
        organization_id: currentOrganization.id,
        team_id: teamId,
        player_id: playerId,
        reference_id: referenceId,
        event_type: eventType,
        occurrence_date: occurrenceDate,
        status: status,
      };

      const { error } = await supabase
        .from('event_rsvps')
        .upsert(payload, { onConflict: 'player_id, reference_id, occurrence_date' });

      if (error) throw error;

      // Optimistic update
      setRsvps((prev) => {
        const removed = prev.filter(
          (r) =>
            !(
              r.player_id === playerId &&
              r.reference_id === referenceId &&
              r.occurrence_date === occurrenceDate
            )
        );
        return [...removed, payload];
      });
    } catch (e) {
      console.error('Failed to update RSVP:', e);
      alert('Failed to save RSVP');
    }
  };

  const sendMessage = async (content) => {
    if (!content.trim() || !userId) return;
    try {
      const { error } = await supabase.from('team_messages').insert([
        {
          organization_id: currentOrganization.id,
          team_id: teamId,
          author_id: userId,
          content: content.trim(),
        },
      ]);
      if (error) throw error;
      // The realtime sub will handle pushing it to messages state
    } catch (e) {
      console.error('Failed to send message', e);
    }
  };

  return {
    team,
    players,
    events,
    rsvps,
    messages,
    loading,
    error,
    updateRsvp,
    sendMessage,
    userId,
  };
}
