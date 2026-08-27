/**
 * Fixture-integrity tests for the `fixtures/season-2026/` regression corpus.
 *
 * Every assertion here comes from the "Known-good invariants" section of
 * `fixtures/season-2026/README.md`. Derived numbers (durations, permit windows,
 * sunset margins, overlap geometry, the 11v11 block) are computed **from the
 * fixture files themselves** — `game_formats.csv`, `facility_permits.csv`,
 * `sunsets.csv` and `facility_geometry.json` — never hardcoded.
 *
 * Meta-assertion discipline (incident 4 in the fixture README): every check
 * also asserts it examined a non-zero number of records. A check that matches
 * nothing is a loud failure, not a silent pass.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  ageGroupOfDivision,
  computeFixtureChecksums,
  fieldsOverlap,
  findSingleCoachGames,
  fixtureFilePath,
  loadCoachRoster,
  loadSeason2026,
  overlapRootField,
  parseClockMinutes,
  parseFixtureDate,
  parseMinutesRange,
  classifyScheduleRow,
  resolvePermit,
  resolveSunsetMinutes,
  SEASON_2026_FILES,
  SEASON_2026_ROW_KIND,
} from '@squadlogic/core/fixtures/index.js';
import { checkParity, season2026PublishedParityInput } from '@squadlogic/core/publication/index.js';

/** The corpus is loaded once; every test reads from this immutable snapshot. */
const season = loadSeason2026();

/** Sunset margin the README states for unlit games. */
const SUNSET_MARGIN_MINUTES = 15;

/** Rec entities that are Minis *sessions*, not rostered teams. */
const MINIS_SESSION_IDS = [
  ...new Set(
    season.recGames
      .filter((game) => game.kind === SEASON_2026_ROW_KIND.MINIS_SESSION)
      .map((game) => game.homeLabel)
  ),
].sort();

/** Every entity that appears on either side of a published rec row. */
function recEntities() {
  const counts = new Map();
  const homeCounts = new Map();
  for (const game of season.recGames) {
    counts.set(game.homeLabel, (counts.get(game.homeLabel) ?? 0) + 1);
    homeCounts.set(game.homeLabel, (homeCounts.get(game.homeLabel) ?? 0) + 1);
    if (game.awayTeamId) counts.set(game.awayLabel, (counts.get(game.awayLabel) ?? 0) + 1);
  }
  return { counts, homeCounts };
}

describe('season-2026 corpus :: pure parsers', () => {
  it('parses dates, clock times and minute ranges from strings', () => {
    expect(parseFixtureDate('08/22/2026')).toBe('2026-08-22');
    expect(parseClockMinutes('8:30 AM')).toBe(510);
    expect(parseClockMinutes('12:30 PM')).toBe(750);
    expect(parseClockMinutes('12:00 AM')).toBe(0);
    expect(parseClockMinutes('—')).toBeNull();
    expect(parseMinutesRange('85-90 (schedule as 90)')).toMatchObject({
      min: 85,
      max: 90,
      scheduled: 90,
    });
    expect(parseMinutesRange('-')).toBeNull();
  });

  it('classifies every row kind structurally, not by date', () => {
    expect(classifyScheduleRow({ format: '9v9', home: '12B9v902', away: '12B9v909' })).toBe(
      SEASON_2026_ROW_KIND.REC_GAME
    );
    expect(classifyScheduleRow({ format: 'Minis', home: 'MinisA', away: '-' })).toBe(
      SEASON_2026_ROW_KIND.MINIS_SESSION
    );
    expect(classifyScheduleRow({ format: '11v11', home: 'Select Game 7', away: '-' })).toBe(
      SEASON_2026_ROW_KIND.LEAGUE_PLACEHOLDER
    );
    expect(
      classifyScheduleRow({ format: '11v11', home: '14GSelect02', away: 'Visiting Club A - U14G' })
    ).toBe(SEASON_2026_ROW_KIND.EXTERNAL_FIXTURE);
    expect(
      classifyScheduleRow({ format: 'Scrimmage', home: 'Scrimmage - teams TBD', away: '-' })
    ).toBe(SEASON_2026_ROW_KIND.RESERVATION);
    expect(
      classifyScheduleRow({ format: 'Scrimmage', home: '16GSelect01', away: '16GSelect02' })
    ).toBe(SEASON_2026_ROW_KIND.SCRIMMAGE);
  });
});

