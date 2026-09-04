/**
 * Fixture-integrity tests for the `fixtures/season-2026/practice/` corpus.
 *
 * Every figure the corpus README and `docs/PHASE_8_PLAN.md` §8.0 state is
 * treated as a **claim** and derived from the files at test time. Where a
 * claim did not hold, the test asserts what the corpus actually says and the
 * PR that added it records the discrepancy — nothing here is tuned to make a
 * stated number come out.
 *
 * Meta-assertion discipline (CLAUDE.md §3): every check also asserts it
 * examined a non-zero number of records, and every subject set is enumerated
 * from the side a break would leave intact — the roster, the geometry, the
 * finding-code table — never from the rows being checked. The
 * `positive controls` block constructs inputs that make the load-bearing
 * checks fail, so a check that cannot fail is not among them.
 */

import { describe, it, expect } from 'vitest';

import {
  compareDecoderRings,
  computePracticeFixtureChecksums,
  expectCsvColumns,
  inclusiveSpanDays,
  loadSeason2026,
  loadSeason2026Practice,
  parseClock24Minutes,
  crossCorpusFindings,
  parseCoachRegistration,
  parseFieldCodeNames,
  parsePlayerRegistration,
  parsePracticeFieldAliases,
  parseGameChangeLog,
  parseMonthDayDate,
  parsePermitReservations,
  parsePracticeGrid,
  parseWeeklyAvailability,
  selectTeamCode,
  weekdayCodeOfDayName,
  AVAILABILITY_INTERPRETATIONS,
  REGISTRATION_REF_CLASSES,
  SEASON_2026_PRACTICE_COLUMNS,
  SEASON_2026_PRACTICE_FILES,
  SEASON_2026_PRACTICE_FINDING,
  SEASON_2026_PRACTICE_FINDING_SEVERITY,
  SEASON_2026_PRACTICE_SCHEMAS,
  SEASON_LONG_CLOSURE_MIN_DAYS,
  UNRESOLVED_VENUE_TOKEN,
} from '@squadlogic/core/fixtures/index.js';

/** Both corpora are loaded once; every test reads from these immutable snapshots. */
const season = loadSeason2026();
const practice = loadSeason2026Practice({ season });

const F = SEASON_2026_PRACTICE_FINDING;

/** The corpus in the per-file shape `crossCorpusFindings()` takes, for the controls. */
const parsedCorpus = {
  'practice_grid.csv': { records: practice.practiceSlots },
  'practice_field_aliases.csv': { records: practice.fieldAliases },
  'field_code_names.csv': { records: practice.fieldCodeNames },
  'field_constraints.csv': { records: practice.fieldConstraints },
  'coach_registration.csv': { records: practice.coachRegistrations },
  'player_registration.csv': { records: practice.playerRegistrations },
  'game_change_log.csv': { records: practice.gameChanges },
  'select_coaches.csv': { records: practice.selectCoaches },
  'permits.csv': { records: practice.permits },
  'permit_reservations.csv': { records: practice.permitReservations },
  'field_inventory.csv': { records: practice.fieldInventory },
  'field_weekly_availability.csv': { records: practice.weeklyAvailability },
  'field_equipment.csv': { records: practice.fieldEquipment },
};

/** Findings of one code, in corpus order. */
const findingsOf = (code) => practice.findings.filter((finding) => finding.code === code);

