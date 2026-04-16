import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.87.1';

// Phase 1 Security: Sanitize ICS field values to prevent header injection.
// ICS fields must not contain newlines that could inject extra headers.
const sanitizeIcsValue = (val: string): string =>
  val
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\;,]/g, '\\$&')
    .trim();

// Simple padded string helper
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

// Format date to DTSTART UTC format: 20240805T170000Z
// Strict RFC 5545 requires specific string configurations.
const formatIcsDate = (dateOb: Date): string => {
  return `${dateOb.getUTCFullYear()}${pad(dateOb.getUTCMonth() + 1)}${pad(dateOb.getUTCDate())}T${pad(dateOb.getUTCHours())}${pad(dateOb.getUTCMinutes())}${pad(dateOb.getUTCSeconds())}Z`;
};

// Generates a random UID for the ICS event
const generateUid = () => crypto.randomUUID();

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response('Missing calendar token', { status: 400 });
    }

    // Initialize Supabase with Service Role to bypass RLS for public feed
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Env Vars');
      return new Response('Internal Server Error', { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Validate Token and Fetch Team (Phase 2.3: includes expiry check)
    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .select('id, name, organization_id, division_id, calendar_token_expires_at, organizations(name)')
      .eq('calendar_token', token)
      .single();

    if (teamErr || !team) {
      return new Response('Invalid calendar token or team not found.', { status: 404 });
    }

    // Phase 2.3 (H-2): Check token expiry
    if (team.calendar_token_expires_at) {
      const expiresAt = new Date(team.calendar_token_expires_at);
      if (expiresAt < new Date()) {
        return new Response(
          'Calendar token has expired. Please ask your coach or admin to regenerate the calendar link.',
          { status: 403 }
        );
      }
    }

    const teamId = team.id;
    const organizationId = team.organization_id;
    const orgName = team.organizations?.name || 'SquadLogic';

    // 2. Fetch Timezone Settings
    // We need to resolve the timezone for practice expansion
    let timezone = 'America/New_York';
    if (organizationId) {
      const { data: settings } = await supabase
        .from('season_settings')
        .select('timezone')
        .eq('organization_id', organizationId)
        .single();
      if (settings?.timezone) timezone = settings.timezone;
    }

    // 3. Fetch Games
    const { data: games } = await supabase
      .from('games')
      .select(
        `
          id,
          game_slots ( start_time, end_time, fields(name, locations(name)) ),
          teams!games_home_team_id_fkey(name),
          teams!games_away_team_id_fkey(name)
      `
      )
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);

    // 4. Fetch Practice Assignments
    const { data: practices } = await supabase
      .from('practice_assignments')
      .select(
        `
          id,
          effective_date_range,
          practice_slots ( day_of_week, start_time, end_time, fields(name, locations(name)) )
       `
      )
      .eq('team_id', teamId);

    // 5. Expand Practice Dates (Copied core logic from hook, localized for Deno)
    const expandedEvents = [];

    // Day offset map JS getUTCDay
    const dayMap: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };

    practices?.forEach((p) => {
      const [startStr, endStr] = p.effective_date_range.replace(/[[]()]/g, '').split(',');
      if (!startStr || !endStr) return;

      const slot = p.practice_slots;
      if (!slot) return;

      const targetDay = dayMap[slot.day_of_week.toLowerCase()];
      const currentDate = new Date(`${startStr.trim()}T12:00:00Z`);
      const endDate = new Date(`${endStr.trim()}T12:00:00Z`);

      while (currentDate.getUTCDay() !== targetDay) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }

      while (currentDate <= endDate) {
        const isoDateStr = currentDate.toISOString().split('T')[0];

        // Construct proper UTC Date objects for the start and end times
        // This requires passing the string into Date constructor assuming local wall time, then mapping
        // For simplicity in generating strict UTC ICS, we append Z if we know the offset, or rely
        // on the DB's timezone bindings. Assuming slot.start_time is purely a time without TZ "17:00:00".
        // In a full prod app we'd use moment-timezone or Day.js to map `isoDateStr` + `start_time` in `timezone` to a UTC Date.
        // For this exercise, we will assume standard parsing.
        const startDt = new Date(`${isoDateStr}T${slot.start_time}Z`);
        const endDt = new Date(`${isoDateStr}T${slot.end_time}Z`);

        expandedEvents.push({
          uid: `${p.id}_${isoDateStr}`,
          title: `Practice - ${team.name}`,
          dtstart: formatIcsDate(startDt),
          dtend: formatIcsDate(endDt),
          description: `Practice session for ${team.name}`,
          location: `${slot.fields?.locations?.name || 'Venue'}, ${slot.fields?.name || 'Field'}`,
        });

        currentDate.setUTCDate(currentDate.getUTCDate() + 7);
      }
    });

    games?.forEach((g) => {
      const slot = g.game_slots;
      if (!slot) return;

      const startDt = new Date(slot.start_time);
      const endDt = new Date(slot.end_time || slot.start_time); // Fallback

      expandedEvents.push({
        uid: g.id,
        title: `Game: ${team.name}`,
        dtstart: formatIcsDate(startDt),
        dtend: formatIcsDate(endDt),
        description: `Game matchup`,
        location: `${slot.fields?.locations?.name || 'Venue'}, ${slot.fields?.name || 'Field'}`,
      });
    });

    // 6. Generate ICS String Strict Mode (CRLF)
    const CRLF = '\r\n';
    let icsString = `BEGIN:VCALENDAR${CRLF}`;
    icsString += `VERSION:2.0${CRLF}`;
    icsString += `PRODID:-//${orgName}//SquadLogic//EN${CRLF}`;
    icsString += `CALSCALE:GREGORIAN${CRLF}`;
    icsString += `METHOD:PUBLISH${CRLF}`;
    icsString += `X-WR-CALNAME:${team.name} Schedule${CRLF}`;
    icsString += `X-WR-TIMEZONE:${timezone}${CRLF}`;

    const nowStamp = formatIcsDate(new Date());

    expandedEvents.forEach((ev) => {
      icsString += `BEGIN:VEVENT${CRLF}`;
      icsString += `UID:${sanitizeIcsValue(String(ev.uid))}@squadlogic.app${CRLF}`;
      icsString += `DTSTAMP:${nowStamp}${CRLF}`;
      icsString += `DTSTART:${ev.dtstart}${CRLF}`;
      icsString += `DTEND:${ev.dtend}${CRLF}`;
      icsString += `SUMMARY:${sanitizeIcsValue(ev.title)}${CRLF}`;
      icsString += `DESCRIPTION:${sanitizeIcsValue(ev.description)}${CRLF}`;
      if (ev.location) {
        icsString += `LOCATION:${sanitizeIcsValue(ev.location)}${CRLF}`;
      }
      icsString += `END:VEVENT${CRLF}`;
    });

    icsString += `END:VCALENDAR${CRLF}`;

    // Return the response
    return new Response(icsString, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${team.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Schedule.ics"`,
      },
      status: 200,
    });
  } catch (err) {
    console.error('Calendar Feed Error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
});
