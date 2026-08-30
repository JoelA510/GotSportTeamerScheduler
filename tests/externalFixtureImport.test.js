/**
 * External fixture import with impact analysis — Prompt 7.3.
 *
 * > *We can read what the other league published. Can we say what it is, what
 * > accepting it would cost, and what to send back — without guessing a name and
 * > without answering about an import when the question is about four rows?*
 *
 * Six properties are what this file is for, and each has a positive control that
 * is **constructed** rather than asserted:
 *
 * 1. **The mapping refuses rather than guesses, and the refusal is worth
 *    something.** A deliberately-wrong resolver that strips decoration is built
 *    here, shown to agree with the real one everywhere this corpus exercises it,
 *    and shown to merge `Maplewood Back` with `Maplewood Front` — two venues
 *    `facility_geometry.json` declares separately, each holding a `Field 1`.
 * 2. **Four classes, not three.** `undecidable` is reached from the corpus by
 *    deleting one mapping record, and the rows that reach it publish the
 *    differences that *could* be computed without being called changed.
 * 3. **An impact verdict belongs to an acceptance set.** All sixteen sets over
 *    the corpus's four differing rows are evaluated and the safe/unsafe split is
 *    read off the sweep. The "evaluate the whole import" analysis is built here
 *    and shown to be wrong about a stated number of them.
 * 4. **Unknown is not zero.** A moved fixture with no known footprint makes its
 *    own set `undetermined`, and the same move with a footprint does not.
 * 5. **The export would have prevented incident 3.** The avoid-window document
 *    refuses the league's own published 12:30 and admits the agreed 12:00, and
 *    the naive document — the pitch's own bookings only — admits both.
 * 6. **Every meta-assertion can fail**, and the input that makes each fail is
 *    built here and run through a public entry point.
 *
 * Every figure below is derived from the corpus at test time. Nothing is
 * hand-copied except the counts `fixtures/season-2026/README.md` itself
 * declares.
 *
 * **Test-hygiene note.** No corpus lookup is dereferenced in a `describe` body:
 * a `TypeError` at file load fails the whole file instead of firing the
 * meta-assertion that was supposed to catch it — the defect
 * `tests/scenarioBranching.test.js` and `tests/feasibilityApi.test.js` both
 * carry fixes for. Every subject is built inside a test through the memoising
 * helpers below.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  ACCEPTANCE_SWEEP_CAP,
  AvoidWindowDocumentSchema,
  EXTERNAL_IMPACT_VERDICT,
  EXTERNAL_IMPORT_REASON,
  EXTERNAL_IMPORT_REASON_SEVERITY,
  EXTERNAL_IMPORT_SEVERITY,
  EXTERNAL_IMPORT_STATUS,
  EXTERNAL_MAPPING_DURABILITY,
  EXTERNAL_MAPPING_KIND,
  EXTERNAL_NAME_RESOLUTION,
  EXTERNAL_NAME_RESOLUTION_REASON,
  EXTERNAL_ROW_CLASS,
  EXTERNAL_ROW_CLASS_ORDER,
  MappingDocumentSchema,
  SEASON_2026_EXTERNAL_MAPPING_RECORDS,
  acceptanceDomainOf,
  acceptanceSetKey,
  analyseImportImpact,
  avoidWindowsAdmit,
  buildAvoidWindows,
  buildExternalMappingRegistry,
  checkAvoidWindowRoundTrip,
  classifyExternalImport,
  deriveExternalImpactVerdict,
  externalImportSeverityOf,
  impactOfSet,
  normaliseExternalLabel,
  readAvoidWindowDocument,
  readExternalMappingRegistry,
  resolveExternalName,
  reverseResolveSurface,
  season2026ExternalImportQuery,
  season2026ExternalMappingInput,
  serialiseExternalMappingRegistry,
  sweepAcceptanceSets,
  toSeason2026StandingFixtures,
} from '@squadlogic/core/externalImport/index.js';
import {
  buildFacilityGraphFromSeason2026,
  season2026SurfaceId,
  season2026VenueId,
} from '@squadlogic/core/facility/index.js';
import {
  buildFormatTimingTableFromSeason2026,
  getFormatTiming,
} from '@squadlogic/core/timing/index.js';
import {
  loadCombinedSchedule,
  loadExternalFixtures,
  loadFacilityGeometry,
  loadGameFormats,
} from '@squadlogic/core/fixtures/index.js';

// The sixteen-set sweep is derived four times over in this file (the corpus, the
// counterfactual, the reduced scope and the undetermined variant), each
// projecting 73 fixtures and comparing ~2,600 booking pairs twice per set. CI
// runs roughly 1.4x slower than the development machine, which puts the slowest
// case within a factor of two of vitest's 5s default.
vi.setConfig({ testTimeout: 30_000 });

/* -------------------------------------------------------------------------- */
/* Corpus subjects, built inside tests and memoised                            */
/* -------------------------------------------------------------------------- */

/** @type {Record<string, any>} */
const cache = {};

function corpusGames() {
  if (cache.games === undefined) cache.games = loadCombinedSchedule();
  return cache.games;
}

function corpusExternal() {
  if (cache.external === undefined) cache.external = loadExternalFixtures();
  return cache.external;
}

function corpusGeometry() {
  if (cache.geometry === undefined) cache.geometry = loadFacilityGeometry();
  return cache.geometry;
}

function corpusGraph() {
  if (cache.graph === undefined) cache.graph = buildFacilityGraphFromSeason2026(corpusGeometry());
  return cache.graph;
}

function corpusTiming() {
  if (cache.timing === undefined) {
    cache.timing = buildFormatTimingTableFromSeason2026(loadGameFormats());
  }
  return cache.timing;
}

function corpusRegistry() {
  if (cache.registry === undefined) {
    cache.registry = buildExternalMappingRegistry(season2026ExternalMappingInput(), {
      graph: corpusGraph(),
    });
  }
  return cache.registry;
}

function corpusQuery() {
  if (cache.query === undefined) {
    cache.query = season2026ExternalImportQuery({
      externalFixtures: corpusExternal(),
      combinedGames: corpusGames(),
    });
  }
  return cache.query;
}

function corpusResolution() {
  if (cache.resolution === undefined) {
    cache.resolution = classifyExternalImport(corpusQuery(), corpusRegistry());
  }
  return cache.resolution;
}