describe('season-2026 corpus :: read-only guarantee', () => {
  it('leaves every source file byte-identical across a load', () => {
    const before = computeFixtureChecksums();
    expect(Object.keys(before)).toHaveLength(SEASON_2026_FILES.length);
    expect(SEASON_2026_FILES.length).toBeGreaterThan(0);

    loadSeason2026();
    loadCoachRoster({ revision: 'v1' });

    const after = computeFixtureChecksums();
    expect(after).toEqual(before);
    for (const fileName of SEASON_2026_FILES) {
      expect(after[fileName]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('never hands out a mutable view of a source file', () => {
    const path = fixtureFilePath('published_rec_schedule.csv');
    const bytes = readFileSync(path);
    season.recGames[0].raw.Home = 'MUTATED';
    expect(readFileSync(path).equals(bytes)).toBe(true);
    // Restore the in-memory snapshot so later tests see the real value.
    season.recGames[0].raw.Home = season.recGames[0].homeLabel;
  });
});

describe('season-2026 corpus :: headline counts', () => {
  it('has 567 rec games', () => {
    expect(season.recGames).toHaveLength(567);
  });

  it('has 679 combined rows', () => {
    expect(season.combinedGames).toHaveLength(679);
  });

  it('has 132 teams', () => {
    expect(season.teams).toHaveLength(132);
  });

  it('has 215 coach assignments', () => {
    expect(season.assignments).toHaveLength(215);
  });

  it('has 196 distinct people', () => {
    expect(season.people).toHaveLength(196);
    expect(new Set(season.people.map((p) => p.personKey)).size).toBe(196);
  });

  it('has 9 rec Saturdays', () => {
    expect(season.recDates).toHaveLength(9);
    const weekdays = new Set(
      season.recDates.map((date) => new Date(`${date}T12:00:00Z`).getUTCDay())
    );
    expect(weekdays).toEqual(new Set([6])); // 6 = Saturday
  });

  it('has 13 scheduled dates in total', () => {
    expect(season.scheduledDates).toHaveLength(13);
    for (const date of season.recDates) expect(season.scheduledDates).toContain(date);
  });
});

describe('season-2026 corpus :: nothing is flattened away', () => {
  it('preserves every non-rec row kind rather than dropping it', () => {
    const kinds = season.combinedByKind;
    expect(kinds[SEASON_2026_ROW_KIND.REC_GAME]).toHaveLength(531);
    expect(kinds[SEASON_2026_ROW_KIND.MINIS_SESSION]).toHaveLength(36);
    expect(kinds[SEASON_2026_ROW_KIND.LEAGUE_PLACEHOLDER]).toHaveLength(100);
    expect(kinds[SEASON_2026_ROW_KIND.EXTERNAL_FIXTURE]).toHaveLength(8);
    expect(kinds[SEASON_2026_ROW_KIND.SCRIMMAGE]).toHaveLength(3);
    expect(kinds[SEASON_2026_ROW_KIND.RESERVATION]).toHaveLength(1);

    const total = Object.values(kinds).reduce((sum, rows) => sum + rows.length, 0);
    expect(total).toBe(679);
  });

  it('keeps the unnamed "Select Game N" league slots as placeholders', () => {
    const slots = season.combinedByKind[SEASON_2026_ROW_KIND.LEAGUE_PLACEHOLDER];
    expect(slots.length).toBe(100);
    expect(new Set(slots.map((g) => g.homeLabel)).size).toBe(10);
    expect(new Set(slots.map((g) => g.date)).size).toBe(10);
    for (const slot of slots) {
      expect(slot.homeIsPlaceholder).toBe(true);
      expect(slot.homeTeamId).toBeNull();
      expect(slot.awayTeamId).toBeNull();
    }
  });

  it('keeps the single field reservation as a non-game row', () => {
    const reservations = season.combinedByKind[SEASON_2026_ROW_KIND.RESERVATION];
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      date: '2026-08-29',
      venue: 'Alder Park',
      field: 'Pitch 2',
      homeLabel: 'Scrimmage - teams TBD',
      awayTeamId: null,
    });
  });

  it('keeps the scrimmages and records that their footprint is unknown', () => {
    const scrimmages = season.combinedByKind[SEASON_2026_ROW_KIND.SCRIMMAGE];
    expect(scrimmages).toHaveLength(3);
    // TODO(GAP-14): `Scrimmage` has no game_formats.csv row, so the loader must
    // report an unknown duration rather than inventing one.
    expect(season.formatsByName.Scrimmage).toBeUndefined();
    for (const game of scrimmages) {
      expect(game.durationMinutes).toBeNull();
      expect(game.end).toBeNull();
    }
  });

  it('keeps the 8 externally-published fixtures and the agreed-time delta', () => {
    expect(season.externalFixtures).toHaveLength(8);
    const published = new Map(
      season.externalFixtures.map((fixture) => [`${fixture.date}|${fixture.homeLabel}`, fixture])
    );
    const agreed = season.combinedByKind[SEASON_2026_ROW_KIND.EXTERNAL_FIXTURE];
    expect(agreed).toHaveLength(8);

    let moved = 0;
    let unchanged = 0;
    for (const game of agreed) {
      const source = published.get(`${game.date}|${game.homeLabel}`);
      expect(source, `no published fixture for ${game.date} ${game.homeLabel}`).toBeDefined();
      if (source.kickoffMinutes === game.kickoffMinutes) unchanged += 1;
      else {
        moved += 1;
        expect(source.kickoffMinutes - game.kickoffMinutes).toBe(30);
        expect(game.date).toBe('2026-08-22');
      }
    }
    expect(moved).toBe(4);
    expect(unchanged).toBe(4);
  });

  it('keeps the Minis sessions with their placeholder opponent', () => {
    const minis = season.recGames.filter((g) => g.kind === SEASON_2026_ROW_KIND.MINIS_SESSION);
    expect(minis).toHaveLength(36);
    expect(MINIS_SESSION_IDS).toHaveLength(4);
    for (const session of minis) {
      expect(session.awayLabel).toBe('-');
      expect(session.awayTeamId).toBeNull();
    }
  });
});

describe('season-2026 corpus :: every rec team plays 9, hosting 4 or 5', () => {
  it('gives every rec entity exactly 9 appearances', () => {
    const { counts } = recEntities();
    expect(counts.size).toBe(122);
    let checked = 0;
    for (const [entity, count] of counts) {
      expect(count, `${entity} plays ${count} rec games`).toBe(9);
      checked += 1;
    }
    expect(checked).toBe(122);
  });

  it('has every rec team host 4 or 5, with the Minis sessions the stated exception', () => {
    const { homeCounts } = recEntities();
    let teamsChecked = 0;
    let minisChecked = 0;
    for (const [entity, hosted] of homeCounts) {
      if (MINIS_SESSION_IDS.includes(entity)) {
        // Documented exception: Minis sessions are always Home with Away `-`.
        expect(hosted, `${entity} hosts ${hosted}`).toBe(9);
        minisChecked += 1;
        continue;
      }
      expect([4, 5], `${entity} hosts ${hosted}`).toContain(hosted);
      teamsChecked += 1;
    }
    expect(minisChecked).toBe(4);
    expect(teamsChecked).toBe(118);
    expect(teamsChecked + minisChecked).toBe(122);
  });

  it('accounts for all 132 roster teams as 118 rec teams plus 14 Select teams', () => {
    const { counts } = recEntities();
    const rosterTeamIds = new Set(season.teams.map((team) => team.id));
    const recTeamIds = [...counts.keys()].filter((id) => !MINIS_SESSION_IDS.includes(id));

    for (const id of recTeamIds)
      expect(rosterTeamIds.has(id), `${id} missing from roster`).toBe(true);
    for (const id of MINIS_SESSION_IDS) expect(rosterTeamIds.has(id)).toBe(false);

    const selectOnly = [...rosterTeamIds].filter((id) => !recTeamIds.includes(id));
    expect(recTeamIds).toHaveLength(118);
    expect(selectOnly).toHaveLength(14);
    expect(recTeamIds.length + selectOnly.length).toBe(132);
  });
});

describe('season-2026 corpus :: round robin', () => {
  it('is complete within every division that can fit one, with opponent counts within 1', () => {
    const byDivision = new Map();
    for (const game of season.recGames) {
      if (!byDivision.has(game.division)) byDivision.set(game.division, []);
      byDivision.get(game.division).push(game);
    }
    expect(byDivision.size).toBeGreaterThan(0);

    let divisionsChecked = 0;
    let completeRoundRobins = 0;
    let teamsChecked = 0;

    for (const [division, games] of byDivision) {
      const teams = new Set();
      for (const game of games) {
        teams.add(game.homeLabel);
        if (game.awayTeamId) teams.add(game.awayLabel);
      }

      // The Minis division has no opponents at all — the documented exception.
      const opponentGames = games.filter((game) => game.awayTeamId);
      if (opponentGames.length === 0) {
        expect(division).toBe('BB');
        expect([...teams].every((team) => MINIS_SESSION_IDS.includes(team))).toBe(true);
        continue;
      }

      const meetings = new Map();
      const bump = (a, b) => {
        if (!meetings.has(a)) meetings.set(a, new Map());
        meetings.get(a).set(b, (meetings.get(a).get(b) ?? 0) + 1);
      };
      for (const game of opponentGames) {
        bump(game.homeLabel, game.awayLabel);
        bump(game.awayLabel, game.homeLabel);
      }

      const teamList = [...teams];
      const gamesPerTeam = 9;

      for (const team of teamList) {
        const opponentCounts = teamList
          .filter((other) => other !== team)
          .map((other) => meetings.get(team)?.get(other) ?? 0);
        expect(opponentCounts.length).toBe(teamList.length - 1);
        const spread = Math.max(...opponentCounts) - Math.min(...opponentCounts);
        expect(spread, `${division}/${team} opponent spread ${spread}`).toBeLessThanOrEqual(1);
        teamsChecked += 1;
      }

      // "Round-robin complete" where a full round robin fits inside 9 games.
      if (teamList.length - 1 <= gamesPerTeam) {
        for (const team of teamList) {
          for (const other of teamList) {
            if (team === other) continue;
            expect(
              meetings.get(team)?.get(other) ?? 0,
              `${division}: ${team} never met ${other}`
            ).toBeGreaterThanOrEqual(1);
          }
        }
        completeRoundRobins += 1;
      }
      divisionsChecked += 1;
    }

    expect(divisionsChecked).toBe(14);
    expect(completeRoundRobins).toBe(12);
    expect(teamsChecked).toBe(118);
  });
});

describe('season-2026 corpus :: coach coverage', () => {
  const singleCoach = findSingleCoachGames(season.recGames, season.coachTimelines, season.teams);

  it('builds a non-empty personal timeline for coaches', () => {
    expect(season.coachTimelines.size).toBeGreaterThan(0);
    const totalEntries = [...season.coachTimelines.values()].reduce(
      (sum, entries) => sum + entries.length,
      0
    );
    expect(totalEntries).toBeGreaterThan(0);
    // Incident 5: scrimmages and Select games must be on the timeline too, not
    // just the rec layer.
    const nonRec = [...season.coachTimelines.values()]
      .flat()
      .filter((entry) => entry.game.kind !== SEASON_2026_ROW_KIND.REC_GAME);
    expect(nonRec.length).toBeGreaterThan(0);
  });

  it('keeps unknown-footprint rows on the timeline instead of dropping them', () => {
    // Incident 5, guarded at the seam where it reappeared: the loader used to
    // skip `durationMinutes === null`, and the corpus's only such rows are its
    // scrimmages — so the skip made exactly the evening commitments the
    // incident is about invisible to every consumer of this timeline.
    const scrimmages = season.combinedGames.filter(
      (game) => game.kind === SEASON_2026_ROW_KIND.SCRIMMAGE
    );
    expect(scrimmages.length).toBeGreaterThan(0);
    for (const game of scrimmages) expect(game.durationMinutes).toBeNull();

    const entries = [...season.coachTimelines.values()].flat();
    const unknownFootprint = entries.filter((entry) => entry.endMinutes === null);
    expect(unknownFootprint.length).toBeGreaterThan(0);
    // Every one of them is a scrimmage row, and every scrimmage row with a
    // rostered side is represented.
    for (const entry of unknownFootprint) {
      expect(entry.game.kind).toBe(SEASON_2026_ROW_KIND.SCRIMMAGE);
    }
    expect(new Set(unknownFootprint.map((entry) => entry.gameId)).size).toBe(scrimmages.length);
  });

  it('has exactly 3 single-coach rec games, at most 1 per team', () => {
    expect(singleCoach).toHaveLength(3);
    expect(new Set(singleCoach.map((entry) => entry.gameId)).size).toBe(3);

    const perTeam = new Map();
    for (const entry of singleCoach) {
      perTeam.set(entry.teamId, (perTeam.get(entry.teamId) ?? 0) + 1);
    }
    expect(perTeam.size).toBe(3);
    for (const [teamId, count] of perTeam) {
      expect(count, `${teamId} has ${count} single-coach games`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the conflict spread within every age group at 1 or less', () => {
    const ageGroups = new Set(
      season.recGames.map((game) => ageGroupOfDivision(game.division)).filter(Boolean)
    );
    expect(ageGroups.size).toBeGreaterThan(0);

    const teamsByAgeGroup = new Map();
    for (const game of season.recGames) {
      const ageGroup = ageGroupOfDivision(game.division);
      if (!ageGroup) continue;
      if (!teamsByAgeGroup.has(ageGroup)) teamsByAgeGroup.set(ageGroup, new Set());
      teamsByAgeGroup.get(ageGroup).add(game.homeLabel);
      if (game.awayTeamId) teamsByAgeGroup.get(ageGroup).add(game.awayLabel);
    }

    const conflictsByTeam = new Map();
    for (const entry of singleCoach) {
      conflictsByTeam.set(entry.teamId, (conflictsByTeam.get(entry.teamId) ?? 0) + 1);
    }

    let groupsChecked = 0;
    let teamsChecked = 0;
    for (const [ageGroup, teams] of teamsByAgeGroup) {
      const counts = [...teams].map((team) => conflictsByTeam.get(team) ?? 0);
      expect(counts.length).toBeGreaterThan(0);
      const spread = Math.max(...counts) - Math.min(...counts);
      expect(spread, `${ageGroup} conflict spread ${spread}`).toBeLessThanOrEqual(1);
      groupsChecked += 1;
      teamsChecked += counts.length;
    }
    expect(groupsChecked).toBe(7);
    expect(teamsChecked).toBe(118);
  });

  it('reproduces the "Nate" vs "Nathaniel" identity split across roster revisions', () => {
    const current = loadCoachRoster();
    const v1 = loadCoachRoster({ revision: 'v1' });
    expect(current).toHaveLength(215);
    expect(v1).toHaveLength(215);

    const currentKeys = new Set(current.map((row) => row.personKey));
    const v1Keys = new Set(v1.map((row) => row.personKey));
    const onlyInV1 = [...v1Keys].filter((key) => !currentKeys.has(key));
    expect(onlyInV1).toEqual(['nate deverell']);
    expect(currentKeys.size).toBe(196);
    expect(v1Keys.size).toBe(197);
  });
});

describe('season-2026 corpus :: daylight and permits', () => {
  it('ends every unlit game at least 15 minutes before sunset', () => {
    let checked = 0;
    const violations = [];
    for (const game of season.combinedGames) {
      if (game.endMinutes === null) continue;
      const venue = season.venuesByName[game.venue];
      expect(venue, `unknown venue ${game.venue}`).toBeDefined();
      if (venue.lit) continue;
      const sunsetMinutes = resolveSunsetMinutes(season.sunsets, game.date);
      expect(sunsetMinutes, `no sunset for ${game.date}`).not.toBeNull();
      checked += 1;
      if (game.endMinutes > sunsetMinutes - SUNSET_MARGIN_MINUTES) {
        violations.push(`${game.id} ${game.date} ends ${game.end} vs sunset ${sunsetMinutes}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(checked).toBe(669);
    expect(violations).toEqual([]);
  });

  it('keeps every game inside its venue permit window', () => {
    let checked = 0;
    const violations = [];
    for (const game of season.combinedGames) {
      if (game.endMinutes === null) continue;
      const permit = resolvePermit(season.permits, { venue: game.venue, date: game.date });
      if (!permit || !permit.hasPermit) {
        violations.push(`${game.id} at ${game.venue} on ${game.date} has no permit`);
        continue;
      }
      checked += 1;
      if (game.kickoffMinutes < permit.openMinutes || game.endMinutes > permit.closeMinutes) {
        violations.push(`${game.id} ${game.kickoff}-${game.end} outside ${permit.scope}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(checked).toBe(675);
    expect(violations).toEqual([]);
  });

  it('honours the per-date permit exceptions', () => {
    const earlyOpen = resolvePermit(season.permits, { venue: 'Summit HS', date: '2026-09-12' });
    expect(earlyOpen.scopeKind).toBe('date-exception');
    expect(earlyOpen.openMinutes).toBe(parseClockMinutes('2:00 PM'));

    const blackout = resolvePermit(season.permits, { venue: 'Summit HS', date: '2026-09-19' });
    expect(blackout.hasPermit).toBe(false);
    const gamesThere = season.combinedGames.filter(
      (game) => game.venue === 'Summit HS' && game.date === '2026-09-19'
    );
    expect(gamesThere).toHaveLength(0);
    // Meta-assertion: Summit HS is used on other dates, so the filter above is
    // testing a real venue and not a typo.
    expect(
      season.combinedGames.filter((game) => game.venue === 'Summit HS').length
    ).toBeGreaterThan(0);
  });
});

describe('season-2026 corpus :: facility geometry', () => {
  it('never runs concurrent games on an overlapping pair, halves included', () => {
    const byVenueDate = new Map();
    for (const game of season.combinedGames) {
      if (game.endMinutes === null) continue;
      const key = `${game.venue}|${game.date}`;
      if (!byVenueDate.has(key)) byVenueDate.set(key, []);
      byVenueDate.get(key).push(game);
    }
    expect(byVenueDate.size).toBeGreaterThan(0);

    let overlappingPairsExamined = 0;
    let sameFieldPairsExamined = 0;
    const violations = [];

    for (const [key, games] of byVenueDate) {
      const venue = season.venuesByName[games[0].venue];
      expect(venue, `unknown venue in ${key}`).toBeDefined();
      for (let i = 0; i < games.length; i += 1) {
        for (let j = i + 1; j < games.length; j += 1) {
          const a = games[i];
          const b = games[j];
          if (!fieldsOverlap(venue, a.field, b.field)) continue;
          if (a.field === b.field) sameFieldPairsExamined += 1;
          else overlappingPairsExamined += 1;
          const concurrent = a.kickoffMinutes < b.endMinutes && b.kickoffMinutes < a.endMinutes;
          if (concurrent) {
            violations.push(`${a.id} (${a.field}) overlaps ${b.id} (${b.field}) on ${a.date}`);
          }
        }
      }
    }

    expect(overlappingPairsExamined).toBeGreaterThan(0);
    expect(sameFieldPairsExamined).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('resolves sub-fields to their parent for overlap purposes', () => {
    const alder = season.venuesByName['Alder Park'];
    expect(alder).toBeDefined();
    expect(alder.overlapPairs).toEqual([
      ['Pitch 1', 'Pitch 2'],
      ['Pitch 3', 'Pitch 4'],
    ]);
    expect(overlapRootField(alder, 'Pitch 1A')).toBe('Pitch 1');
    expect(overlapRootField(alder, 'Pitch 4B')).toBe('Pitch 4');
    expect(fieldsOverlap(alder, 'Pitch 1A', 'Pitch 2')).toBe(true);
    expect(fieldsOverlap(alder, 'Pitch 4A', 'Pitch 3')).toBe(true);
    // Allowed concurrent combinations, per the corpus' own overlap note.
    expect(fieldsOverlap(alder, 'Pitch 1A', 'Pitch 1B')).toBe(false);
    expect(fieldsOverlap(alder, 'Pitch 2', 'Pitch 4A')).toBe(false);
    expect(fieldsOverlap(alder, 'Pitch 2', 'Pitch 3')).toBe(false);
    expect(fieldsOverlap(alder, 'Pitch 1A', 'Pitch 4B')).toBe(false);
    // Meta-assertion: the fields named above really exist in the geometry.
    const names = new Set(alder.fields.map((field) => field.name));
    for (const name of ['Pitch 1', 'Pitch 1A', 'Pitch 1B', 'Pitch 2', 'Pitch 3', 'Pitch 4']) {
      expect(names.has(name), `${name} missing from Alder Park geometry`).toBe(true);
    }
  });

  it('spaces 11v11 kickoffs on one field by at least the format block', () => {
    const blockMinutes = season.formatsByName['11v11'].blockMinutes;
    expect(blockMinutes).toBe(120);

    const byFieldDate = new Map();
    const elevens = season.combinedGames.filter((game) => game.format === '11v11');
    expect(elevens.length).toBe(108);
    for (const game of elevens) {
      const key = `${game.date}|${game.fieldId}`;
      if (!byFieldDate.has(key)) byFieldDate.set(key, []);
      byFieldDate.get(key).push(game.kickoffMinutes);
    }

    let pairsExamined = 0;
    const violations = [];
    for (const [key, kickoffs] of byFieldDate) {
      kickoffs.sort((a, b) => a - b);
      for (let i = 0; i < kickoffs.length; i += 1) {
        for (let j = i + 1; j < kickoffs.length; j += 1) {
          pairsExamined += 1;
          if (kickoffs[j] - kickoffs[i] < blockMinutes) {
            violations.push(`${key}: ${kickoffs[i]} and ${kickoffs[j]}`);
          }
        }
      }
    }
    expect(pairsExamined).toBeGreaterThan(0);
    expect(pairsExamined).toBe(183);
    expect(violations).toEqual([]);
  });
});

describe('season-2026 corpus :: publication parity', () => {
  // This used to be a hand-rolled comparator: a Map of `publicationKey()`
  // counts, decremented row by row. It is now a call into the production
  // checker (`packages/core/src/publication/parity.js`), with the same numbers
  // derived the same way from the same two files — the repository does not keep
  // a second parity comparator, and the one it keeps is the one that is tested
  // against its own failure modes in `tests/publicationParity.test.js`.
  const parity = checkParity(
    season2026PublishedParityInput({
      publishedRecGames: season.recGames,
      combinedGames: season.combinedGames,
    })
  );

  it('matches all 567 published rec rows slot-for-slot and team-for-team', () => {
    expect(parity.buckets.matched).toHaveLength(567);
    expect(parity.buckets.matched).toHaveLength(season.recGames.length);
    expect(parity.buckets.differing).toEqual([]);
    expect(parity.buckets.removed).toEqual([]);
    // The meta-assertion the number rests on: 567 pairs compared on zero fields
    // would be 567 matches meaning nothing.
    expect(parity.meta.fieldComparisons).toBe(567 * parity.comparedFields.length);
    expect(parity.comparedFields.length).toBeGreaterThan(0);
  });

  it('reports the 11v11 layer as additions rather than as differences', () => {
    expect(parity.buckets.added).toHaveLength(679 - 567);
    expect(parity.meta.rowsCompared).toBe(679);
    expect(parity.status).toBe('allowed');
  });
});
