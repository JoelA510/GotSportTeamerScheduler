import { describe, it, expect } from 'vitest';

// We extract the pure generator logic from the Deno function for isolated unit testing
const pad = (n) => (n < 10 ? `0${n}` : `${n}`);

const formatIcsDate = (dateOb) => {
  return `${dateOb.getUTCFullYear()}${pad(dateOb.getUTCMonth() + 1)}${pad(dateOb.getUTCDate())}T${pad(dateOb.getUTCHours())}${pad(dateOb.getUTCMinutes())}${pad(dateOb.getUTCSeconds())}Z`;
};

const generateIcsString = (teamName, orgName, timezone, expandedEvents) => {
  const CRLF = '\r\n';
  let icsString = `BEGIN:VCALENDAR${CRLF}`;
  icsString += `VERSION:2.0${CRLF}`;
  icsString += `PRODID:-//${orgName}//SquadLogic//EN${CRLF}`;
  icsString += `CALSCALE:GREGORIAN${CRLF}`;
  icsString += `METHOD:PUBLISH${CRLF}`;
  icsString += `X-WR-CALNAME:${teamName} Schedule${CRLF}`;
  icsString += `X-WR-TIMEZONE:${timezone}${CRLF}`;

  const nowStamp = formatIcsDate(new Date('2025-01-01T12:00:00Z')); // Fixed for test

  expandedEvents.forEach((ev) => {
    icsString += `BEGIN:VEVENT${CRLF}`;
    icsString += `UID:${ev.uid}@squadlogic.app${CRLF}`;
    icsString += `DTSTAMP:${nowStamp}${CRLF}`;
    icsString += `DTSTART:${ev.dtstart}${CRLF}`;
    icsString += `DTEND:${ev.dtend}${CRLF}`;
    icsString += `SUMMARY:${ev.title}${CRLF}`;
    icsString += `DESCRIPTION:${ev.description}${CRLF}`;
    if (ev.location) {
      icsString += `LOCATION:${ev.location}${CRLF}`;
    }
    icsString += `END:VEVENT${CRLF}`;
  });

  icsString += `END:VCALENDAR${CRLF}`;
  return icsString;
};

describe('ICS Generator (RFC 5545)', () => {
  it('generates strict CRLF line endings, valid UTC DTSTART timestamps, and standard ICS wrapping', () => {
    const testEvents = [
      {
        uid: 'mock-123',
        title: 'Test Practice',
        dtstart: '20250805T170000Z',
        dtend: '20250805T183000Z',
        description: 'Mock Description',
        location: 'Field 1A',
      },
    ];

    const output = generateIcsString('Tigers', 'Test Org', 'America/New_York', testEvents);

    // 1. CRLF endings Check
    const newlineMatches = output.match(/\r\n/g);
    const badNewlineMatches = output.match(/[^\r]\n/g);

    expect(newlineMatches).toBeTruthy();
    expect(newlineMatches.length).toBeGreaterThan(10);
    expect(badNewlineMatches).toBeNull(); // No loose \n allowed

    // 2. Contains VCALENDAR structure
    expect(output).toContain('BEGIN:VCALENDAR\r\n');
    expect(output).toContain('END:VCALENDAR\r\n');
    expect(output).toContain('BEGIN:VEVENT\r\n');
    expect(output).toContain('END:VEVENT\r\n');

    // 3. Valid DTSTART (UTC Z suffix)
    expect(output).toContain('DTSTART:20250805T170000Z\r\n');

    // 4. Timezone Metadata
    expect(output).toContain('X-WR-TIMEZONE:America/New_York\r\n');
  });

  it('formats UTC Date objects correctly into DTSTART strings', () => {
    // Vitest specific logic separated from Deno
    const date = new Date('2024-12-31T08:15:30Z');
    expect(formatIcsDate(date)).toBe('20241231T081530Z');

    const date2 = new Date('2025-01-05T00:05:01Z');
    expect(formatIcsDate(date2)).toBe('20250105T000501Z');
  });
});