function corpusSweep() {
  if (cache.sweep === undefined) {
    cache.sweep = sweepAcceptanceSets({
      subject: 'season-2026 external seeding fixtures',
      resolution: corpusResolution(),
      standing: corpusQuery().standing,
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
  }
  return cache.sweep;
}

/** Every code in a findings list. */
function codesOf(findings) {
  return findings.map((finding) => finding.code);
}

/** The corpus's own external-fixture row ids, which the export excludes. */
function externalFixtureIds() {
  return corpusGames()
    .filter((game) => game.kind === 'external_fixture')
    .map((game) => game.id);
}

/* -------------------------------------------------------------------------- */
/* The deliberately wrong resolver, for the adversarial controls               */
/* -------------------------------------------------------------------------- */

/**
 * **A matcher that treats `Back` as decoration.**
 *
 * This is not a strawman: it is `parseExternalFixtures()`'s own
 * `/^(.*?)\s*\((?:Back\s+)?(.*?)\)$/` generalised the way a "usually works"
 * resolver generalises it — strip a leading `Back`/`Front`/`Upper` wherever it
 * appears, then match on what is left. It is right about every label this corpus
 * contains, which is exactly why it has to be tested against one it does not.
 *
 * @param {string} label
 * @returns {string}
 */
function decorationStrippedKey(label) {
  return label
    .replace(/[()]/g, ' ')
    .replace(/\b(back|front|upper|lower)\b/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

describe('externalImport — the frozen tables', () => {
  it('registers a severity for every declared reason code, and nothing else', () => {
    const declared = Object.values(EXTERNAL_IMPORT_REASON);
    expect(declared.length).toBeGreaterThan(0);
    for (const code of declared) {
      expect(EXTERNAL_IMPORT_REASON_SEVERITY[code]).toBeDefined();
      expect(Object.values(EXTERNAL_IMPORT_SEVERITY)).toContain(externalImportSeverityOf(code));
    }
    expect(Object.keys(EXTERNAL_IMPORT_REASON_SEVERITY).sort()).toEqual([...declared].sort());
  });

  it('throws on an unregistered code rather than defaulting it to info', () => {
    expect(() => externalImportSeverityOf('EXTERNAL_NOT_A_CODE')).toThrow(/no registered severity/);
  });

  it('gives every name-resolution state a row, and only `resolved` maps to null', () => {
    for (const state of Object.values(EXTERNAL_NAME_RESOLUTION)) {
      expect(EXTERNAL_NAME_RESOLUTION_REASON).toHaveProperty(state);
    }
    expect(EXTERNAL_NAME_RESOLUTION_REASON[EXTERNAL_NAME_RESOLUTION.RESOLVED]).toBeNull();
    expect(EXTERNAL_NAME_RESOLUTION_REASON[EXTERNAL_NAME_RESOLUTION.UNRESOLVED]).not.toBeNull();
    expect(EXTERNAL_NAME_RESOLUTION_REASON[EXTERNAL_NAME_RESOLUTION.AMBIGUOUS]).not.toBeNull();
  });

  it('derives a verdict from the two facts an analysis publishes, and refuses nonsense', () => {
    const blocking = {
      code: EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_INTRODUCED,
      severity: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
      message: '',
      details: {},
    };
    expect(deriveExternalImpactVerdict({ undecidablePairs: 0, introduced: [] })).toBe(
      EXTERNAL_IMPACT_VERDICT.SAFE
    );
    expect(deriveExternalImpactVerdict({ undecidablePairs: 0, introduced: [blocking] })).toBe(
      EXTERNAL_IMPACT_VERDICT.UNSAFE
    );
    // Undecidable wins over unsafe on purpose: `unsafe` would read as a complete
    // account of what is wrong, and with a pair left undecided it is not one.
    expect(deriveExternalImpactVerdict({ undecidablePairs: 1, introduced: [blocking] })).toBe(
      EXTERNAL_IMPACT_VERDICT.UNDETERMINED
    );
    expect(() => deriveExternalImpactVerdict({ undecidablePairs: -1, introduced: [] })).toThrow(
      /non-negative integer/
    );
  });
});

describe('acceptance 1 — the mapping refuses rather than guesses', () => {
  it('normalises typography and nothing else', () => {
    expect(normaliseExternalLabel('  Alder Park   (Back Pitch 2) ')).toBe(
      'alder park (back pitch 2)'
    );
    // The three things it does are idempotent and the word survives all of them.
    expect(normaliseExternalLabel('Maplewood Back')).toContain('back');
    expect(normaliseExternalLabel('Maplewood Back')).not.toBe(
      normaliseExternalLabel('Maplewood Front')
    );
  });

  it('has the corpus venues the trap needs, so this check is not vacuous', () => {
    const venues = corpusGeometry().venues;
    expect(venues.length).toBeGreaterThan(0);
    // Meta-assertion: the trap is a property of this corpus, derived here rather
    // than assumed — two venues sharing a first word, each holding a `Field 1`,
    // and both known to the facility graph as distinct venue ids.
    const maplewood = venues.filter((venue) => venue.name.startsWith('Maplewood'));
    expect(maplewood.length).toBeGreaterThanOrEqual(2);
    for (const venue of maplewood) {
      expect(venue.fields.map((field) => field.name)).toContain('Field 1');
    }
    expect(new Set(maplewood.map((venue) => season2026VenueId(venue.name))).size).toBe(
      maplewood.length
    );
  });

  it('the decoration-stripping resolver agrees on Alder and merges Maplewood', () => {
    // Agreement where the corpus exercises it: both keys separate the two Alder
    // labels, so nothing here is a straw man.
    const alder2 = 'Alder Park (Back Pitch 2)';
    const alder3 = 'Alder Park (Back Pitch 3)';
    expect(normaliseExternalLabel(alder2)).not.toBe(normaliseExternalLabel(alder3));
    expect(decorationStrippedKey(alder2)).not.toBe(decorationStrippedKey(alder3));

    // Divergence where it matters: the wrong resolver collapses two real venues.
    expect(decorationStrippedKey('Maplewood Back')).toBe(decorationStrippedKey('Maplewood Front'));
    expect(normaliseExternalLabel('Maplewood Back')).not.toBe(
      normaliseExternalLabel('Maplewood Front')
    );
  });

  it('reports a label no record claims instead of resolving it to a near neighbour', () => {
    const registry = buildExternalMappingRegistry(
      {
        registryId: 'maplewood-trap',
        label: 'a registry that knows only the complex name',
        party: 'test league',
        records: [
          {
            id: 'maplewood',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'Maplewood (Field 1)',
            venueId: season2026VenueId('Maplewood Back'),
            surfaceId: season2026SurfaceId('Maplewood Back', 'Field 1'),
            subjectId: null,
            provenance: 'constructed for tests/externalFixtureImport.test.js',
          },
        ],
      },
      { graph: corpusGraph() }
    );

    for (const label of ['Maplewood Back (Field 1)', 'Maplewood Front (Field 1)']) {
      const resolution = resolveExternalName(registry, EXTERNAL_MAPPING_KIND.VENUE, label);
      expect(resolution.state).toBe(EXTERNAL_NAME_RESOLUTION.UNRESOLVED);
      expect(resolution.surfaceId).toBeNull();
    }
    // And the one label it does claim still resolves, so the registry is live.
    expect(
      resolveExternalName(registry, EXTERNAL_MAPPING_KIND.VENUE, 'Maplewood (Field 1)').state
    ).toBe(EXTERNAL_NAME_RESOLUTION.RESOLVED);
  });

  it('refuses two records that claim one key and name different targets', () => {
    const registry = buildExternalMappingRegistry(
      {
        registryId: 'collision',
        label: 'two authors, one label',
        party: 'test league',
        records: [
          {
            id: 'a',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'The Back Pitch',
            venueId: season2026VenueId('Alder Park'),
            surfaceId: season2026SurfaceId('Alder Park', 'Pitch 2'),
            subjectId: null,
            provenance: 'constructed',
          },
          {
            id: 'b',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'the back  pitch',
            venueId: season2026VenueId('Alder Park'),
            surfaceId: season2026SurfaceId('Alder Park', 'Pitch 3'),
            subjectId: null,
            provenance: 'constructed',
          },
        ],
      },
      { graph: corpusGraph() }
    );
    expect(codesOf(registry.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_KEY_COLLISION
    );
    expect(registry.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
    const resolution = resolveExternalName(registry, EXTERNAL_MAPPING_KIND.VENUE, 'The Back Pitch');
    expect(resolution.state).toBe(EXTERNAL_NAME_RESOLUTION.AMBIGUOUS);
    expect(resolution.candidateRecordIds).toEqual(['a', 'b']);
  });

  it('refuses a record naming a surface the facility graph does not have', () => {
    const registry = buildExternalMappingRegistry(
      {
        registryId: 'ghost',
        label: 'a record for a pitch that is not there',
        party: 'test league',
        records: [
          {
            id: 'ghost-1',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'Nowhere (Pitch 9)',
            venueId: season2026VenueId('Alder Park'),
            surfaceId: 'alder-park/pitch-9',
            subjectId: null,
            provenance: 'constructed',
          },
        ],
      },
      { graph: corpusGraph() }
    );
    expect(codesOf(registry.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_TARGET_UNKNOWN
    );
  });

  it('reports an empty registry, and a registry nothing in a run exercised', () => {
    const empty = buildExternalMappingRegistry({
      registryId: 'empty',
      label: 'no records at all',
      party: 'test league',
      records: [],
    });
    expect(codesOf(empty.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_REGISTRY_EMPTY
    );

    // A registry with records that this publication never mentions: every row
    // comes back undecidable and the registry is reported unexercised.
    const irrelevant = buildExternalMappingRegistry({
      registryId: 'irrelevant',
      label: 'records for another league',
      party: 'test league',
      records: [
        {
          id: 'other',
          kind: EXTERNAL_MAPPING_KIND.VENUE,
          externalLabel: 'Somewhere Else (Pitch 1)',
          venueId: season2026VenueId('Riverbend'),
          surfaceId: season2026SurfaceId('Riverbend', 'Turf'),
          subjectId: null,
          provenance: 'constructed',
        },
      ],
    });
    const resolution = classifyExternalImport(corpusQuery(), irrelevant);
    expect(codesOf(resolution.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_REGISTRY_UNEXERCISED
    );
    expect(codesOf(resolution.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_RECORD_UNEXERCISED
    );
    expect(resolution.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
  });
});

describe('acceptance 2 — the corpus classification', () => {
  it('reads all eight rows and puts every one of them in exactly one class', () => {
    const resolution = corpusResolution();
    expect(resolution.meta.rowsRead).toBe(corpusExternal().length);
    expect(resolution.meta.rowsRead).toBeGreaterThan(0);
    expect(resolution.meta.rowsClassified).toBe(resolution.meta.rowsRead);

    const perClass = EXTERNAL_ROW_CLASS_ORDER.map((name) => resolution.byClass[name].length);
    expect(perClass.reduce((a, b) => a + b, 0)).toBe(resolution.meta.rowsRead);
    const seen = new Set(resolution.rows.map((row) => row.rowId));
    expect(seen.size).toBe(resolution.meta.rowsRead);
  });

  it('finds a fixture of ours for every external row, on (date, home, away)', () => {
    const resolution = corpusResolution();
    expect(resolution.meta.rowsUnmatched).toBe(0);
    expect(resolution.meta.rowsUndecidable).toBe(0);
    expect(resolution.meta.rowsMatchedIdentical + resolution.meta.rowsMatchedDiffering).toBe(
      resolution.meta.rowsRead
    );
    expect(new Set(resolution.rows.map((row) => row.fixtureId)).size).toBe(
      resolution.meta.rowsRead
    );
  });

  it('splits them by date: 08/23 identical, 08/22 differing by exactly +30 minutes', () => {
    const resolution = corpusResolution();
    const standingById = new Map(
      corpusQuery().standing.map((fixture) => [fixture.fixtureId, fixture])
    );

    const byDate = new Map();
    for (const row of resolution.rows) {
      const fixture = standingById.get(row.fixtureId);
      expect(fixture).toBeDefined();
      const list = byDate.get(fixture.date) ?? [];
      list.push({ row, fixture });
      byDate.set(fixture.date, list);
    }
    // Derived from the corpus, not typed in: two dates, four rows each.
    expect([...byDate.keys()].sort()).toEqual(['2026-08-22', '2026-08-23']);
    for (const [, entries] of byDate) expect(entries.length).toBe(4);

    for (const { row } of byDate.get('2026-08-23')) {
      expect(row.rowClass).toBe(EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL);
      expect(row.differences).toEqual([]);
    }
    const deltas = byDate
      .get('2026-08-22')
      .map(({ row }) => {
        expect(row.rowClass).toBe(EXTERNAL_ROW_CLASS.MATCHED_DIFFERING);
        expect(row.differences).toHaveLength(1);
        return row.differences[0];
      })
      .map((difference) => {
        // Every classification carries its evidence: which field, and by how much.
        expect(difference.field).toBe('kickoffMinutes');
        expect(typeof difference.ours).toBe('number');
        expect(typeof difference.theirs).toBe('number');
        return difference.deltaMinutes;
      });
    expect(new Set(deltas)).toEqual(new Set([30]));
  });

  it('resolves both venue labels, and only differs on the clock', () => {
    const resolution = corpusResolution();
    expect(resolution.meta.mappingRecordsExercised).toBe(
      SEASON_2026_EXTERNAL_MAPPING_RECORDS.length
    );
    expect(resolution.unexercisedRecords).toEqual([]);
    expect(resolution.meta.labelsUnresolved).toBe(0);
    expect(resolution.meta.labelsAmbiguous).toBe(0);
    // Both sides of every row are spelled identically in the two artifacts, so
    // no participant record is needed and every participant lookup is
    // unclaimed-optional rather than unresolved. Counted apart on purpose: the
    // two mean "the mapping was not needed" and "the mapping failed".
    expect(resolution.meta.labelsUnclaimedOptional).toBe(resolution.meta.rowsRead * 2);
    expect(resolution.meta.labelLookups).toBe(
      resolution.meta.labelsResolved +
        resolution.meta.labelsUnresolved +
        resolution.meta.labelsUnclaimedOptional +
        resolution.meta.labelsAmbiguous
    );
    expect(resolution.meta.fieldComparisons).toBeGreaterThan(0);
    for (const row of resolution.rows) {
      expect(row.venue.state).toBe(EXTERNAL_NAME_RESOLUTION.RESOLVED);
      for (const difference of row.differences) expect(difference.field).toBe('kickoffMinutes');
    }
    expect(resolution.status).toBe(EXTERNAL_IMPORT_STATUS.COMPROMISED);
  });

  it('leaves a field one side does not carry uncompared, rather than calling it different', () => {
    const query = { ...corpusQuery(), comparedFields: ['kickoffMinutes', 'format', 'division'] };
    const resolution = classifyExternalImport(query, corpusRegistry());
    // `external_fixtures_published.csv` has no Format or Division column at all.
    expect(resolution.meta.fieldsUncompared).toBe(resolution.meta.rowsRead * 2);
    expect(codesOf(resolution.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_UNCOMPARED
    );
    for (const row of resolution.rows) {
      expect(row.uncomparedFields.sort()).toEqual(['division', 'format']);
      for (const difference of row.differences) expect(difference.field).toBe('kickoffMinutes');
    }
  });
});

describe('acceptance 3 — the naming trap, in the import', () => {
  it('makes every row of the deleted label undecidable, and says which label', () => {
    const kept = SEASON_2026_EXTERNAL_MAPPING_RECORDS.filter(
      (record) => record.surfaceId !== season2026SurfaceId('Alder Park', 'Pitch 3')
    );
    expect(kept.length).toBe(SEASON_2026_EXTERNAL_MAPPING_RECORDS.length - 1);
    const registry = buildExternalMappingRegistry(
      season2026ExternalMappingInput({ records: kept }),
      { graph: corpusGraph() }
    );
    const resolution = classifyExternalImport(corpusQuery(), registry);

    const pitch3Rows = corpusExternal().filter((fixture) =>
      fixture.externalVenueLabel.includes('Pitch 3')
    ).length;
    expect(pitch3Rows).toBeGreaterThan(0);
    expect(resolution.meta.rowsUndecidable).toBe(pitch3Rows);
    expect(resolution.meta.rowsUnmatched).toBe(0);
    expect(resolution.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);

    const codes = codesOf(resolution.findings);
    expect(codes).toContain(EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_UNRESOLVED);
    expect(codes).toContain(EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_UNDECIDABLE);
    const unresolved = resolution.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_UNRESOLVED
    );
    expect(unresolved.details.label).toContain('Pitch 3');
    expect(unresolved.details.knownVenueLabels).toEqual([kept[0].externalLabel]);
  });

  it('publishes what could be compared without calling the row changed', () => {
    const kept = SEASON_2026_EXTERNAL_MAPPING_RECORDS.filter(
      (record) => record.surfaceId !== season2026SurfaceId('Alder Park', 'Pitch 3')
    );
    const registry = buildExternalMappingRegistry(
      season2026ExternalMappingInput({ records: kept }),
      { graph: corpusGraph() }
    );
    const resolution = classifyExternalImport(corpusQuery(), registry);
    const undecidable = resolution.rows.filter(
      (row) => row.rowClass === EXTERNAL_ROW_CLASS.UNDECIDABLE
    );
    expect(undecidable.length).toBeGreaterThan(0);

    // The 08/22 Pitch 3 rows still show their 30-minute clock difference as
    // evidence, and are still not classified as `matched-differing`.
    const withDelta = undecidable.filter((row) =>
      row.differences.some((difference) => difference.deltaMinutes === 30)
    );
    expect(withDelta.length).toBeGreaterThan(0);
    for (const row of undecidable) {
      expect(row.acceptable).toBe(false);
      expect(row.uncomparedFields).toContain('venueId');
      expect(row.uncomparedFields).toContain('surfaceId');
    }
  });

  it('refuses to accept a row that could not be judged', () => {
    const kept = SEASON_2026_EXTERNAL_MAPPING_RECORDS.filter(
      (record) => record.surfaceId !== season2026SurfaceId('Alder Park', 'Pitch 3')
    );
    const registry = buildExternalMappingRegistry(
      season2026ExternalMappingInput({ records: kept }),
      { graph: corpusGraph() }
    );
    const resolution = classifyExternalImport(corpusQuery(), registry);
    const undecidable = resolution.rows.find(
      (row) => row.rowClass === EXTERNAL_ROW_CLASS.UNDECIDABLE
    );
    const result = analyseImportImpact({
      subject: 'accepting an unjudged row',
      resolution,
      standing: corpusQuery().standing,
      query: { acceptedRowIds: [undecidable.rowId] },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    expect(codesOf(result.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_ROW_NOT_ACCEPTABLE
    );
    expect(result.moved).toEqual([]);
  });
});

describe('acceptance 4 — nothing is dropped, and an unmatched row says so', () => {
  it('surfaces a row that matches nothing, one finding per row', () => {
    const rows = [
      ...corpusQuery().rows,
      {
        rowId: 'invented#0',
        sourceLabel: 'invented',
        date: '2026-08-22',
        kickoffMinutes: 600,
        venueLabel: 'Alder Park (Back Pitch 2)',
        homeLabel: 'A Club We Do Not Play',
        awayLabel: 'Another One',
        format: null,
        division: null,
      },
    ];
    const resolution = classifyExternalImport({ ...corpusQuery(), rows }, corpusRegistry());
    expect(resolution.meta.rowsRead).toBe(corpusQuery().rows.length + 1);
    expect(resolution.meta.rowsUnmatched).toBe(1);
    expect(resolution.byClass[EXTERNAL_ROW_CLASS.UNMATCHED]).toEqual(['invented#0']);

    const unmatched = resolution.findings.filter(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_UNMATCHED
    );
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].details.rowId).toBe('invented#0');
    expect(unmatched[0].severity).toBe(EXTERNAL_IMPORT_SEVERITY.BLOCKING);
    expect(resolution.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
  });

  it('reports an ambiguous key rather than attributing a comparison to one fixture', () => {
    const first = corpusQuery().standing.find(
      (fixture) => fixture.fixtureId === corpusResolution().rows[0].fixtureId
    );
    const standing = [...corpusQuery().standing, { ...first, fixtureId: `${first.fixtureId}-dup` }];
    const resolution = classifyExternalImport({ ...corpusQuery(), standing }, corpusRegistry());
    expect(resolution.meta.rowsUndecidable).toBe(1);
    const finding = resolution.findings.find(
      (candidate) => candidate.code === EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_KEY_AMBIGUOUS
    );
    expect(finding).toBeDefined();
    expect(finding.details.candidateFixtureIds).toHaveLength(2);
  });
});

describe('acceptance 5 — the impact of accepting, on the corpus', () => {
  it('examines all sixteen acceptance sets over the four differing rows', () => {
    const sweep = corpusSweep();
    expect(sweep.domainRowIds).toEqual(acceptanceDomainOf(corpusResolution()));
    expect(sweep.domainRowIds).toHaveLength(4);
    expect(sweep.setsPossible).toBe(2 ** sweep.domainRowIds.length);
    expect(sweep.exhaustive).toBe(true);
    expect(sweep.meta.acceptanceSetsExamined).toBe(sweep.setsPossible);
    expect(sweep.meta.bookingPairsCompared).toBeGreaterThan(0);
    expect(4).toBeLessThanOrEqual(ACCEPTANCE_SWEEP_CAP);
  });

  it('finds exactly one safe set on this corpus, and it is the empty one', () => {
    const sweep = corpusSweep();
    expect(sweep.safeSetKeys).toEqual([acceptanceSetKey([])]);
    expect(sweep.unsafeSetKeys).toHaveLength(sweep.setsPossible - 1);
    expect(sweep.undeterminedSetKeys).toEqual([]);
    expect(sweep.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
    // Every verdict is a member of the enum, produced by the one derivation.
    for (const result of sweep.results) {
      expect(Object.values(EXTERNAL_IMPACT_VERDICT)).toContain(result.verdict);
    }
  });

  it('the standing plan on those two dates carries no clash of its own', () => {
    const none = impactOfSet(corpusSweep(), []);
    expect(none.verdict).toBe(EXTERNAL_IMPACT_VERDICT.SAFE);
    expect(none.introduced).toEqual([]);
    expect(none.preexisting).toEqual([]);
    expect(none.moved).toEqual([]);
    expect(none.meta.bookingPairsCompared).toBeGreaterThan(0);
  });

  it('a lone 10:00 -> 10:30 move leaves a 0-minute gap against a 20-minute floor', () => {
    const sweep = corpusSweep();
    const early = corpusResolution().rows.find(
      (row) =>
        row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_DIFFERING &&
        row.differences[0].ours === 600 &&
        row.differences[0].theirs === 630
    );
    expect(early).toBeDefined();
    const result = impactOfSet(sweep, [early.rowId]);
    expect(result.verdict).toBe(EXTERNAL_IMPACT_VERDICT.UNSAFE);
    expect(result.moved).toHaveLength(1);

    const turnover = result.introduced.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_TURNOVER_SHORTFALL
    );
    const cadence = result.introduced.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CADENCE_BREACH
    );
    expect(turnover).toBeDefined();
    expect(cadence).toBeDefined();

    // Both magnitudes derived from game_formats.csv rather than typed in.
    const timing = getFormatTiming(corpusTiming(), '11v11');
    const gapMinutes = Number(turnover.details.gapMinutes);
    const cadenceMinutes = Number(cadence.details.cadenceMinutes);
    expect(gapMinutes).toBe(0);
    expect(turnover.details.floorMinutes).toBe(timing.turnoverMinMinutes);
    expect(cadence.details.blockMinutes).toBe(timing.blockMinutes);
    expect(cadenceMinutes).toBe(timing.occupancyMinutes.scheduled + gapMinutes);
    expect(cadence.details.shortfallMinutes).toBe(timing.blockMinutes - cadenceMinutes);
  });

  it('a lone 12:00 -> 12:30 move lands on the overlapping pitch — incident 3, to the minute', () => {
    const sweep = corpusSweep();
    const late = corpusResolution().rows.find(
      (row) =>
        row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_DIFFERING &&
        row.differences[0].ours === 720 &&
        row.differences[0].theirs === 750
    );
    expect(late).toBeDefined();
    const result = impactOfSet(sweep, [late.rowId]);
    expect(result.verdict).toBe(EXTERNAL_IMPACT_VERDICT.UNSAFE);

    const clashes = result.introduced.filter(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_INTRODUCED
    );
    expect(clashes.length).toBeGreaterThan(0);
    for (const clash of clashes) {
      expect(clash.details.facilityCode).toBe('OCCUPIED_SPATIAL_OVERLAP');
      // The overlap is the 11v11 occupancy end against the 9v9 kickoff.
      const overlap =
        Math.min(Number(clash.details.endAMinutes), Number(clash.details.endBMinutes)) -
        Math.max(Number(clash.details.startAMinutes), Number(clash.details.startBMinutes));
      expect(overlap).toBe(10);
    }
  });

  it('accepting all four is not clean on this corpus: the 12:30 pair still clashes', () => {
    const all = impactOfSet(corpusSweep(), corpusSweep().domainRowIds);
    expect(all.verdict).toBe(EXTERNAL_IMPACT_VERDICT.UNSAFE);
    expect(all.moved).toHaveLength(4);
    // The turnover shortfall is gone — both slots moved together — and the
    // spatial overlap is what remains.
    expect(codesOf(all.introduced)).not.toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_TURNOVER_SHORTFALL
    );
    expect(codesOf(all.introduced)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_INTRODUCED
    );
  });

  it('says on every result that the verdict is about that set alone', () => {
    for (const result of corpusSweep().results) {
      const scope = result.findings.find(
        (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SCOPE_STATED
      );
      expect(scope).toBeDefined();
      expect(scope.details.setKey).toBe(result.setKey);
      expect(scope.details.layersNotConsulted.length).toBeGreaterThan(0);
      expect(scope.details.dates).toEqual(['2026-08-22', '2026-08-23']);
    }
  });

  it('an acceptance that moves nothing says so instead of reading as an all-clear', () => {
    const identical = corpusResolution()
      .rows.filter((row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL)
      .map((row) => row.rowId);
    expect(identical.length).toBeGreaterThan(0);
    const result = analyseImportImpact({
      subject: 'accepting rows that already agree',
      resolution: corpusResolution(),
      standing: corpusQuery().standing,
      query: { acceptedRowIds: identical },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    expect(result.moved).toEqual([]);
    expect(codesOf(result.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_PROJECTED
    );
    expect(result.verdict).toBe(EXTERNAL_IMPACT_VERDICT.SAFE);
  });
});

describe('acceptance 6 — a whole-import verdict does not transfer to a subset', () => {
  /**
   * The counterfactual the club actually faced: the seeding weekend judged on
   * the 11v11 layer alone, which is what an analysis that looks only at the
   * pitches the import names would see.
   */
  function counterfactualSweep() {
    if (cache.counterfactual === undefined) {
      cache.counterfactual = sweepAcceptanceSets({
        subject: 'the 11v11 layer alone',
        resolution: corpusResolution(),
        standing: corpusQuery().standing.filter((fixture) => fixture.format === '11v11'),
        graph: corpusGraph(),
        timingTable: corpusTiming(),
      });
    }
    return cache.counterfactual;
  }

  it('on the 11v11 layer alone, accepting everything is safe and seven subsets are not', () => {
    const sweep = counterfactualSweep();
    const all = impactOfSet(sweep, sweep.domainRowIds);
    expect(all.verdict).toBe(EXTERNAL_IMPACT_VERDICT.SAFE);
    expect(sweep.unsafeSetKeys.length).toBeGreaterThan(0);
    expect(sweep.safeSetKeys.length + sweep.unsafeSetKeys.length).toBe(sweep.setsPossible);

    // The figure is read off the sweep, not typed in, and then reconciled
    // against the structure that produces it: a set is unsafe exactly when it
    // moves one slot of a pitch's pair and not the other.
    const bySurface = new Map();
    for (const rowId of sweep.domainRowIds) {
      const row = corpusResolution().rows.find((candidate) => candidate.rowId === rowId);
      const fixture = corpusQuery().standing.find(
        (candidate) => candidate.fixtureId === row.fixtureId
      );
      const list = bySurface.get(fixture.surfaceId) ?? [];
      list.push(rowId);
      bySurface.set(fixture.surfaceId, list);
    }
    expect(bySurface.size).toBe(2);
    let expectedUnsafe = 0;
    for (const result of sweep.results) {
      const accepted = new Set(result.acceptedRowIds);
      const splitsAPair = [...bySurface.values()].some((pair) => {
        const taken = pair.filter((rowId) => accepted.has(rowId)).length;
        return taken === 1 && pair.length === 2;
      });
      // The single-slot moves that are unsafe are the ones that pull the earlier
      // slot forward without its partner; pulling the later one forward widens
      // the gap and is safe.
      const earlyOnly = [...bySurface.values()].some((pair) => {
        const sorted = [...pair].sort();
        return accepted.has(sorted[0]) && !accepted.has(sorted[1]);
      });
      if (splitsAPair && earlyOnly) expectedUnsafe += 1;
    }
    expect(sweep.unsafeSetKeys).toHaveLength(expectedUnsafe);
    expect(expectedUnsafe).toBe(7);
  });

  it('reports the safe supersets of an unsafe subset at blocking', () => {
    const sweep = counterfactualSweep();
    const subsetFindings = sweep.findings.filter(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SUBSET_UNSAFE
    );
    expect(subsetFindings.length).toBeGreaterThan(0);
    expect(subsetFindings[0].severity).toBe(EXTERNAL_IMPORT_SEVERITY.BLOCKING);
    expect(sweep.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);

    const full = subsetFindings.find(
      (finding) => finding.details.acceptedRowIds.length === sweep.domainRowIds.length
    );
    expect(full).toBeDefined();
    expect(full.details.unsafeSubsetKeys).toHaveLength(sweep.unsafeSetKeys.length);
  });

  it('the whole-import analysis, built here, is wrong about seven of the sixteen', () => {
    // This is the analysis the brief warns about: evaluate the import as a
    // whole, report one verdict, and let a reader carry it to a partial
    // acceptance. It is not a straw man — it is `analyseImportImpact()` asked
    // one question instead of all of them.
    const sweep = counterfactualSweep();
    const wholeImport = analyseImportImpact({
      subject: 'the import, as a whole',
      resolution: corpusResolution(),
      standing: corpusQuery().standing.filter((fixture) => fixture.format === '11v11'),
      query: { acceptedRowIds: sweep.domainRowIds },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    expect(wholeImport.verdict).toBe(EXTERNAL_IMPACT_VERDICT.SAFE);

    const carriedWrongly = sweep.results.filter((result) => result.verdict !== wholeImport.verdict);
    expect(carriedWrongly).toHaveLength(sweep.unsafeSetKeys.length);
    expect(carriedWrongly.length).toBeGreaterThan(0);

    // And the result itself refuses to be carried: its own scope finding says so.
    const scope = wholeImport.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SCOPE_STATED
    );
    expect(scope.message).toContain('does not transfer');
  });

  it('reports a sweep that did not examine every set, rather than implying it did', () => {
    const sweep = corpusSweep();
    const partial = sweepAcceptanceSets({
      subject: 'a partial sweep',
      resolution: corpusResolution(),
      standing: corpusQuery().standing,
      graph: corpusGraph(),
      timingTable: corpusTiming(),
      sets: [[], sweep.domainRowIds],
    });
    expect(partial.exhaustive).toBe(false);
    const finding = partial.findings.find(
      (candidate) =>
        candidate.code === EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SETS_NOT_EXHAUSTIVE
    );
    expect(finding).toBeDefined();
    expect(finding.details.setsExamined).toBe(2);
    expect(finding.details.setsPossible).toBe(16);
  });
});

describe('acceptance 7 — unknown is not zero', () => {
  /** The corpus's two untimed `Scrimmage` rows (GAP-14), at Summit HS. */
  function scrimmageFixtures() {
    return toSeason2026StandingFixtures(corpusGames()).filter(
      (fixture) => fixture.endMinutes === null
    );
  }

  it('the corpus really does carry fixtures with no known footprint', () => {
    const untimed = scrimmageFixtures();
    expect(untimed.length).toBeGreaterThan(0);
    expect(new Set(untimed.map((fixture) => fixture.format))).toEqual(new Set(['Scrimmage']));
  });

  it('a moved fixture with no footprint makes its own set undetermined, never safe', () => {
    const untimed = scrimmageFixtures();
    const [first, second] = untimed;
    expect(second).toBeDefined();
    expect(first.surfaceId).toBe(second.surfaceId);

    const rows = [
      {
        rowId: 'scrimmage-move#0',
        sourceLabel: 'constructed',
        date: first.date,
        kickoffMinutes: first.kickoffMinutes + 30,
        venueLabel: 'Summit (Stadium)',
        homeLabel: first.homeLabel,
        awayLabel: first.awayLabel,
        format: null,
        division: null,
      },
    ];
    const registry = buildExternalMappingRegistry(
      {
        registryId: 'summit',
        label: 'a registry that names the stadium',
        party: 'test league',
        records: [
          {
            id: 'summit-stadium',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'Summit (Stadium)',
            venueId: first.venueId,
            surfaceId: first.surfaceId,
            subjectId: null,
            provenance: 'constructed for tests/externalFixtureImport.test.js',
          },
        ],
      },
      { graph: corpusGraph() }
    );
    const resolution = classifyExternalImport(
      {
        subject: 'moving an untimed scrimmage',
        rows,
        standing: [first, second],
        keyFields: ['date', 'home', 'away'],
        comparedFields: ['kickoffMinutes', 'venueId', 'surfaceId'],
      },
      registry
    );
    expect(resolution.meta.rowsMatchedDiffering).toBe(1);

    const moved = analyseImportImpact({
      subject: 'moving an untimed scrimmage',
      resolution,
      standing: [first, second],
      query: { acceptedRowIds: ['scrimmage-move#0'] },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    expect(moved.verdict).toBe(EXTERNAL_IMPACT_VERDICT.UNDETERMINED);
    expect(codesOf(moved.introduced)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_UNDETERMINED
    );

    // Positive control: the identical projection with a footprint is decided.
    const timed = analyseImportImpact({
      subject: 'the same move with a known footprint',
      resolution,
      standing: [
        { ...first, format: '11v11', endMinutes: first.kickoffMinutes + 90 },
        { ...second, format: '11v11', endMinutes: second.kickoffMinutes + 90 },
      ],
      query: { acceptedRowIds: ['scrimmage-move#0'] },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    expect(timed.verdict).not.toBe(EXTERNAL_IMPACT_VERDICT.UNDETERMINED);
  });

  it('a standing undecidable pair the import does not touch is named, not folded in', () => {
    // The corpus scope holds the two Summit scrimmages on 08/22. They make no
    // acceptance set undetermined, and the scope finding says how many there are.
    const none = impactOfSet(corpusSweep(), []);
    expect(none.verdict).toBe(EXTERNAL_IMPACT_VERDICT.SAFE);
    const scope = none.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SCOPE_STATED
    );
    expect(scope.details.standingUndecidablePairs).toBeGreaterThan(0);
  });
});

describe('acceptance 8 — the avoid-windows export, and incident 3', () => {
  function corpusExport() {
    if (cache.export === undefined) {
      cache.export = buildAvoidWindows({
        query: {
          subject: 'avoid windows for the seeding weekend',
          documentId: 'season-2026/avoid/seeding-weekend',
          generatedFor: 'external seeding league',
          dates: ['2026-08-22', '2026-08-23'],
          surfaceIds: [
            season2026SurfaceId('Alder Park', 'Pitch 2'),
            season2026SurfaceId('Alder Park', 'Pitch 3'),
          ],
          excludeFixtureIds: externalFixtureIds(),
        },
        registry: corpusRegistry(),
        standing: toSeason2026StandingFixtures(corpusGames()),
        graph: corpusGraph(),
      });
    }
    return cache.export;
  }

  it('publishes windows the recipient could not have derived, and says so', () => {
    const exported = corpusExport();
    expect(exported.windows.length).toBeGreaterThan(0);
    expect(exported.unmappedSurfaceIds).toEqual([]);
    expect(exported.meta.avoidScopeCells).toBe(4);

    // Every window on this scope comes from a pitch the league has no name for.
    expect(exported.meta.avoidWindowsFromOverlap).toBe(exported.windows.length);
    for (const window of exported.windows) {
      expect(window.origin).toBe('overlapping-surface');
      expect(window.sourceSurfaceIds[0]).not.toBe(window.surfaceId);
    }
    expect(codesOf(exported.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_WINDOW_FROM_OVERLAP
    );
    // And it is written in their naming, never ours.
    for (const window of exported.document.windows) {
      expect(window.externalLabel).toMatch(/^Alder Park \(Back Pitch [23]\)$/);
    }
  });

  it('refuses the league’s own 12:30 and admits the agreed 12:00', () => {
    const exported = corpusExport();
    const timing = getFormatTiming(corpusTiming(), '11v11');
    const label = 'Alder Park (Back Pitch 2)';

    const published = corpusExternal().find(
      (fixture) =>
        fixture.externalVenueLabel === label &&
        fixture.date === '2026-08-22' &&
        fixture.kickoffMinutes === 750
    );
    const agreed = corpusGames().find(
      (game) =>
        game.date === '2026-08-22' && game.field === 'Pitch 2' && game.kickoffMinutes === 720
    );
    expect(published).toBeDefined();
    expect(agreed).toBeDefined();

    const refused = avoidWindowsAdmit(exported.document.windows, {
      date: '2026-08-22',
      externalLabel: label,
      startMinutes: published.kickoffMinutes,
      endMinutes: published.kickoffMinutes + timing.occupancyMinutes.scheduled,
    });
    expect(refused.verdict).toBe(EXTERNAL_IMPACT_VERDICT.UNSAFE);
    expect(refused.blockedBy.length).toBeGreaterThan(0);
    for (const window of refused.blockedBy) {
      const overlap =
        Math.min(window.endMinutes, published.kickoffMinutes + timing.occupancyMinutes.scheduled) -
        Math.max(window.startMinutes, published.kickoffMinutes);
      expect(overlap).toBe(10);
    }

    const admitted = avoidWindowsAdmit(exported.document.windows, {
      date: '2026-08-22',
      externalLabel: label,
      startMinutes: agreed.kickoffMinutes,
      endMinutes: agreed.kickoffMinutes + timing.occupancyMinutes.scheduled,
    });
    expect(admitted.verdict).toBe(EXTERNAL_IMPACT_VERDICT.SAFE);
    expect(admitted.blockedBy).toEqual([]);
  });

  it('the naive document — the pitch’s own bookings only — admits the 12:30', () => {
    // The adversarial control: an export built without the occupancy footprint.
    const exported = corpusExport();
    const naive = exported.document.windows.filter((window) => window.origin === 'own-surface');
    const timing = getFormatTiming(corpusTiming(), '11v11');
    const verdict = avoidWindowsAdmit(naive, {
      date: '2026-08-22',
      externalLabel: 'Alder Park (Back Pitch 2)',
      startMinutes: 750,
      endMinutes: 750 + timing.occupancyMinutes.scheduled,
    });
    expect(verdict.verdict).toBe(EXTERNAL_IMPACT_VERDICT.SAFE);
    // Which is exactly the answer that produced incident 3.
  });

  it('carries an unknown end open rather than closing it or dropping the row', () => {
    const summit = toSeason2026StandingFixtures(corpusGames()).find(
      (fixture) => fixture.endMinutes === null
    );
    const registry = buildExternalMappingRegistry(
      {
        registryId: 'summit-export',
        label: 'a registry that names the stadium',
        party: 'test league',
        records: [
          {
            id: 'summit-stadium',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'Summit (Stadium)',
            venueId: summit.venueId,
            surfaceId: summit.surfaceId,
            subjectId: null,
            provenance: 'constructed for tests/externalFixtureImport.test.js',
          },
        ],
      },
      { graph: corpusGraph() }
    );
    const exported = buildAvoidWindows({
      query: {
        subject: 'the stadium on the seeding Saturday',
        documentId: 'summit-1',
        generatedFor: 'external seeding league',
        dates: [summit.date],
        surfaceIds: [summit.surfaceId],
        excludeFixtureIds: [],
      },
      registry,
      standing: toSeason2026StandingFixtures(corpusGames()),
      graph: corpusGraph(),
    });
    expect(exported.meta.avoidWindowsOpenEnded).toBeGreaterThan(0);
    expect(codesOf(exported.findings)).toContain(EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_END_UNKNOWN);
    const open = exported.document.windows.find((window) => window.endMinutes === null);
    expect(open).toBeDefined();
    expect(open.endAt).toBeNull();

    // A proposal against an open window is undetermined, never admitted.
    const verdict = avoidWindowsAdmit(exported.document.windows, {
      date: summit.date,
      externalLabel: 'Summit (Stadium)',
      startMinutes: open.startMinutes,
      endMinutes: open.startMinutes + 90,
    });
    expect(verdict.verdict).toBe(EXTERNAL_IMPACT_VERDICT.UNDETERMINED);
  });

  it('refuses to export a surface with no external name, under our own id', () => {
    const orphan = season2026SurfaceId('Brookside Park', 'Upper 1');
    const exported = buildAvoidWindows({
      query: {
        subject: 'a pitch the league has no name for',
        documentId: 'orphan-1',
        generatedFor: 'external seeding league',
        dates: ['2026-08-22'],
        surfaceIds: [orphan],
        excludeFixtureIds: [],
      },
      registry: corpusRegistry(),
      standing: toSeason2026StandingFixtures(corpusGames()),
      graph: corpusGraph(),
    });
    expect(exported.unmappedSurfaceIds).toEqual([orphan]);
    expect(codesOf(exported.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_LABEL_UNMAPPED
    );
    expect(exported.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
    for (const window of exported.document.windows) {
      expect(window.externalLabel).not.toBe(orphan);
    }
  });

  it('refuses a surface two external labels claim', () => {
    const surfaceId = season2026SurfaceId('Alder Park', 'Pitch 2');
    const registry = buildExternalMappingRegistry(
      season2026ExternalMappingInput({
        records: [
          ...SEASON_2026_EXTERNAL_MAPPING_RECORDS,
          {
            id: 'renamed',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'Alder Park (Championship Pitch)',
            venueId: season2026VenueId('Alder Park'),
            surfaceId,
            subjectId: null,
            provenance: 'constructed: the league renamed the pitch mid-season',
          },
        ],
      }),
      { graph: corpusGraph() }
    );
    const label = reverseResolveSurface(registry, surfaceId);
    expect(label.state).toBe(EXTERNAL_NAME_RESOLUTION.AMBIGUOUS);

    const exported = buildAvoidWindows({
      query: {
        subject: 'a pitch with two external names',
        documentId: 'ambiguous-1',
        generatedFor: 'external seeding league',
        dates: ['2026-08-22'],
        surfaceIds: [surfaceId],
        excludeFixtureIds: [],
      },
      registry,
      standing: toSeason2026StandingFixtures(corpusGames()),
      graph: corpusGraph(),
    });
    expect(codesOf(exported.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_LABEL_AMBIGUOUS
    );
    expect(exported.document.windows).toEqual([]);
  });
});

describe('acceptance 9 — the round trip', () => {
  function corpusExport() {
    if (cache.export === undefined) {
      cache.export = buildAvoidWindows({
        query: {
          subject: 'avoid windows for the seeding weekend',
          documentId: 'season-2026/avoid/seeding-weekend',
          generatedFor: 'external seeding league',
          dates: ['2026-08-22', '2026-08-23'],
          surfaceIds: [
            season2026SurfaceId('Alder Park', 'Pitch 2'),
            season2026SurfaceId('Alder Park', 'Pitch 3'),
          ],
          excludeFixtureIds: externalFixtureIds(),
        },
        registry: corpusRegistry(),
        standing: toSeason2026StandingFixtures(corpusGames()),
        graph: corpusGraph(),
      });
    }
    return cache.export;
  }

  it('reads the document back to exactly the windows it was built from', () => {
    const exported = corpusExport();
    const check = checkAvoidWindowRoundTrip(exported, corpusRegistry());
    expect(check.missing).toEqual([]);
    expect(check.unexpected).toEqual([]);
    expect(check.status).toBe(EXTERNAL_IMPORT_STATUS.ALLOWED);

    const readBack = readAvoidWindowDocument(exported.document, corpusRegistry());
    expect(readBack.meta.avoidWindowsReadBack).toBe(exported.windows.length);
    expect(readBack.windows.map((window) => window.surfaceId).sort()).toEqual(
      exported.windows.map((window) => window.surfaceId).sort()
    );
    // The document is valid against its own schema, both directions.
    expect(() => AvoidWindowDocumentSchema.parse(exported.document)).not.toThrow();
  });

  it('fails loudly when the registry can no longer read a label it wrote', () => {
    const exported = corpusExport();
    const kept = SEASON_2026_EXTERNAL_MAPPING_RECORDS.filter(
      (record) => record.surfaceId !== season2026SurfaceId('Alder Park', 'Pitch 3')
    );
    const reduced = buildExternalMappingRegistry(
      season2026ExternalMappingInput({ records: kept }),
      { graph: corpusGraph() }
    );
    const check = checkAvoidWindowRoundTrip(exported, reduced);
    expect(check.missing.length).toBeGreaterThan(0);
    expect(codesOf(check.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_ROUNDTRIP_DIVERGED
    );
    expect(codesOf(check.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_UNRESOLVED
    );
    expect(check.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
  });
});

describe('acceptance 10 — persistence is a seam, and it says so', () => {
  it('says on the record that it lives in memory, on every registry', () => {
    const registry = corpusRegistry();
    expect(registry.durability).toBe(EXTERNAL_MAPPING_DURABILITY.IN_MEMORY);
    const stated = registry.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_NOT_PERSISTED
    );
    expect(stated).toBeDefined();
    expect(stated.severity).toBe(EXTERNAL_IMPORT_SEVERITY.INFO);
    expect(registry.status).toBe(EXTERNAL_IMPORT_STATUS.ALLOWED);
  });

  it('round-trips through the seam byte-identically', () => {
    const registry = corpusRegistry();
    const document = serialiseExternalMappingRegistry(registry);
    const readBack = readExternalMappingRegistry(document, { graph: corpusGraph() });
    const again = serialiseExternalMappingRegistry(readBack);
    // Byte-identical, not deep-equal: a lossy transform can pass a deep-equal
    // and cannot pass this.
    expect(JSON.stringify(again)).toBe(JSON.stringify(document));
    expect(readBack.records).toEqual(registry.records);
    expect(readBack.status).toBe(registry.status);
  });

  it('the document carries no Date, no function and nothing exotic', () => {
    const document = serialiseExternalMappingRegistry(corpusRegistry());
    const walk = (value, path) => {
      if (value === null) return;
      const kind = typeof value;
      if (kind === 'string' || kind === 'number' || kind === 'boolean') return;
      expect(kind, `${path} is a ${kind}`).toBe('object');
      expect(value instanceof Date, `${path} is a Date`).toBe(false);
      if (Array.isArray(value)) {
        value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
        return;
      }
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
    };
    walk(document, 'document');
    // Every date-shaped field is a naive `YYYY-MM-DD` string (GAP-30).
    for (const record of document.records) {
      if (record.statedOn === null) continue;
      expect(record.statedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(() => MappingDocumentSchema.parse(document)).not.toThrow();
  });

  it('re-runs every construction check on read, rather than trusting the document', () => {
    const document = serialiseExternalMappingRegistry(corpusRegistry());
    const tampered = {
      ...document,
      records: document.records.map((record) => ({ ...record, surfaceId: 'alder-park/pitch-9' })),
    };
    const readBack = readExternalMappingRegistry(tampered, { graph: corpusGraph() });
    expect(codesOf(readBack.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_TARGET_UNKNOWN
    );
    expect(readBack.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
  });

  it('refuses a document it could not read back', () => {
    expect(() =>
      MappingDocumentSchema.parse({
        ...serialiseExternalMappingRegistry(corpusRegistry()),
        extra: 1,
      })
    ).toThrow();
  });
});

describe('acceptance 11 — every meta-assertion can fail, and here is the input', () => {
  it('zero rows read is a blocking finding, not a perfect score', () => {
    const resolution = classifyExternalImport({ ...corpusQuery(), rows: [] }, corpusRegistry());
    expect(resolution.meta.rowsRead).toBe(0);
    expect(codesOf(resolution.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPORT_NO_ROWS_READ
    );
    expect(resolution.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
  });

  it('a run in which nothing reached a decidable class says so', () => {
    const empty = buildExternalMappingRegistry({
      registryId: 'empty',
      label: 'no records',
      party: 'test league',
      records: [],
    });
    const resolution = classifyExternalImport(corpusQuery(), empty);
    expect(resolution.meta.rowsUndecidable).toBe(resolution.meta.rowsRead);
    expect(codesOf(resolution.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPORT_NOTHING_CLASSIFIED
    );
  });

  it('a projection that compared no pair says "nothing was looked at"', () => {
    const one = corpusQuery().standing.find(
      (fixture) => fixture.fixtureId === corpusResolution().rows[0].fixtureId
    );
    const result = analyseImportImpact({
      subject: 'a scope with one fixture in it',
      resolution: corpusResolution(),
      standing: [one],
      query: { acceptedRowIds: [], dates: [one.date] },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    expect(result.meta.bookingPairsCompared).toBe(0);
    expect(codesOf(result.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_EXAMINED
    );
    expect(result.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
  });

  it('an empty export scope is refused rather than answered with "avoid nothing"', () => {
    const exported = buildAvoidWindows({
      query: {
        subject: 'nothing at all',
        documentId: 'empty-1',
        generatedFor: 'external seeding league',
        dates: [],
        surfaceIds: [],
        excludeFixtureIds: [],
      },
      registry: corpusRegistry(),
      standing: toSeason2026StandingFixtures(corpusGames()),
      graph: corpusGraph(),
    });
    expect(codesOf(exported.findings)).toContain(EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_SCOPE_EMPTY);
    expect(exported.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
  });

  it('a non-empty scope that produced no window is a blocking finding', () => {
    const exported = buildAvoidWindows({
      query: {
        subject: 'a date with nothing on it',
        documentId: 'quiet-1',
        generatedFor: 'external seeding league',
        dates: ['2026-08-23'],
        surfaceIds: [season2026SurfaceId('Alder Park', 'Pitch 2')],
        excludeFixtureIds: externalFixtureIds(),
      },
      registry: corpusRegistry(),
      standing: toSeason2026StandingFixtures(corpusGames()),
      graph: corpusGraph(),
    });
    expect(exported.windows).toEqual([]);
    expect(codesOf(exported.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_NONE_EXPORTED
    );
  });

  it('refuses a key or compared field it does not declare', () => {
    expect(() =>
      classifyExternalImport({ ...corpusQuery(), keyFields: ['venue'] }, corpusRegistry())
    ).toThrow(/not a key field/);
    expect(() =>
      classifyExternalImport({ ...corpusQuery(), comparedFields: ['kickoff'] }, corpusRegistry())
    ).toThrow(/not a compared field/);
  });
});

describe('externalImport — the shipping app is untouched', () => {
  it('nothing outside externalImport/ imports it', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'packages',
      'core',
      'src'
    );
    /** @type {string[]} */
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.js')) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);

    const importers = files.filter((file) => {
      if (file.includes(`${path.sep}externalImport${path.sep}`)) return false;
      return /from\s+'[^']*externalImport\//.test(readFileSync(file, 'utf8'));
    });
    expect(importers).toEqual([]);
  });
});