/** Count records by a derived key. */
function tally(records, keyOf) {
  const counts = new Map();
  for (const record of records) {
    const key = keyOf(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The slot regimes a grid uses: one entry per distinct duration, listing the
 * distinct start times seen with it. A third regime shows up as a third key.
 */
function regimesOf(slots) {
  const byDuration = new Map();
  for (const slot of slots) {
    if (!byDuration.has(slot.durationMinutes)) byDuration.set(slot.durationMinutes, new Set());
    byDuration.get(slot.durationMinutes).add(slot.start);
  }
  return new Map([...byDuration].map(([duration, starts]) => [duration, [...starts].sort()]));
}

/** A CSV in a file's own column order, for the inline controls. */
function csvRows(fileName, rows) {
  const columns = SEASON_2026_PRACTICE_COLUMNS[fileName];
  const lines = rows.map((values) => columns.map((column) => values[column] ?? '').join(','));
  return `${columns.join(',')}\n${lines.join('\n')}\n`;
}
const csvRow = (fileName, values) => csvRows(fileName, [values]);

const GRID_ROW = {
  source_sheet: 'S',
  venue: 'Orchard Park',
  field: 'Field 1',
  subunit: 'A',
  day: 'Tuesday',
  start: '16:00',
  duration_minutes: '45',
  team_code: '05GMicro04',
};

describe('season-2026 practice corpus :: pure parsers', () => {
  it('parses 24h clocks, month-day dates, day names and Select codes without a Date', () => {
    expect(parseClock24Minutes('16:45')).toBe(1005);
    expect(parseClock24Minutes('00:00')).toBe(0);
    expect(() => parseClock24Minutes('4:45 PM')).toThrow(TypeError);
    expect(() => parseClock24Minutes('24:00')).toThrow(RangeError);
    expect(parseMonthDayDate('Aug 29', 2026)).toEqual({ date: '2026-08-29', note: null });
    expect(parseMonthDayDate('Nov 08 (Sun)', 2026)).toEqual({ date: '2026-11-08', note: 'Sun' });
    expect(() => parseMonthDayDate('Aug 29', undefined)).toThrow(TypeError);
    expect(() => parseMonthDayDate('Feb 30', 2026)).toThrow(RangeError);
    expect(parseMonthDayDate('Feb 29', 2028).date).toBe('2028-02-29');
    expect(() => parseMonthDayDate('Feb 29', 2026)).toThrow(RangeError);
    expect(weekdayCodeOfDayName('Friday')).toBe('FRI');
    expect(weekdayCodeOfDayName('Fri')).toBe('FRI');
    expect(() => weekdayCodeOfDayName('Freitag')).toThrow(TypeError);
    // A plain-object lookup would answer this with Object.prototype.constructor.
    expect(() => weekdayCodeOfDayName('constructor')).toThrow(TypeError);
    expect(() => weekdayCodeOfDayName('__proto__')).toThrow(TypeError);
    expect(selectTeamCode('U14B', 1)).toBe('14BSelect01');
    expect(selectTeamCode('U19G', 12)).toBe('19GSelect12');
    expect(() => selectTeamCode('14B', 1)).toThrow(TypeError);
    expect(inclusiveSpanDays('2026-08-01', '2026-08-01')).toBe(1);
    expect(inclusiveSpanDays('2026-08-01', '2026-11-28')).toBe(120);
  });
});

describe('season-2026 practice corpus :: read-only guarantee', () => {
  it('leaves every source file byte-identical across a load', () => {
    const before = computePracticeFixtureChecksums();
    expect(Object.keys(before)).toHaveLength(SEASON_2026_PRACTICE_FILES.length);
    expect(SEASON_2026_PRACTICE_FILES.length).toBe(13);

    loadSeason2026Practice({ season });

    const after = computePracticeFixtureChecksums();
    expect(after).toEqual(before);
    for (const fileName of SEASON_2026_PRACTICE_FILES) {
      expect(after[fileName]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('computes the join against the game corpus beside the directory it was given', () => {
    // Same directory, no `season` handed in: the loader must find ../ itself
    // and land on identical figures, or a caller pointing at another corpus
    // would be joined against the wrong roster.
    const sibling = loadSeason2026Practice({ dir: practice.dir });
    expect(sibling.findingsByCode).toEqual(practice.findingsByCode);
    expect(sibling.meta).toEqual(practice.meta);
    // A game corpus from anywhere else is refused, not joined against.
    expect(() => loadSeason2026Practice({ dir: `${practice.dir}/elsewhere`, season })).toThrow(
      /beside it/
    );
  });

  it('hands out frozen records, raw rows and findings', () => {
    expect(Object.isFrozen(practice)).toBe(true);
    const slot = practice.practiceSlots[0];
    expect(() => {
      slot.venue = 'MUTATED';
    }).toThrow(TypeError);
    expect(() => {
      slot.raw.venue = 'MUTATED';
    }).toThrow(TypeError);
    expect(() => {
      practice.findings.push({});
    }).toThrow(TypeError);
    expect(slot.venue).toBe('Orchard Park');
  });
});

describe('season-2026 practice corpus :: every file, every row', () => {
  it('parses all thirteen files with a strict schema each and drops nothing', () => {
    expect(Object.keys(SEASON_2026_PRACTICE_SCHEMAS).sort()).toEqual(
      [...SEASON_2026_PRACTICE_FILES].sort()
    );
    expect(Object.keys(SEASON_2026_PRACTICE_COLUMNS).sort()).toEqual(
      [...SEASON_2026_PRACTICE_FILES].sort()
    );
    let filesChecked = 0;
    for (const fileName of SEASON_2026_PRACTICE_FILES) {
      const counts = practice.meta.files[fileName];
      expect(counts.rowsRead, fileName).toBeGreaterThan(0);
      expect(counts.rowsParsed, fileName).toBe(counts.rowsRead);
      filesChecked += 1;
    }
    expect(filesChecked).toBe(13);
    expect(practice.meta.rowsParsed).toBe(practice.meta.rowsRead);
    expect(practice.meta.rowsRead).toBe(
      SEASON_2026_PRACTICE_FILES.reduce((sum, f) => sum + practice.meta.files[f].rowsRead, 0)
    );
  });

  it('matches the row counts the README table states', () => {
    expect(practice.practiceSlots).toHaveLength(457);
    expect(practice.fieldAliases).toHaveLength(20);
    expect(practice.fieldConstraints).toHaveLength(13);
    expect(practice.coachRegistrations).toHaveLength(201);
    expect(practice.playerRegistrations).toHaveLength(1153);
    expect(practice.gameChanges).toHaveLength(167);
    expect(practice.selectCoaches).toHaveLength(22);
    expect(practice.permits).toHaveLength(4);
    expect(practice.permitReservations).toHaveLength(767);
    expect(practice.fieldInventory).toHaveLength(14);
    expect(practice.fieldCodeNames).toHaveLength(27);
    expect(practice.weeklyAvailability).toHaveLength(42);
    expect(practice.fieldEquipment).toHaveLength(9);
  });

  it('accounts for every finding under a code from the frozen table', () => {
    const codes = Object.values(F);
    expect(codes.length).toBeGreaterThan(0);
    expect(Object.keys(practice.findingsByCode).sort()).toEqual([...codes].sort());
    const total = codes.reduce((sum, code) => sum + practice.findingsByCode[code], 0);
    expect(total).toBe(practice.findings.length);
    expect(practice.findings.length).toBeGreaterThan(0);
    for (const finding of practice.findings) expect(codes).toContain(finding.code);
  });

  it('grades every code in the frozen severity table, and every finding carries its grade', () => {
    const codes = Object.values(F);
    expect(Object.keys(SEASON_2026_PRACTICE_FINDING_SEVERITY).sort()).toEqual([...codes].sort());
    const grades = new Set(Object.values(SEASON_2026_PRACTICE_FINDING_SEVERITY));
    expect([...grades].sort()).toEqual(['blocking', 'compromise', 'info']);
    for (const finding of practice.findings) {
      expect(finding.severity).toBe(SEASON_2026_PRACTICE_FINDING_SEVERITY[finding.code]);
    }
    // Nothing in the shipped corpus is blocking; the two blocking codes are
    // driven by the positive controls below.
    expect(practice.findings.filter((f) => f.severity === 'blocking')).toHaveLength(0);
    expect(practice.findings.filter((f) => f.severity === 'compromise').length).toBeGreaterThan(0);
  });
});

describe('season-2026 practice corpus :: practice grid', () => {
  it('has 457 rows across 7 source sheets and 88 distinct teams', () => {
    const sheets = tally(practice.practiceSlots, (slot) => slot.sourceSheet);
    expect(sheets.size).toBe(7);
    expect([...sheets.values()].reduce((a, b) => a + b, 0)).toBe(457);
    expect(new Set(practice.practiceSlots.map((slot) => slot.teamCode)).size).toBe(88);
  });

  it('uses two slot regimes and no third', () => {
    const regimes = regimesOf(practice.practiceSlots);
    expect(regimes.size).toBe(2);
    expect(regimes.get(45)).toEqual(['16:00', '16:45', '17:30']);
    expect(regimes.get(60)).toEqual(['16:00', '17:00', '18:00']);
    // Every row sits in one of the two: no 60/50/40 phased shortening is present.
    for (const slot of practice.practiceSlots) {
      expect(regimes.get(slot.durationMinutes)).toContain(slot.start);
      expect(slot.endMinutes - slot.startMinutes).toBe(slot.durationMinutes);
    }
  });

  it('runs Monday to Friday with 19 Friday rows', () => {
    const days = tally(practice.practiceSlots, (slot) => slot.weekday);
    expect([...days.keys()].sort()).toEqual(['FRI', 'MON', 'THU', 'TUE', 'WED']);
    expect(days.get('FRI')).toBe(19);
    expect([...days.values()].reduce((a, b) => a + b, 0)).toBe(457);
  });

  it('keeps the 28 unresolved-venue rows as records and as named findings', () => {
    const unresolved = practice.practiceSlots.filter((slot) => !slot.venueResolved);
    expect(unresolved).toHaveLength(28);
    for (const slot of unresolved) expect(slot.venue).toBe(UNRESOLVED_VENUE_TOKEN);
    const findings = findingsOf(F.PRACTICE_VENUE_UNRESOLVED);
    expect(findings).toHaveLength(28);
    expect(findings.map((finding) => finding.rowIndex)).toEqual(
      unresolved.map((slot) => slot.rowIndex)
    );
    for (const finding of findings) expect(finding.raw.venue).toBe(UNRESOLVED_VENUE_TOKEN);
    // They all come from one sheet — the Select plan whose section headings
    // were prose — and it contributes nothing else.
    const sheets = new Set(unresolved.map((slot) => slot.sourceSheet));
    expect(sheets.size).toBe(1);
    const [sheet] = sheets;
    expect(practice.practiceSlots.filter((slot) => slot.sourceSheet === sheet)).toHaveLength(28);
  });

  it('carries two 142-row sheets that differ only in being a makeup week', () => {
    const sheets = tally(practice.practiceSlots, (slot) => slot.sourceSheet);
    const pair = [...sheets].filter(([, count]) => count === 142).map(([name]) => name);
    expect(pair).toHaveLength(2);
    // Everything but the row's identity and the sheet it came from.
    const strip = (slot) => ({
      venue: slot.venue,
      field: slot.field,
      subunit: slot.subunit,
      day: slot.day,
      start: slot.start,
      durationMinutes: slot.durationMinutes,
      teamCode: slot.teamCode,
      raw: { ...slot.raw, source_sheet: null },
    });
    const [a, b] = pair.map((name) =>
      practice.practiceSlots.filter((slot) => slot.sourceSheet === name).map(strip)
    );
    expect(a).toHaveLength(142);
    expect(a).toEqual(b);
  });
});

describe('season-2026 practice corpus :: the two decoder rings', () => {
  it('shares 20 codes and disagrees on exactly 12 of them', () => {
    expect(practice.decoderRings.shared).toHaveLength(20);
    expect(practice.decoderRings.disagreements).toHaveLength(12);
    expect(findingsOf(F.DECODER_RINGS_DISAGREE)).toHaveLength(12);
    // The README table names 9; the corpus carries 3 more it does not list.
    const codes = practice.decoderRings.disagreements.map((entry) => entry.code).sort();
    expect(codes).toEqual(
      [
        '7v7 Field 1',
        '9v9 Field 1',
        ...[1, 2, 3, 4, 5, 6, 7].map((n) => `Junior Field ${n}`),
        '9v9 Field 2',
        '7v7 Field 2',
        '11v11 Field 2',
      ].sort()
    );
    // Neither side is marked authoritative, so both labels are carried.
    const byCode = new Map(practice.decoderRings.disagreements.map((e) => [e.code, e]));
    expect(byCode.get('7v7 Field 1')).toEqual({
      code: '7v7 Field 1',
      practiceSheet: 'Cedarbrook Park Field 1',
      fieldsSheet: 'Larkfield Green Field 2?',
      fieldsSheetConfirmed: null,
    });
    expect(byCode.get('9v9 Field 1').practiceSheet).toBe('Rookery Park Turf 2A');
    expect(byCode.get('9v9 Field 1').fieldsSheet).toBe('Rookerie Park Turf 2A');
    expect(byCode.get('11v11 Field 2').practiceSheet).toBeNull();
    // "Neither side is marked authoritative" is derived, not assumed: the
    // fields sheet's `confirmed` column is carried on every disagreement and
    // is empty on all of them — and on all 27 rows of the sheet.
    for (const entry of practice.decoderRings.disagreements) {
      expect(entry.fieldsSheetConfirmed).toBeNull();
    }
    expect(practice.fieldCodeNames.filter((row) => row.confirmed !== null)).toHaveLength(0);
    expect(practice.fieldCodeNames).toHaveLength(27);
    expect(findingsOf(F.DUPLICATE_DECODER_CODE)).toHaveLength(0);
  });

  it('keeps the source\'s own "?" and the blank alias as findings', () => {
    const uncertain = findingsOf(F.DECODER_RING_UNCERTAIN);
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0].subject).toBe('7v7 Field 1');
    expect(practice.fieldCodeNames.filter((row) => row.uncertain)).toHaveLength(1);
    const blank = findingsOf(F.DECODER_RING_ALIAS_BLANK);
    expect(blank).toHaveLength(1);
    expect(blank[0].subject).toBe('11v11 Field 2');
    // A label with no venue is the other way an alias escapes every venue
    // join; it is a finding, never a silent skip.
    const venueBlank = findingsOf(F.DECODER_RING_ALIAS_VENUE_BLANK);
    expect(venueBlank.map((f) => f.subject)).toEqual(['11v11 Field 1']);
    expect(venueBlank[0].raw.actual_label).toBe('Willowmead Park Turf');
    // The two excluded aliases are exactly the two findings: 20 = 18 + 1 + 1.
    expect(practice.meta.examined.aliasesWithVenue + blank.length + venueBlank.length).toBe(20);
  });
});

describe('season-2026 practice corpus :: field constraints and closures', () => {
  it('has 13 constraint rows, three of them season-long closures', () => {
    expect(practice.fieldConstraints).toHaveLength(13);
    const closures = practice.fieldConstraints.filter((row) => row.seasonLong);
    expect(closures.map((row) => row.venue).sort()).toEqual([
      'Cedarbrook Park',
      'Fivepines Park',
      'Quarrywood Park',
    ]);
    for (const row of closures) {
      expect(row.allFields).toBe(true);
      expect(row.spanDays).toBeGreaterThanOrEqual(SEASON_LONG_CLOSURE_MIN_DAYS);
    }
    // The criterion separates them from everything else by a wide margin.
    const others = practice.fieldConstraints.filter((row) => !row.seasonLong);
    expect(others).toHaveLength(10);
    const longestOther = Math.max(...others.filter((r) => r.allFields).map((r) => r.spanDays));
    expect(longestOther).toBe(1);
    // The adjacency rule spans the season too but is not an all-fields closure.
    const spacing = others.find((row) => row.reason === 'Spacing');
    expect(spacing).toMatchObject({ venue: 'Alder Park', fields: 'Adjacent Fields' });
    expect(spacing.spanDays).toBeGreaterThanOrEqual(SEASON_LONG_CLOSURE_MIN_DAYS);
  });

  it('reports the Excel-corrupted fields cell rather than reading it as a date', () => {
    const findings = findingsOf(F.CONSTRAINT_FIELDS_EXCEL_DATE_CORRUPTION);
    expect(findings).toHaveLength(1);
    expect(findings[0].raw.fields).toBe('2026-01-07');
    const row = practice.fieldConstraints[findings[0].rowIndex];
    expect(row).toMatchObject({
      venue: 'Maplewood',
      fields: '2026-01-07',
      reason: 'Gardening Day',
    });
  });

  it('points "7v7 Field 1" at a venue closed all season, and eight aliases at Maplewood', () => {
    const closed = findingsOf(F.ALIAS_RESOLVES_TO_CLOSED_VENUE);
    expect(closed).toHaveLength(1);
    expect(closed[0].subject).toBe('7v7 Field 1');
    expect(closed[0].detail).toBe('resolves to Cedarbrook Park, Offline 2026-08-01 to 2026-11-28');
    expect(practice.meta.examined.aliasesWithVenue).toBe(18);

    const maplewood = practice.fieldAliases.filter((alias) => alias.venue === 'Maplewood');
    expect(maplewood).toHaveLength(8);
    const maplewoodClosures = practice.fieldConstraints.filter(
      (row) => row.venue === 'Maplewood' && row.allFields
    );
    expect(maplewoodClosures.map((row) => row.dateStart)).toEqual(['2026-09-24', '2026-10-23']);
  });
});

describe('season-2026 practice corpus :: registrations', () => {
  it('has 201 coach registrations, 19 naming a second player', () => {
    expect(practice.coachRegistrations).toHaveLength(201);
    const second = practice.coachRegistrations.filter((row) => row.players[1].key !== null);
    expect(second).toHaveLength(19);
    for (const row of practice.coachRegistrations) {
      expect(row.players.map((p) => p.slot)).toEqual([1, 2]);
      expect(row.preferredCoCoaches.map((c) => c.slot)).toEqual([1, 2]);
    }
  });

  it('splits the preferred co-coach (column 1) exactly as the README states', () => {
    const classes = tally(practice.coachRegistrations, (row) => row.preferredCoCoaches[0].refClass);
    expect(Object.fromEntries(classes)).toEqual({
      named: 71,
      'named-in-prose': 24,
      narrative: 29,
      unresolved: 9,
      declined: 3,
      none: 65,
    });
    expect([...classes.values()].reduce((a, b) => a + b, 0)).toBe(201);
    // A key is present exactly when the class says it was resolved.
    for (const row of practice.coachRegistrations) {
      for (const coCoach of row.preferredCoCoaches) {
        const resolved = coCoach.refClass === 'named' || coCoach.refClass === 'named-in-prose';
        expect(coCoach.key !== null, `${row.personKey} co-coach ${coCoach.slot}`).toBe(resolved);
      }
    }
    // Every class the schema admits actually occurs somewhere in the file.
    const seen = new Set(
      practice.coachRegistrations.flatMap((row) => [
        ...row.players.map((p) => p.refClass),
        ...row.preferredCoCoaches.map((c) => c.refClass),
      ])
    );
    expect([...seen].sort()).toEqual([...REGISTRATION_REF_CLASSES].sort());
  });

  it('has 1153 players, 29 playing up, with blank age codes only for Minis', () => {
    expect(practice.playerRegistrations).toHaveLength(1153);
    expect(practice.playerRegistrations.filter((row) => row.playingUp)).toHaveLength(29);
    const blankCode = practice.playerRegistrations.filter((row) => row.ageGroupCode === null);
    expect(blankCode.length).toBeGreaterThan(0);
    for (const row of blankCode) expect(row.program).toBe('Minis');
    expect(practice.playerRegistrations.filter((row) => row.program === 'Minis')).toHaveLength(
      blankCode.length
    );
  });

  it('names the duplicate keys, the unregistered players and the implausible birth years', () => {
    expect(findingsOf(F.DUPLICATE_PERSON_KEY).map((f) => f.subject)).toEqual(['verity bramteford']);
    expect(
      findingsOf(F.DUPLICATE_PLAYER_KEY)
        .map((f) => f.subject)
        .sort()
    ).toEqual(['ilse wyndafield', 'imre hesgaley']);
    expect(practice.meta.examined.namedPlayerKeys).toBe(145 + 19);
    expect(findingsOf(F.PLAYER_KEY_NOT_REGISTERED)).toHaveLength(9);
    const birthYears = findingsOf(F.BIRTH_YEAR_IMPLAUSIBLE);
    expect(birthYears).toHaveLength(9);
    for (const finding of birthYears) {
      expect(finding.raw.player_1_birth_year).toBe(String(practice.seasonYear));
    }
    expect(practice.meta.examined.coCoachKeys).toBe(108);
    // Ten preferred co-coach keys resolve to no coach anywhere; seven of them
    // are registered players' keys, which is a different thing from nowhere.
    expect(findingsOf(F.CO_COACH_KEY_UNKNOWN)).toHaveLength(3);
    const isPlayer = findingsOf(F.CO_COACH_KEY_IS_PLAYER);
    expect(isPlayer).toHaveLength(7);
    const playerKeys = new Set(practice.playerRegistrations.map((row) => row.playerKey));
    for (const finding of isPlayer) expect(playerKeys.has(finding.subject)).toBe(true);
    for (const finding of findingsOf(F.CO_COACH_KEY_UNKNOWN)) {
      expect(playerKeys.has(finding.subject)).toBe(false);
    }
  });
});

describe('season-2026 practice corpus :: permits', () => {
  it('has 4 permits and 767 reservation windows from 2026-08-10 to 2026-12-20', () => {
    expect(practice.permits).toHaveLength(4);
    expect(practice.permitReservations).toHaveLength(767);
    const dates = practice.permitReservations.map((row) => row.date).sort();
    expect(dates[0]).toBe('2026-08-10');
    expect(dates[dates.length - 1]).toBe('2026-12-20');
    const permitIds = new Set(practice.permits.map((row) => row.permitId));
    for (const row of practice.permitReservations) expect(permitIds.has(row.permitId)).toBe(true);
    for (const permit of practice.permits) {
      expect(
        practice.permitReservations.filter((row) => row.permitId === permit.permitId).length
      ).toBeGreaterThan(0);
    }
    // Single producer: the game corpus states the year; every reservation is
    // checked against it rather than defining it.
    expect(practice.seasonYear).toBe(season.seasonYear);
    expect(practice.meta.examined.reservations).toBe(767);
    expect(findingsOf(F.PERMIT_RESERVATION_OUTSIDE_SEASON)).toHaveLength(0);
  });

  it('keeps every reservation on the weekday its date falls on', () => {
    expect(findingsOf(F.PERMIT_DAY_MISMATCH)).toHaveLength(0);
    const weekdays = tally(practice.permitReservations, (row) => row.weekday);
    expect(weekdays.size).toBe(7);
  });

  it('attaches Field Lights to the Summit HS permit and to nothing else', () => {
    const summit = practice.permits.filter((row) => row.venue === 'Summit HS');
    expect(summit).toHaveLength(1);
    const lit = practice.permitReservations.filter((row) => row.services === 'Field Lights');
    expect(lit.length).toBeGreaterThan(0);
    expect(new Set(lit.map((row) => row.permitId))).toEqual(new Set([summit[0].permitId]));
    const summitRows = practice.permitReservations.filter(
      (row) => row.permitId === summit[0].permitId
    );
    expect(summitRows).toHaveLength(lit.length);
  });

  it('reserves the Alder Park half-pitches as named facilities', () => {
    const halves = practice.permitReservations.filter(
      (row) => row.venue === 'Alder Park' && /Soccer [1-4]A\/[1-4]B/.test(row.facility)
    );
    expect(new Set(halves.map((row) => row.facility)).size).toBe(4);
    expect(halves.length).toBeGreaterThan(0);
  });
});

describe('season-2026 practice corpus :: the fields workbook', () => {
  it('has 14 inventory rows, 27 code names, 42 availability rows and 9 equipment rows', () => {
    expect(practice.fieldInventory).toHaveLength(14);
    expect(findingsOf(F.DUPLICATE_INVENTORY_VENUE).map((f) => f.subject)).toEqual([
      'Willowmead Park',
    ]);
    expect(practice.fieldCodeNames).toHaveLength(27);
    expect(practice.weeklyAvailability).toHaveLength(42);
    expect(practice.fieldEquipment).toHaveLength(9);
    expect(practice.fieldEquipment.filter((row) => row.quantity === null)).toHaveLength(1);
  });

  it('reports every Excel-corrupted availability row, with the corruption legible', () => {
    const corrupted = findingsOf(F.AVAILABILITY_EXCEL_DATE_CORRUPTION);
    expect(corrupted).toHaveLength(15);
    for (const finding of corrupted) {
      const row = practice.weeklyAvailability[finding.rowIndex];
      expect(row.interpretation).toBe('excel-date-corruption');
      expect(row.rawValue).toBe(finding.raw.raw_value);
      expect(finding.detail).toMatch(/the source labels it so$/);
      // `4-7` became 2026-04-07; the interpreted window is 16:00-19:00.
      const [, month, day] = row.rawValue.match(/^\d{4}-(\d{2})-(\d{2})$/);
      expect(row.startMinutes).toBe((Number(month) + 12) * 60);
      expect(row.endMinutes).toBe((Number(day) + 12) * 60);
    }
    expect(findingsOf(F.AVAILABILITY_UNPARSED)).toHaveLength(0);
    const interpretations = tally(practice.weeklyAvailability, (row) => row.interpretation);
    expect([...interpretations.keys()].filter(Boolean).sort()).toEqual(
      AVAILABILITY_INTERPRETATIONS.filter((label) => label !== 'unparsed').sort()
    );
    // Rows with a window and rows without partition the file.
    const withWindow = practice.weeklyAvailability.filter((row) => row.startMinutes !== null);
    expect(withWindow.length).toBeGreaterThan(0);
    for (const row of withWindow) expect(row.endMinutes).toBeGreaterThan(row.startMinutes);
    for (const row of practice.weeklyAvailability) {
      expect(row.startMinutes === null).toBe(row.endMinutes === null);
    }
  });
});

describe('season-2026 practice corpus :: game change log', () => {
  it('dates every change in the season and parses both sides', () => {
    expect(practice.gameChanges).toHaveLength(167);
    for (const change of practice.gameChanges) {
      expect(change.date.slice(0, 4)).toBe(String(practice.seasonYear));
      expect(change.now.unscheduled).toBe(false);
      expect(change.now.minutes).not.toBeNull();
      expect(change.now.location).not.toBeNull();
      if (change.was.unscheduled) expect(change.was.minutes).toBeNull();
      else expect(change.was.location).not.toBeNull();
    }
    expect(practice.gameChanges.filter((c) => c.dateNote !== null).map((c) => c.dateLabel)).toEqual(
      ['Nov 08 (Sun)']
    );
    // The one note the log carries agrees with the year the loader inferred.
    expect(findingsOf(F.CHANGE_LOG_DAY_MISMATCH)).toHaveLength(0);
    expect(practice.gameChanges.find((c) => c.dateNote === 'Sun').date).toBe('2026-11-08');
    const added = practice.gameChanges.filter((change) => change.was.unscheduled);
    expect(added.length).toBeGreaterThan(0);
    expect(added.length).toBeLessThan(practice.gameChanges.length);
  });
});

describe('season-2026 practice corpus :: cross-corpus join', () => {
  it('resolves every practice team on the roster, and exactly one plays no game', () => {
    expect(practice.meta.examined.rosterTeams).toBe(132);
    expect(practice.meta.examined.practiceTeams).toBe(88);
    expect(findingsOf(F.PRACTICE_TEAM_NOT_ON_ROSTER)).toHaveLength(0);
    const noGame = findingsOf(F.PRACTICE_TEAM_PLAYS_NO_GAME);
    expect(noGame.map((f) => f.subject)).toEqual(['16BSelect02']);
    // The universe is the roster, not the grid: the one roster team with no
    // game is the same team, seen from the other side.
    expect(practice.meta.examined.rosterTeamsWithGame).toBe(131);
    expect(season.teams.find((team) => team.id === '16BSelect02').observedDivisions).toEqual([]);
  });

  it('counts the game-playing roster teams that hold no practice slot', () => {
    // The source claimed 65 (kept visible in the README as the source's
    // claim). Enumerated from the roster the corpus says 44; from every named
    // side of ../combined_schedule.csv (Minis sessions and visiting clubs
    // included) it says 53. Neither is 65; the README now carries both.
    const none = findingsOf(F.ROSTER_TEAM_HOLDS_NO_PRACTICE);
    expect(none).toHaveLength(44);
    expect(none.length + 88 - 1).toBe(practice.meta.examined.rosterTeamsWithGame);
    const named = new Set();
    for (const game of season.combinedGames) {
      if (game.homeTeamId) named.add(game.homeTeamId);
      if (game.awayTeamId) named.add(game.awayTeamId);
    }
    const practiceTeams = new Set(practice.practiceSlots.map((slot) => slot.teamCode));
    expect([...named].filter((id) => !practiceTeams.has(id))).toHaveLength(53);
  });

  it('says which registration person keys are on the roster and which were minted', () => {
    expect(practice.meta.examined.rosterPeople).toBe(196);
    expect(practice.meta.examined.registrationPersonKeys).toBe(201 + 22);
    const minted = findingsOf(F.PERSON_KEY_MINTED);
    const byFile = tally(minted, (finding) => finding.file);
    expect(byFile.get('coach_registration.csv')).toBe(35);
    expect(byFile.get('select_coaches.csv')).toBe(7);
    expect(minted).toHaveLength(42);
    const rosterKeys = new Set(season.assignments.map((row) => row.personKey));
    for (const finding of minted) expect(rosterKeys.has(finding.subject)).toBe(false);
    const onRoster = practice.coachRegistrations.filter((row) => rosterKeys.has(row.personKey));
    expect(onRoster).toHaveLength(201 - 35);
  });

  it('reports where select_coaches.csv and ../coach_roster.csv disagree, in both directions', () => {
    expect(practice.meta.examined.selectCoachRows).toBe(22);
    // Sheet → roster. "Not on the team" and "on the team at another slot" are
    // different findings: slot is a clash-breaker, not a role.
    const notOnTeam = findingsOf(F.SELECT_COACH_NOT_ON_ROSTER_TEAM);
    const slotDiffers = findingsOf(F.SELECT_COACH_SLOT_DIFFERS);
    expect(notOnTeam).toHaveLength(8);
    expect(slotDiffers.map((f) => f.subject)).toEqual(['19BSelect01 emerson crane']);
    expect(slotDiffers[0].detail).toBe('sheet slot 1; roster slot 2');
    // Every minted select coach is not on the team; one rostered person is too.
    const mintedSelect = new Set(
      findingsOf(F.PERSON_KEY_MINTED)
        .filter((f) => f.file === 'select_coaches.csv')
        .map((f) => f.subject)
    );
    expect(mintedSelect.size).toBe(7);
    expect(
      notOnTeam.filter((f) => !mintedSelect.has(f.raw.person_key)).map((f) => f.raw.person_key)
    ).toEqual(['teagan hobbes']);
    expect(22 - notOnTeam.length - slotDiffers.length).toBe(13);

    // Roster → sheet, enumerated from the roster's Select teams so a coach the
    // sheet leaves out is reported rather than absent.
    expect(practice.meta.examined.rosterSelectTeams).toBe(14);
    expect(practice.meta.examined.rosterSelectCoaches).toBeGreaterThan(0);
    const omitted = findingsOf(F.SELECT_COACH_OMITTED_BY_SHEET);
    expect(omitted.map((f) => f.subject.split(' ').slice(1).join(' ')).sort()).toEqual([
      'lena jute',
      'nathaniel deverell',
      'oakley pryce',
      'perry yeats',
      'remy zorn',
      'tatum tolliver',
      'vesper orton',
      'wren reed',
    ]);
    // Every Select roster coach is either listed by the sheet or reported.
    const listed = practice.meta.examined.rosterSelectCoaches - omitted.length;
    expect(listed).toBe(22 - notOnTeam.length);
  });

  it('names the venues this corpus uses that the game corpus does not know by name', () => {
    expect(practice.meta.examined.venueNames).toBeGreaterThan(0);
    // Every file with a `venue` column was joined, the list being derived from
    // the column contracts rather than written down.
    const venueFiles = SEASON_2026_PRACTICE_FILES.filter((file) =>
      SEASON_2026_PRACTICE_COLUMNS[file].includes('venue')
    );
    expect(venueFiles).toHaveLength(9);
    expect(practice.meta.examined.venueFiles).toBe(9);
    const unknown = findingsOf(F.VENUE_NOT_IN_GAME_CORPUS);
    const byFile = new Map();
    for (const finding of unknown) {
      if (!byFile.has(finding.file)) byFile.set(finding.file, []);
      byFile.get(finding.file).push(finding.subject);
    }
    // The grid says `Maplewood`; the game corpus says `Maplewood Back` and
    // `Maplewood Front`. Larkfield Green hosts no game at all.
    expect(byFile.get('practice_grid.csv').sort()).toEqual(['Larkfield Green', 'Maplewood']);
    expect(byFile.get('permits.csv')).toEqual(['Maplewood']);
    expect(byFile.get('permit_reservations.csv')).toEqual(['Maplewood']);
    // The fields workbook's spelling variant surfaces from its own sheet too.
    expect(byFile.get('field_code_names.csv')).toContain('Rookerie Park');
    expect(byFile.get('practice_field_aliases.csv')).toContain('Rookery Park');
    expect(new Set(unknown.map((f) => f.file)).size).toBe(9);
    expect(byFile.get('field_constraints.csv').sort()).toEqual([
      'Cedarbrook Park',
      'Fivepines Park',
      'Maplewood',
      'Quarrywood Park',
    ]);
    // Meta-assertion: the join is real — most grid venues do resolve.
    const gridVenues = new Set(
      practice.practiceSlots.filter((slot) => slot.venueResolved).map((slot) => slot.venue)
    );
    expect(gridVenues.size).toBe(5);
    expect([...gridVenues].filter((venue) => season.venuesByName[venue])).toHaveLength(3);
  });

  it('records the 6 / 22 / 136 anonymisation figures against the game corpus without resolving them', () => {
    // The README's join reports 6 venues, 22 fields and 136 team codes. The
    // game corpus has 7 venues in play, 24 field ids in the combined schedule
    // and 132 roster teams. 136 has two arithmetic readings and this test
    // chooses neither; 6 and 22 have none we could find.
    const combinedVenues = new Set(season.combinedGames.map((game) => game.venue));
    const combinedFields = new Set(season.combinedGames.map((game) => game.fieldId));
    expect(combinedVenues.size).toBe(7);
    expect(combinedFields.size).toBe(24);
    const named = new Set();
    for (const game of season.combinedGames) {
      if (game.homeTeamId) named.add(game.homeTeamId);
      if (game.awayTeamId) named.add(game.awayTeamId);
    }
    const rosterIds = new Set(season.teams.map((team) => team.id));
    const minis = [...named].filter((id) => /^Minis[A-D]$/.test(id));
    const visiting = [...named].filter((id) => !rosterIds.has(id) && !/^Minis[A-D]$/.test(id));
    expect(minis).toHaveLength(4);
    expect(visiting).toHaveLength(5);
    expect(practice.meta.examined.rosterTeamsWithGame + visiting.length).toBe(136);
    expect(rosterIds.size + minis.length).toBe(136);
  });
});

describe('season-2026 practice corpus :: positive controls', () => {
  it('refuses a column the contract does not know, and an empty file', () => {
    // A column added to the header only: PapaParse keys the short row by the
    // cells it has, so this is the variant a per-row check alone lets through.
    const headerOnly = csvRow('practice_grid.csv', GRID_ROW).replace(
      'team_code',
      'team_code,extra'
    );
    expect(() => expectCsvColumns(headerOnly, 'practice_grid.csv')).toThrow(/header/);
    // A column added with a cell in every row.
    const full = csvRow('practice_grid.csv', GRID_ROW)
      .replace('team_code', 'team_code,extra')
      .replace('05GMicro04', '05GMicro04,x');
    expect(() => expectCsvColumns(full, 'practice_grid.csv')).toThrow(/header/);
    // A row longer than the header it sits under.
    const longRow = csvRow('practice_grid.csv', GRID_ROW).replace('05GMicro04', '05GMicro04,x');
    expect(() => expectCsvColumns(longRow, 'practice_grid.csv')).toThrow(/columns/);
    // A header with the right columns and nothing under it.
    const columns = SEASON_2026_PRACTICE_COLUMNS['practice_grid.csv'].join(',');
    expect(() => expectCsvColumns(`${columns}\n`, 'practice_grid.csv')).toThrow(/no rows read/);
    expect(() => expectCsvColumns(csvRow('permits.csv', {}), 'not_a_file.csv')).toThrow(
      /no column contract/
    );
  });

  it('refuses a record with an unknown enum value or an unknown key', () => {
    const bad = csvRow('coach_registration.csv', {
      coach_name: 'A B',
      person_key: 'a b',
      player_1_ref_class: 'guessed',
      player_2_ref_class: 'none',
      preferred_co_coach_1_class: 'none',
      preferred_co_coach_2_class: 'none',
    });
    expect(() => parseCoachRegistration(bad, { seasonYear: 2026 })).toThrow();
    const schema = SEASON_2026_PRACTICE_SCHEMAS['permits.csv'];
    const ok = {
      rowIndex: 0,
      permitId: 'P',
      venue: 'V',
      event: 'E',
      issued: '2026-08-01',
      maxDailyAttendance: 1,
      sourcePages: 1,
      raw: {},
    };
    expect(schema.parse(ok)).toEqual(ok);
    expect(() => schema.parse({ ...ok, surprise: true })).toThrow();
    expect(() => schema.parse({ ...ok, issued: '08/01/2026' })).toThrow();
  });

  it('detects a third slot regime', () => {
    const third = parsePracticeGrid(
      csvRows('practice_grid.csv', [
        GRID_ROW,
        { ...GRID_ROW, start: '17:00', duration_minutes: '60' },
        { ...GRID_ROW, start: '18:30', duration_minutes: '30' },
      ])
    );
    expect(third.rowsRead).toBe(3);
    expect(regimesOf(third.records).size).toBe(3);
  });

  it('detects a reconciled decoder ring as fewer than 12 disagreements', () => {
    const reconciled = practice.fieldAliases.map((alias) =>
      alias.displayName === '9v9 Field 1'
        ? { ...alias, actualLabel: alias.actualLabel.replace('Rookery', 'Rookerie') }
        : alias
    );
    const result = compareDecoderRings(reconciled, practice.fieldCodeNames);
    expect(result.shared).toHaveLength(20);
    expect(result.disagreements).toHaveLength(11);
    expect(
      compareDecoderRings(practice.fieldAliases, practice.fieldCodeNames).disagreements
    ).toHaveLength(12);
  });

  it('raises the unparsed-availability and permit-day findings when a row calls for them', () => {
    const unparsed = parseWeeklyAvailability(
      csvRow('field_weekly_availability.csv', {
        venue: 'V',
        day: 'Mon',
        raw_value: 'ask Pat',
        interpreted_window: '',
        interpretation: 'unparsed',
      })
    );
    expect(unparsed.records).toHaveLength(1);
    expect(unparsed.findings.map((f) => f.code)).toEqual([F.AVAILABILITY_UNPARSED]);
    expect(unparsed.findings[0].raw.raw_value).toBe('ask Pat');

    // Corruption is judged from the data: a date-shaped raw value with no
    // label is still reported, and the finding says the label is missing.
    const unlabelled = parseWeeklyAvailability(
      csvRow('field_weekly_availability.csv', {
        venue: 'V',
        day: 'Mon',
        raw_value: '2026-04-07',
        interpreted_window: '16:00-19:00',
        interpretation: '',
      })
    );
    expect(unlabelled.findings.map((f) => f.code)).toEqual([F.AVAILABILITY_EXCEL_DATE_CORRUPTION]);
    expect(unlabelled.findings[0].detail).toMatch(/labels it null/);
    expect(unlabelled.records[0].interpretation).toBeNull();

    const wrongDay = parsePermitReservations(
      csvRow('permit_reservations.csv', {
        permit_id: 'P',
        venue: 'V',
        date: '2026-08-10',
        day: 'Tuesday',
        start: '18:00',
        end: '20:00',
        facility: 'F',
        services: '',
      })
    );
    expect(wrongDay.findings.map((f) => f.code)).toEqual([F.PERMIT_DAY_MISMATCH]);
    expect(wrongDay.records[0].weekday).toBe('MON');
  });

  it('raises the implausible-birth-year finding only when told the season year', () => {
    const row = csvRow('coach_registration.csv', {
      coach_name: 'A B',
      person_key: 'a b',
      player_1_key: 'c d',
      player_1_ref_class: 'named',
      player_1_gender: 'male',
      player_1_birth_year: '2026',
      player_2_ref_class: 'none',
      preferred_co_coach_1_class: 'none',
      preferred_co_coach_2_class: 'none',
    });
    expect(parseCoachRegistration(row, { seasonYear: 2026 }).findings.map((f) => f.code)).toEqual([
      F.BIRTH_YEAR_IMPLAUSIBLE,
    ]);
    expect(parseCoachRegistration(row, { seasonYear: 2027 }).findings).toEqual([]);
    // Without a year the check cannot run, and it refuses rather than not running.
    expect(() => parseCoachRegistration(row, /** @type {any} */ (undefined))).toThrow(/seasonYear/);

    // The player sheet holds the same contract; the corpus's 2008-2023 range
    // never exercises it, so the control does.
    const player = csvRow('player_registration.csv', {
      player_name: 'A B',
      player_key: 'a b',
      gender: 'f',
      birth_year: '2026',
      age_group: '4',
      program: 'Minis',
    });
    expect(
      parsePlayerRegistration(player, { seasonYear: 2026 }).findings.map((f) => f.code)
    ).toEqual([F.BIRTH_YEAR_IMPLAUSIBLE]);
    expect(parsePlayerRegistration(player, { seasonYear: 2027 }).findings).toEqual([]);
    expect(() => parsePlayerRegistration(player, /** @type {any} */ (undefined))).toThrow(
      /seasonYear/
    );
    expect(practice.playerRegistrations.every((r) => r.birthYear < practice.seasonYear)).toBe(true);
  });

  it('raises the venue-blank alias and the out-of-season reservation', () => {
    const alias = parsePracticeFieldAliases(
      csvRow('practice_field_aliases.csv', { display_name: 'X', actual_label: 'Somewhere Turf' })
    );
    expect(alias.findings.map((f) => f.code)).toEqual([F.DECODER_RING_ALIAS_VENUE_BLANK]);
    expect(alias.records[0].venue).toBeNull();

    const parsedWith = (file, result) => ({ ...parsedCorpus, [file]: result });
    const late = crossCorpusFindings(
      parsedWith(
        'permit_reservations.csv',
        parsePermitReservations(
          csvRow('permit_reservations.csv', {
            permit_id: 'P',
            venue: 'Alder Park',
            date: '2027-08-10',
            day: 'Tuesday',
            start: '18:00',
            end: '20:00',
            facility: 'F',
          })
        )
      ),
      season
    );
    expect(
      late.findings.filter((f) => f.code === F.PERMIT_RESERVATION_OUTSIDE_SEASON)
    ).toHaveLength(1);
    expect(late.examined.reservations).toBe(1);
    // …and a sheet that lists nobody for a team reports every roster coach of it.
    const empty = crossCorpusFindings(parsedWith('select_coaches.csv', { records: [] }), season);
    const omitted = empty.findings.filter((f) => f.code === F.SELECT_COACH_OMITTED_BY_SHEET);
    expect(omitted).toHaveLength(empty.examined.rosterSelectCoaches);
    expect(omitted.length).toBeGreaterThan(8);
    for (const f of omitted) expect(f.detail).toMatch(/lists nobody for the team$/);
  });

  it('raises the change-log day mismatch and the duplicate decoder code', () => {
    const log = parseGameChangeLog(
      csvRow('game_change_log.csv', {
        date: 'Nov 08 (Mon)',
        matchup: 'A vs B',
        was: '(not previously scheduled)',
        now: '5:30 PM Alder Park Soccer 2',
        reason: 'r',
      }),
      { seasonYear: 2026 }
    );
    expect(log.findings.map((f) => f.code)).toEqual([F.CHANGE_LOG_DAY_MISMATCH]);
    expect(log.records[0].date).toBe('2026-11-08');

    const ring = parseFieldCodeNames(
      csvRows('field_code_names.csv', [
        { code_name: '7v7 Field 1', actual_label: 'X', venue: 'X' },
        { code_name: '7v7 Field 1', actual_label: 'Y', venue: 'Y' },
      ])
    );
    expect(ring.findings.map((f) => f.code)).toEqual([F.DUPLICATE_DECODER_CODE]);
    expect(ring.findings[0].rowIndex).toBe(1);
    expect(ring.records).toHaveLength(2);
  });
});
