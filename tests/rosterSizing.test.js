import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  calculateMaxRosterSize,
  buildOverridesFromSupabaseRows,
  deriveDivisionRosterConfigs,
  parsePlayableCount,
} from '../packages/core/src/rosterSizing.js';

describe('parsePlayableCount', () => {
  it('parses standard lowercase formats', () => {
    assert.equal(parsePlayableCount('7v7'), 7);
  });

  it('handles uppercase and whitespace', () => {
    assert.equal(parsePlayableCount(' 9V9 '), 9);
  });

  it('throws when format is invalid', () => {
    assert.throws(() => parsePlayableCount('solo'), /unable to parse/);
  });
});

describe('calculateMaxRosterSize', () => {
  it('applies the 2x playable minus buffer formula', () => {
    assert.equal(calculateMaxRosterSize(7), 12);
    assert.equal(calculateMaxRosterSize(9), 16);
  });

  it('respects custom buffer and minimum overrides', () => {
    assert.equal(calculateMaxRosterSize(5, { buffer: 1 }), 9);
    assert.equal(calculateMaxRosterSize(5, { minimum: 12 }), 12);
  });

  it('throws for invalid playable counts', () => {
    assert.throws(() => calculateMaxRosterSize(0));
  });
});

describe('deriveDivisionRosterConfigs', () => {
  it('prefers overrides when available', () => {
    const divisions = [{ id: 'U10', playFormat: '7v7' }];
    const overrides = {
      U10: {
        maxRosterSize: 13,
        playableCount: 7,
        minRosterSize: 10,
        targetTeamSize: 12,
        minTeams: 2,
        maxTeams: 4,
      },
    };
    const configs = deriveDivisionRosterConfigs(divisions, { overrides });

    assert.deepEqual(configs, {
      U10: {
        maxRosterSize: 13,
        minRosterSize: 10,
        targetTeamSize: 12,
        minTeams: 2,
        maxTeams: 4,
        playableCount: 7,
        source: 'override',
      },
    });
  });

  it('falls back to division maxRosterSize when present', () => {
    const divisions = [{ id: 'U12', maxRosterSize: 15, playableCount: 9 }];
    const configs = deriveDivisionRosterConfigs(divisions);

    assert.deepEqual(configs, {
      U12: {
        maxRosterSize: 15,
        playableCount: 9,
        source: 'division-record',
      },
    });
  });

  it('derives roster sizes from format strings', () => {
    const divisions = [{ id: 'U8', playFormat: '5v5' }];
    const configs = deriveDivisionRosterConfigs(divisions);

    assert.deepEqual(configs, {
      U8: {
        maxRosterSize: 8,
        playableCount: 5,
        source: 'formula',
      },
    });
  });

  it('supports overrides keyed by division name', () => {
    const divisions = [{ name: 'U6 Coed', playFormat: '3v3' }];
    const overrides = { 'U6 Coed': { maxRosterSize: 7 } };
    const configs = deriveDivisionRosterConfigs(divisions, { overrides });

    assert.deepEqual(configs, {
      'U6 Coed': {
        maxRosterSize: 7,
        playableCount: null,
        source: 'override',
      },
    });
  });

  it('throws when a division is missing sizing data', () => {
    const divisions = [{ id: 'U14' }];
    assert.throws(() => deriveDivisionRosterConfigs(divisions));
  });

  it('validates optional roster and team bounds', () => {
    assert.throws(
      () => deriveDivisionRosterConfigs([{ id: 'U10', maxRosterSize: 10, minRosterSize: 11 }]),
      /minRosterSize.*cannot exceed maxRosterSize/i
    );

    assert.throws(
      () =>
        deriveDivisionRosterConfigs([{ id: 'U10', maxRosterSize: 10, minTeams: 4, maxTeams: 3 }]),
      /minTeams cannot exceed maxTeams/i
    );
  });
});

describe('buildOverridesFromSupabaseRows', () => {
  it('filters by season and prefers matching overrides', () => {
    const rows = [
      { divisionId: 'U10', seasonId: 'fall', maxRosterSize: 13 },
      { division_id: 'U10', season_id: 'spring', max_roster_size: 12 },
      { divisionCode: 'U12', maxRosterSize: 14 },
    ];

    const overrides = buildOverridesFromSupabaseRows(rows, { seasonId: 'fall' });

    assert.deepEqual(overrides, {
      U10: { maxRosterSize: 13, playableCount: null },
      U12: { maxRosterSize: 14, playableCount: null },
    });
  });

  it('prefers season specific overrides when seasonId is provided', () => {
    const rows = [
      { divisionId: 'U10', maxRosterSize: 10 },
      { divisionId: 'U10', seasonId: 'fall', maxRosterSize: 13 },
    ];

    const overrides = buildOverridesFromSupabaseRows(rows, { seasonId: 'fall' });

    assert.deepEqual(overrides, {
      U10: { maxRosterSize: 13, playableCount: null },
    });
  });

  it('normalizes snake_case roster and team constraints', () => {
    const rows = [
      {
        division_id: 'U10',
        max_roster_size: 14,
        min_roster_size: 10,
        target_team_size: 12,
        team_count_override: 3,
        min_teams: 2,
        max_teams: 4,
      },
    ];

    const overrides = buildOverridesFromSupabaseRows(rows);

    assert.deepEqual(overrides, {
      U10: {
        maxRosterSize: 14,
        minRosterSize: 10,
        targetTeamSize: 12,
        teamCountOverride: 3,
        minTeams: 2,
        maxTeams: 4,
        playableCount: null,
      },
    });
  });

  it('prefers generic overrides when no seasonId is provided', () => {
    const rows = [
      { divisionId: 'U10', seasonId: 'fall', maxRosterSize: 13 },
      { divisionId: 'U10', maxRosterSize: 10 },
    ];

    const overrides = buildOverridesFromSupabaseRows(rows);

    assert.deepEqual(overrides, {
      U10: { maxRosterSize: 10, playableCount: null },
    });
  });

  it('throws when rows are malformed', () => {
    // @ts-expect-error [INVALID_INPUT] - testing intentional invalid input to verify runtime validation logic in javascript-compiled-as-typescript context
    assert.throws(() => buildOverridesFromSupabaseRows('oops'));
    assert.throws(() => buildOverridesFromSupabaseRows([{}]));
    assert.throws(() => buildOverridesFromSupabaseRows([{ divisionId: 'U8', maxRosterSize: 0 }]));
  });
});
