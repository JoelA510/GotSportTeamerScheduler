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
  AVOID_WINDOW_ADMISSION_FIELDS,
  AvoidWindowDocumentSchema,
  EXTERNAL_FIELD_PRESENCE,
  EXTERNAL_IMPACT_VERDICT,
  EXTERNAL_IMPORT_REASON,
  EXTERNAL_IMPORT_REASON_SEVERITY,
  EXTERNAL_IMPORT_SEVERITY,
  EXTERNAL_IMPORT_STATUS,
  EXTERNAL_LOOKUP_SIDE,
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
  avoidWindowKey,
  avoidWindowsAdmit,
  buildAvoidWindows,
  buildExternalMappingRegistry,
  checkAvoidWindowRoundTrip,
  classifyExternalImport,
  createMappingUsage,
  deriveExternalImpactVerdict,
  externalImportSeverityOf,
  impactOfSet,
  mappingUsageFindings,
  normaliseExternalLabel,
  readAvoidWindowDocument,
  readExternalMappingRegistry,
  recordMappingUse,
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

/**
 * One list out of a finding's `details`, sorted, as a copy.
 *
 * `details` is `Record<string, unknown>` by design — it holds flat primitives,
 * ids and counts, and the type checker cannot know which. Copied rather than
 * sorted in place, so an assertion never reorders the finding it is reading.
 *
 * @param {Record<string, unknown>} details
 * @param {string} key
 * @returns {string[]}
 */
function detailList(details, key) {
  return [.../** @type {string[]} */ (details[key])].sort();
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
    // `external_fixtures_published.csv` has no Format or Division column at
    // all, and every one of our fixtures carries both — so all sixteen skips
    // are **ours only**, and none of them is a field neither side has.
    expect(resolution.meta.fieldsOneSided).toBe(resolution.meta.rowsRead * 2);
    expect(resolution.meta.fieldsUncompared).toBe(0);
    expect(codesOf(resolution.findings)).toContain(EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_ONE_SIDED);
    expect(codesOf(resolution.findings)).not.toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_UNCOMPARED
    );
    for (const finding of resolution.findings.filter(
      (candidate) => candidate.code === EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_ONE_SIDED
    )) {
      expect(finding.details.presence).toBe(EXTERNAL_FIELD_PRESENCE.OURS_ONLY);
    }
    for (const row of resolution.rows) {
      expect(row.uncomparedFields.sort()).toEqual(['division', 'format']);
      expect(row.oneSidedFields.sort()).toEqual(['division', 'format']);
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
    expect(none.moved).toEqual([]);
    expect(none.meta.bookingPairsCompared).toBeGreaterThan(0);

    // No clash and no shortfall — but the plan does carry one pair that could
    // not be *checked*: the two untimed Summit `Scrimmage` rows (GAP-14), whose
    // format `game_formats.csv` has no row for. That is reported rather than
    // read as clean, and it is named here from the corpus rather than allowed to
    // hide inside an `toEqual([])` that would also pass if a real clash went
    // unreported. `preexisting` findings are restated under one code, so the
    // pair is identified by the details the restatement carries.
    const untimed = toSeason2026StandingFixtures(corpusGames())
      .filter((fixture) => fixture.endMinutes === null && fixture.date === '2026-08-22')
      .map((fixture) => fixture.fixtureId)
      .sort();
    expect(untimed).toHaveLength(2);
    expect(
      none.preexisting.map((finding) =>
        [finding.details.bookingAId, finding.details.bookingBId].sort().join('~')
      )
    ).toEqual([untimed.join('~')]);
    for (const finding of none.preexisting) {
      expect(detailList(finding.details, 'checksUnrun')).toEqual(['cadence', 'turnover']);
      expect(finding.severity).toBe(EXTERNAL_IMPORT_SEVERITY.INFO);
    }
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
    expect(exported.unknownSurfaceIds).toEqual([]);
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
    // Two records claim it, so the repair is to delete one — not to write one,
    // which is what `unmappedSurfaceIds` asks for.
    expect(exported.ambiguousSurfaceIds).toEqual([surfaceId]);
    expect(exported.unmappedSurfaceIds).toEqual([]);
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

/* -------------------------------------------------------------------------- */
/* Pre-PR review: nine defects the fifty-six tests above did not see           */
/* -------------------------------------------------------------------------- */

describe('acceptance 12 — what the fifty-six tests above did not ask', () => {
  /**
   * The same export acceptance 8 and 9 build, under the same cache key.
   *
   * Rebuilt here rather than reached for across a `describe` boundary, exactly
   * as acceptance 9 does, so this block runs on its own with `-t`.
   */
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

  /**
   * The two proposals incident 3 turns on, both derived from the corpus: the
   * league's published 12:30 on `Alder Park (Back Pitch 2)`, which the document
   * exists to refuse, and the 12:00 the club agreed, which it must admit.
   */
  function incidentProposals() {
    const timing = getFormatTiming(corpusTiming(), '11v11');
    const externalLabel = 'Alder Park (Back Pitch 2)';
    const published = corpusExternal().find(
      (fixture) =>
        fixture.externalVenueLabel === externalLabel &&
        fixture.date === '2026-08-22' &&
        fixture.kickoffMinutes === 750
    );
    const agreed = corpusGames().find(
      (game) =>
        game.date === '2026-08-22' && game.field === 'Pitch 2' && game.kickoffMinutes === 720
    );
    // Meta-assertion: proposals built from `undefined` would make every verdict
    // below an answer about nothing.
    expect(published).toBeDefined();
    expect(agreed).toBeDefined();
    return {
      refused: {
        date: '2026-08-22',
        externalLabel,
        startMinutes: published.kickoffMinutes,
        endMinutes: published.kickoffMinutes + timing.occupancyMinutes.scheduled,
      },
      admitted: {
        date: '2026-08-22',
        externalLabel,
        startMinutes: agreed.kickoffMinutes,
        endMinutes: agreed.kickoffMinutes + timing.occupancyMinutes.scheduled,
      },
    };
  }

  it('1 — the read-back document still refuses what the document it came from refused', () => {
    const exported = corpusExport();
    const readBack = readAvoidWindowDocument(exported.document, corpusRegistry());
    // Meta-assertion: a read-back that yielded nothing would make every verdict
    // below `safe` by vacuity, which is the defect rather than the control.
    expect(readBack.windows).toHaveLength(exported.windows.length);
    expect(readBack.windows.length).toBeGreaterThan(0);

    const { refused, admitted } = incidentProposals();

    // Equivalence of **behaviour**, not of membership. The round-trip check
    // above compares key sets, and a document that came back having lost the
    // one field the admission test matches on passes that comparison while
    // admitting everything. So the question asked here is the document's own:
    // does the read-back still refuse the league's 12:30 and admit the 12:00?
    expect(avoidWindowsAdmit(exported.document.windows, refused).verdict).toBe(
      EXTERNAL_IMPACT_VERDICT.UNSAFE
    );
    expect(avoidWindowsAdmit(readBack.windows, refused).verdict).toBe(
      EXTERNAL_IMPACT_VERDICT.UNSAFE
    );
    expect(avoidWindowsAdmit(exported.document.windows, admitted).verdict).toBe(
      EXTERNAL_IMPACT_VERDICT.SAFE
    );
    expect(avoidWindowsAdmit(readBack.windows, admitted).verdict).toBe(
      EXTERNAL_IMPACT_VERDICT.SAFE
    );
  });

  it('1 — every field the admission test matches on survives the read, and each one is load bearing', () => {
    const exported = corpusExport();
    const readBack = readAvoidWindowDocument(exported.document, corpusRegistry());
    const { refused } = incidentProposals();

    // The general rule the defect breaks: a window that crosses the document
    // boundary must come back carrying every field `avoidWindowsAdmit()` reads,
    // or the reader's verdict is about a window it cannot recognise.
    expect(AVOID_WINDOW_ADMISSION_FIELDS.length).toBeGreaterThan(0);
    for (const window of readBack.windows) {
      for (const field of AVOID_WINDOW_ADMISSION_FIELDS) {
        expect(window).toHaveProperty(field);
      }
    }

    // And the positive control that makes the loop above worth running: drop
    // any one of those fields and the 12:30 stops being refused. A field that
    // could be deleted without changing the verdict would not belong on the
    // list, and a list nothing depends on is not a rule.
    for (const field of AVOID_WINDOW_ADMISSION_FIELDS) {
      const damaged = readBack.windows.map((window) => {
        const copy = { ...window };
        delete copy[field];
        return copy;
      });
      expect(avoidWindowsAdmit(damaged, refused).verdict).not.toBe(EXTERNAL_IMPACT_VERDICT.UNSAFE);
    }

    // The round-trip key carries the label too, so a document read back under a
    // different external name is a divergence rather than a match on surface id.
    const [first] = exported.windows;
    expect(avoidWindowKey(first)).not.toBe(
      avoidWindowKey({ ...first, externalLabel: `${first.externalLabel} (renamed)` })
    );
  });

  it('2 — a row that states no venue is undecidable, not identical', () => {
    const identical = corpusResolution().rows.find(
      (row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL
    );
    expect(identical).toBeDefined();
    const query = {
      ...corpusQuery(),
      rows: corpusQuery().rows.map((row) =>
        row.rowId === identical.rowId ? { ...row, venueLabel: null } : row
      ),
    };
    const resolution = classifyExternalImport(query, corpusRegistry());
    const row = resolution.rows.find((candidate) => candidate.rowId === identical.rowId);
    // Meta-assertion: a row this failed to find would pass every check below.
    expect(row).toBeDefined();

    // `schemas.js` states the contract outright — "`venueLabel` absent and
    // `venueLabel: null` mean opposite things ... the second is a row that must
    // be classified `undecidable`" — and declared is not enforced until
    // something fails when it is not.
    expect(row.rowClass).toBe(EXTERNAL_ROW_CLASS.UNDECIDABLE);
    expect(row.acceptable).toBe(false);
    expect(row.reasonCode).toBe(EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_VENUE_UNSTATED);
    expect(codesOf(resolution.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_VENUE_UNSTATED
    );
    expect(resolution.meta.rowsUndecidable).toBe(1);
    // The evidence it could compute is still published, exactly as it is for
    // the unresolved-label case.
    expect(row.uncomparedFields).toContain('venueId');
    expect(row.uncomparedFields).toContain('surfaceId');
    // And it is not in the acceptance domain, so nothing can accept it.
    expect(acceptanceDomainOf(resolution)).not.toContain(row.rowId);
  });

  it('3 — a participant record does not break the matching it exists to preserve', () => {
    const before = corpusResolution();
    const sample = corpusQuery().rows[0];
    // Meta-assertion: a label neither artifact carries would leave the record
    // unexercised and prove nothing about matching.
    expect(sample.homeLabel).toBeTruthy();

    const registry = buildExternalMappingRegistry(
      season2026ExternalMappingInput({
        records: [
          ...SEASON_2026_EXTERNAL_MAPPING_RECORDS,
          {
            id: 'a-participant-both-artifacts-spell-the-same-way',
            kind: EXTERNAL_MAPPING_KIND.PARTICIPANT,
            externalLabel: sample.homeLabel,
            venueId: null,
            surfaceId: null,
            subjectId: 'season-2026/participant/the-one-the-record-names',
            provenance: 'constructed for tests/externalFixtureImport.test.js',
          },
        ],
      }),
      { graph: corpusGraph() }
    );
    const after = classifyExternalImport(corpusQuery(), registry);

    // The record fired: without this the assertion below would hold of a
    // registry whose participant record was never consulted.
    expect(after.unexercisedRecords).toEqual([]);
    expect(after.meta.mappingRecordsExercised).toBe(
      SEASON_2026_EXTERNAL_MAPPING_RECORDS.length + 1
    );

    // Writing down what a league calls a team must not change what the rows
    // are. Both sides of the key go through the same canonicalisation, so a
    // record that renames one renames both.
    expect(after.byClass).toEqual(before.byClass);
    expect(after.meta.rowsUnmatched).toBe(0);
    expect(after.meta.rowsMatchedIdentical).toBe(before.meta.rowsMatchedIdentical);
    expect(after.meta.rowsMatchedDiffering).toBe(before.meta.rowsMatchedDiffering);
  });

  it('4 — a field our side does not carry is uncompared, not a difference against null', () => {
    const identical = corpusResolution().rows.find(
      (row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL
    );
    expect(identical).toBeDefined();
    const ours = corpusQuery().standing.find(
      (fixture) => fixture.fixtureId === identical.fixtureId
    );
    const theirs = corpusQuery().rows.find((row) => row.rowId === identical.rowId);
    expect(ours).toBeDefined();
    expect(theirs).toBeDefined();

    const resolution = classifyExternalImport(
      {
        subject: 'a division we do not record against one they publish',
        rows: [{ ...theirs, division: 'Seeding' }],
        standing: [{ ...ours, division: null }],
        keyFields: ['date', 'home', 'away'],
        comparedFields: ['kickoffMinutes', 'division'],
      },
      corpusRegistry()
    );
    const row = resolution.rows[0];
    expect(row.fixtureId).toBe(ours.fixtureId);

    // The uncompared guard belongs to the pair, not to one side of it. A null
    // on ours is exactly as uncomparable as a null on theirs, and reporting it
    // as `ours: null` puts a row in the acceptance domain that nothing can
    // honestly accept.
    expect(row.uncomparedFields).toContain('division');
    expect(row.comparedFields).not.toContain('division');
    expect(row.differences.map((difference) => difference.field)).not.toContain('division');
    expect(row.rowClass).toBe(EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL);
    expect(acceptanceDomainOf(resolution)).toEqual([]);
    // …and it is one-sided rather than merely uncompared: they publish a
    // division and we hold none, which the report must not spell the same way
    // as a field neither artifact carries. See acceptance 13 test 2.
    expect(row.oneSidedFields).toContain('division');
    expect(codesOf(resolution.findings)).toContain(EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_ONE_SIDED);
  });

  it('5 — sixteen sets that cover two of sixteen are not exhaustive', () => {
    const domain = acceptanceDomainOf(corpusResolution());
    expect(domain).toHaveLength(4);
    const sets = [];
    for (let i = 0; i < 8; i += 1) sets.push([]);
    for (let i = 0; i < 8; i += 1) sets.push([...domain]);

    const sweep = sweepAcceptanceSets({
      subject: 'sixteen sets that are two sets',
      resolution: corpusResolution(),
      standing: corpusQuery().standing,
      graph: corpusGraph(),
      timingTable: corpusTiming(),
      sets,
    });

    // A count is not a cover. Sixteen sets over a four-row domain is the number
    // an exhaustive sweep has, and these sixteen answer two of the sixteen
    // questions — including, in particular, none of the twelve single-pitch
    // splits that are the whole finding of this module.
    expect(sweep.setsPossible).toBe(16);
    expect(sweep.results).toHaveLength(16);
    expect(sweep.exhaustive).toBe(false);
    const finding = sweep.findings.find(
      (candidate) =>
        candidate.code === EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SETS_NOT_EXHAUSTIVE
    );
    expect(finding).toBeDefined();
    expect(finding.details.setsExamined).toBe(16);
    expect(finding.details.setsCovered).toBe(2);
    expect(finding.details.setsPossible).toBe(16);

    // A set naming a row outside the domain covers none of the domain either.
    const invented = sweepAcceptanceSets({
      subject: 'sixteen sets about rows that are not in the domain',
      resolution: corpusResolution(),
      standing: corpusQuery().standing,
      graph: corpusGraph(),
      timingTable: corpusTiming(),
      sets: [['a-row-no-classification-holds']],
    });
    expect(invented.exhaustive).toBe(false);
  });

  it('6 — a spacing pair that could not be checked says so, rather than passing quietly', () => {
    const untimed = toSeason2026StandingFixtures(corpusGames()).filter(
      (fixture) => fixture.endMinutes === null
    );
    const [first, second] = untimed;
    expect(second).toBeDefined();
    expect(first.date).toBe(second.date);
    expect(first.surfaceId).toBe(second.surfaceId);

    const elsewhere = {
      ...second,
      venueId: season2026VenueId('Alder Park'),
      surfaceId: season2026SurfaceId('Alder Park', 'Pitch 2'),
    };
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

    /**
     * The same move at two formats: the corpus's untimed `Scrimmage`, whose
     * `game_formats.csv` row does not exist (GAP-14), and an 11v11 whose does.
     *
     * @param {string|null} format
     * @param {number} laterKickoffMinutes
     */
    function moveOntoTheStadium(format, laterKickoffMinutes) {
      const a = {
        ...first,
        format,
        endMinutes: format === null ? null : first.kickoffMinutes + 90,
      };
      const b = {
        ...elsewhere,
        kickoffMinutes: laterKickoffMinutes,
        format,
        endMinutes: format === null ? null : laterKickoffMinutes + 90,
      };
      const resolution = classifyExternalImport(
        {
          subject: 'a fixture moved onto ground another already holds',
          rows: [
            {
              rowId: 'relocate#0',
              sourceLabel: 'constructed',
              date: b.date,
              kickoffMinutes: b.kickoffMinutes,
              venueLabel: 'Summit (Stadium)',
              homeLabel: b.homeLabel,
              awayLabel: b.awayLabel,
              format: null,
              division: null,
            },
          ],
          standing: [a, b],
          keyFields: ['date', 'home', 'away'],
          comparedFields: ['kickoffMinutes', 'venueId', 'surfaceId'],
        },
        registry
      );
      expect(resolution.meta.rowsMatchedDiffering).toBe(1);
      return analyseImportImpact({
        subject: 'a fixture moved onto ground another already holds',
        resolution,
        standing: [a, b],
        query: { acceptedRowIds: ['relocate#0'] },
        graph: corpusGraph(),
        timingTable: corpusTiming(),
      });
    }

    // Unregistered format, unknown end: neither the turnover floor nor the
    // declared block can be applied, and the pair says which and why instead of
    // leaving "nothing introduced" to mean "nothing was looked at".
    const unchecked = moveOntoTheStadium(null, second.kickoffMinutes);
    const skipped = unchecked.introduced.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SPACING_UNCHECKED
    );
    expect(skipped).toBeDefined();
    expect(detailList(skipped.details, 'checksUnrun')).toEqual(['cadence', 'turnover']);
    expect(skipped.details.format).toBeNull();

    // The positive control, on the same pair with a format `game_formats.csv`
    // does declare: the checks run, and one of them fires. A "no finding" that
    // meant "unchecked" and a "no finding" that meant "checked and clean" are
    // the two answers this code exists to tell apart.
    const timing = getFormatTiming(corpusTiming(), '11v11');
    const ran = moveOntoTheStadium('11v11', first.kickoffMinutes + 90);
    expect(codesOf(ran.introduced)).not.toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SPACING_UNCHECKED
    );
    const turnover = ran.introduced.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_TURNOVER_SHORTFALL
    );
    expect(turnover).toBeDefined();
    expect(turnover.details.gapMinutes).toBe(0);
    expect(turnover.details.floorMinutes).toBe(timing.turnoverMinMinutes);
  });

  it('7 — a scope surface the facility graph does not have is reported, not thrown', () => {
    const ghost = 'alder-park/pitch-9';
    const registry = buildExternalMappingRegistry(
      {
        registryId: 'ghost',
        label: 'a record naming ground the graph does not have',
        party: 'external seeding league',
        records: [
          {
            id: 'ghost-pitch',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'Alder Park (Pitch 9)',
            venueId: season2026VenueId('Alder Park'),
            surfaceId: ghost,
            subjectId: null,
            provenance: 'constructed for tests/externalFixtureImport.test.js',
          },
        ],
      },
      { graph: corpusGraph() }
    );
    // The precondition the defect needs: the label resolves backwards even
    // though the ground is not in the graph.
    expect(reverseResolveSurface(registry, ghost).state).toBe(EXTERNAL_NAME_RESOLUTION.RESOLVED);

    const exported = buildAvoidWindows({
      query: {
        subject: 'a pitch the club does not have',
        documentId: 'ghost-1',
        generatedFor: 'external seeding league',
        dates: ['2026-08-22'],
        surfaceIds: [ghost],
        excludeFixtureIds: [],
      },
      registry,
      standing: toSeason2026StandingFixtures(corpusGames()),
      graph: corpusGraph(),
    });
    expect(codesOf(exported.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_SURFACE_UNKNOWN
    );
    expect(exported.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);
    expect(exported.document.windows).toEqual([]);
    // Reported in the list for its own cause: a record already names this
    // surface, so it is not one of the records still to be written. See
    // acceptance 13 test 4.
    expect(exported.unknownSurfaceIds).toEqual([ghost]);
    expect(exported.unmappedSurfaceIds).toEqual([]);
    expect(exported.excludedSurfaceIds).toEqual([ghost]);
  });

  it('8 — "nothing projected" says what happened, and does not claim agreement', () => {
    const kept = SEASON_2026_EXTERNAL_MAPPING_RECORDS.filter(
      (record) => record.surfaceId !== season2026SurfaceId('Alder Park', 'Pitch 3')
    );
    const reduced = buildExternalMappingRegistry(
      season2026ExternalMappingInput({ records: kept }),
      { graph: corpusGraph() }
    );
    const resolution = classifyExternalImport(corpusQuery(), reduced);
    const refusedRowIds = resolution.rows.filter((row) => !row.acceptable).map((row) => row.rowId);
    // Meta-assertion: with nothing refused this would be a test about an
    // acceptance that happened to move nothing, which is the other case.
    expect(refusedRowIds.length).toBeGreaterThan(0);

    const result = analyseImportImpact({
      subject: 'accepting rows that could not be judged',
      resolution,
      standing: corpusQuery().standing,
      query: { acceptedRowIds: refusedRowIds },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    expect(result.moved).toEqual([]);
    const nothing = result.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_PROJECTED
    );
    expect(nothing).toBeDefined();

    // The rows were refused, not agreed with. A message that says they "already
    // agree" tells an operator the import was a no-op when in fact none of it
    // could be applied.
    expect(nothing.message).not.toMatch(/already agree/);
    expect(detailList(nothing.details, 'rejectedRowIds')).toEqual([...refusedRowIds].sort());
    expect(nothing.details.agreeingRowIds).toEqual([]);
    expect(codesOf(result.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_ROW_NOT_ACCEPTABLE
    );

    // And the other half of the same message, from the corpus: rows that really
    // do already agree are named as agreeing and nothing is called refused.
    const agreeing = corpusResolution()
      .rows.filter((row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL)
      .map((row) => row.rowId);
    expect(agreeing.length).toBeGreaterThan(0);
    const noop = analyseImportImpact({
      subject: 'accepting rows that already agree',
      resolution: corpusResolution(),
      standing: corpusQuery().standing,
      query: { acceptedRowIds: agreeing },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    const alsoNothing = noop.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_PROJECTED
    );
    expect(alsoNothing).toBeDefined();
    expect(alsoNothing.details.rejectedRowIds).toEqual([]);
    expect(detailList(alsoNothing.details, 'agreeingRowIds')).toEqual([...agreeing].sort());
  });

  it('9 — every set the sweep examined can be looked up by its ids, and nothing else can', () => {
    const sweep = corpusSweep();
    expect(sweep.results.length).toBeGreaterThan(0);
    for (const result of sweep.results) {
      const found = impactOfSet(sweep, result.acceptedRowIds);
      expect(found).toBe(result);
      // Order-independent, which is what makes the key a key.
      expect(impactOfSet(sweep, [...result.acceptedRowIds].reverse())).toBe(result);
    }
    expect(impactOfSet(sweep, ['a-row-this-sweep-never-saw'])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Second review round: the ledger's sides, and messages that name a cause     */
/* -------------------------------------------------------------------------- */

/**
 * Every label the imported publication carries, normalised. The **subject set**
 * for "a label only our own fixtures use", enumerated from the rows rather than
 * from anything a defect in the ledger would also corrupt.
 *
 * @returns {Set<string>}
 */
function importedParticipantLabels() {
  return new Set(
    corpusQuery()
      .rows.flatMap((row) => [row.homeLabel, row.awayLabel])
      .filter((label) => label !== null)
      .map((label) => normaliseExternalLabel(/** @type {string} */ (label)))
  );
}

/** A label the fixtures we hold carry and no imported row does. */
function standingOnlyLabel() {
  const imported = importedParticipantLabels();
  return corpusQuery()
    .standing.flatMap((fixture) => [fixture.homeLabel, fixture.awayLabel])
    .filter((label) => label !== null)
    .find((label) => !imported.has(normaliseExternalLabel(/** @type {string} */ (label))));
}

/**
 * A registry holding exactly one participant record for `label`.
 *
 * @param {string} label
 * @returns {import('@squadlogic/core/externalImport/types.js').ExternalMappingRegistry}
 */
function oneParticipantRegistry(label) {
  return buildExternalMappingRegistry({
    registryId: 'one-participant',
    label: 'a single participant record and nothing else',
    party: 'external seeding league',
    records: [
      {
        id: 'the-only-record',
        kind: EXTERNAL_MAPPING_KIND.PARTICIPANT,
        externalLabel: label,
        venueId: null,
        surfaceId: null,
        subjectId: 'season-2026/participant/the-one-the-record-names',
        provenance: 'constructed for tests/externalFixtureImport.test.js',
      },
    ],
  });
}

describe('acceptance 13 — the second review round', () => {
  it('1 — a record only our own fixtures fired is unexercised; one the import fired is not', () => {
    const ourLabel = standingOnlyLabel();
    // Meta-assertion: a label the import also carries would make the whole
    // test pass against a ledger that cannot tell the two sides apart.
    expect(ourLabel).toBeDefined();
    expect(importedParticipantLabels().has(normaliseExternalLabel(ourLabel))).toBe(false);

    const registry = oneParticipantRegistry(ourLabel);
    const ours = corpusQuery().standing.find(
      (fixture) => fixture.homeLabel === ourLabel || fixture.awayLabel === ourLabel
    );
    expect(ours).toBeDefined();

    // One imported row, resolving nothing: this registry holds no venue record,
    // so the row is undecidable and no lookup of the *publication's* reaches a
    // record. The standing side, however, does fire the record.
    const onlyOurSide = classifyExternalImport(
      {
        subject: 'a registry only our own fixtures exercise',
        rows: [corpusQuery().rows[0]],
        standing: corpusQuery().standing,
        keyFields: ['date', 'home', 'away'],
        comparedFields: ['kickoffMinutes'],
      },
      registry
    );

    // The ledger saw it fire — on our side. Without this the assertions below
    // would hold of a run in which the record was never consulted at all.
    expect(onlyOurSide.meta.standingRecordsExercised).toBe(1);
    expect(onlyOurSide.meta.standingLabelLookups).toBeGreaterThan(0);

    // …and it is still unexercised, because the ledger's question is whether
    // the imported publication used the record.
    expect(onlyOurSide.meta.mappingRecordsExercised).toBe(0);
    expect(onlyOurSide.unexercisedRecords.map((record) => record.id)).toEqual(['the-only-record']);
    expect(codesOf(onlyOurSide.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_REGISTRY_UNEXERCISED
    );
    expect(codesOf(onlyOurSide.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_RECORD_UNEXERCISED
    );
    expect(onlyOurSide.status).toBe(EXTERNAL_IMPORT_STATUS.REJECTED);

    // The other direction, on the same registry: an imported row that really
    // does carry the label exercises it, and neither finding fires.
    const theirSide = classifyExternalImport(
      {
        subject: 'a registry the imported publication exercises',
        rows: [{ ...corpusQuery().rows[0], homeLabel: ourLabel, venueLabel: null }],
        standing: corpusQuery().standing,
        keyFields: ['date', 'home', 'away'],
        comparedFields: ['kickoffMinutes'],
      },
      registry
    );
    expect(theirSide.meta.mappingRecordsExercised).toBe(1);
    expect(theirSide.unexercisedRecords).toEqual([]);
    expect(codesOf(theirSide.findings)).not.toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_REGISTRY_UNEXERCISED
    );
    expect(codesOf(theirSide.findings)).not.toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_RECORD_UNEXERCISED
    );

    // **The implementation that would pass this wrongly, built and rejected.**
    // A ledger that folds our-side lookups into the import's is exactly what
    // the previous round shipped; here it is, one call, and it reports the
    // record as exercised against the same registry and the same lookup.
    const folded = createMappingUsage();
    recordMappingUse(
      folded,
      resolveExternalName(registry, EXTERNAL_MAPPING_KIND.PARTICIPANT, ourLabel),
      { side: EXTERNAL_LOOKUP_SIDE.IMPORTED, optional: true }
    );
    expect(mappingUsageFindings(registry, folded).unexercised).toEqual([]);
    const attributed = createMappingUsage();
    recordMappingUse(
      attributed,
      resolveExternalName(registry, EXTERNAL_MAPPING_KIND.PARTICIPANT, ourLabel),
      { side: EXTERNAL_LOOKUP_SIDE.OURS }
    );
    expect(mappingUsageFindings(registry, attributed).unexercised.map((r) => r.id)).toEqual([
      'the-only-record',
    ]);
  });

  it('2 — a field one side carries names that side; a field neither carries says so', () => {
    const identical = corpusResolution().rows.find(
      (row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL
    );
    expect(identical).toBeDefined();
    const ours = corpusQuery().standing.find(
      (fixture) => fixture.fixtureId === identical.fixtureId
    );
    const theirs = corpusQuery().rows.find((row) => row.rowId === identical.rowId);
    expect(ours).toBeDefined();
    expect(theirs).toBeDefined();
    expect(ours.format).toBe('11v11');

    /**
     * @param {string|null} ourFormat
     * @param {string|null} theirFormat
     */
    const run = (ourFormat, theirFormat) =>
      classifyExternalImport(
        {
          subject: `ours ${String(ourFormat)} against theirs ${String(theirFormat)}`,
          rows: [{ ...theirs, format: theirFormat }],
          standing: [{ ...ours, format: ourFormat }],
          keyFields: ['date', 'home', 'away'],
          comparedFields: ['kickoffMinutes', 'format'],
        },
        corpusRegistry()
      );

    // **Only they carry it.** The published artifact states a format; we hold
    // none. The finding must say so, and must not say we agree.
    const theirsOnly = run(null, '9v9');
    expect(theirsOnly.rows[0].oneSidedFields).toEqual(['format']);
    expect(theirsOnly.rows[0].uncomparedFields).toEqual(['format']);
    expect(theirsOnly.meta.fieldsOneSided).toBe(1);
    const theirsOnlyFinding = theirsOnly.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_ONE_SIDED
    );
    expect(theirsOnlyFinding).toBeDefined();
    expect(theirsOnlyFinding.details.presence).toBe(EXTERNAL_FIELD_PRESENCE.THEIRS_ONLY);
    expect(theirsOnlyFinding.message).toMatch(/imported/);
    expect(theirsOnlyFinding.message).not.toMatch(/carries no value/);
    expect(codesOf(theirsOnly.findings)).not.toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_UNCOMPARED
    );

    // **Only we carry it.** The mirror image, and it must not be described in
    // the same words as the case above.
    const oursOnly = run('11v11', null);
    expect(oursOnly.rows[0].oneSidedFields).toEqual(['format']);
    const oursOnlyFinding = oursOnly.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_ONE_SIDED
    );
    expect(oursOnlyFinding).toBeDefined();
    expect(oursOnlyFinding.details.presence).toBe(EXTERNAL_FIELD_PRESENCE.OURS_ONLY);
    expect(oursOnlyFinding.message).not.toBe(theirsOnlyFinding.message);

    // **Neither carries it**, which is the only case the old sentence was true
    // of, and it keeps the old code.
    const neither = run(null, null);
    expect(neither.rows[0].oneSidedFields).toEqual([]);
    expect(neither.rows[0].uncomparedFields).toEqual(['format']);
    expect(neither.meta.fieldsOneSided).toBe(0);
    expect(neither.meta.fieldsUncompared).toBe(1);
    const neitherFinding = neither.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_UNCOMPARED
    );
    expect(neitherFinding).toBeDefined();
    expect(neitherFinding.details.presence).toBe(EXTERNAL_FIELD_PRESENCE.NEITHER);
    expect(neitherFinding.message).toMatch(/[Nn]either/);

    // **The implementation that would pass this wrongly**: one message for all
    // three. The three messages are pairwise different, so a single sentence
    // covering the three situations fails here.
    const messages = new Set([
      theirsOnlyFinding.message,
      oursOnlyFinding.message,
      neitherFinding.message,
    ]);
    expect(messages.size).toBe(3);
  });

  it('3 — "nothing projected" names the cause that applied, per row', () => {
    const differing = corpusResolution().rows.find(
      (row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_DIFFERING
    );
    expect(differing).toBeDefined();
    const itsFixture = corpusQuery().standing.find(
      (fixture) => fixture.fixtureId === differing.fixtureId
    );
    expect(itsFixture).toBeDefined();
    const elsewhere = corpusQuery()
      .standing.map((fixture) => fixture.date)
      .find((date) => date !== itsFixture.date);
    // Meta-assertion: a scope that still contained the fixture would move it,
    // and there would be no "nothing projected" finding to read.
    expect(elsewhere).toBeDefined();

    // **Out of scope.** The row differs on the clock and would move a fixture;
    // the projection simply never saw that fixture.
    const outOfScope = analyseImportImpact({
      subject: 'a differing row whose fixture is outside the projection',
      resolution: corpusResolution(),
      standing: corpusQuery().standing,
      query: { acceptedRowIds: [differing.rowId], dates: [elsewhere] },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    const scoped = outOfScope.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_PROJECTED
    );
    expect(scoped).toBeDefined();
    expect(scoped.message).not.toMatch(/records rather than moves/);
    expect(scoped.message).not.toMatch(/already agree/);
    expect(detailList(scoped.details, 'outOfScopeRowIds')).toEqual([differing.rowId]);
    expect(scoped.details.unprojectedRowIds).toEqual([]);
    expect(scoped.details.agreeingRowIds).toEqual([]);

    // **Differs only on a field this module records.** Same row, in scope,
    // with the clock agreed and the format disagreeing.
    const recordedOnly = classifyExternalImport(
      {
        subject: 'a row that differs only on the format',
        rows: [{ ...corpusQuery().rows.find((row) => row.rowId === differing.rowId) }].map(
          (row) => ({ ...row, kickoffMinutes: itsFixture.kickoffMinutes, format: '9v9' })
        ),
        standing: corpusQuery().standing,
        keyFields: ['date', 'home', 'away'],
        comparedFields: ['kickoffMinutes', 'format'],
      },
      corpusRegistry()
    );
    expect(recordedOnly.rows[0].rowClass).toBe(EXTERNAL_ROW_CLASS.MATCHED_DIFFERING);
    expect(recordedOnly.rows[0].differences.map((d) => d.field)).toEqual(['format']);
    const recorded = analyseImportImpact({
      subject: 'accepting a format disagreement',
      resolution: recordedOnly,
      standing: corpusQuery().standing,
      query: { acceptedRowIds: [recordedOnly.rows[0].rowId] },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    const recordedFinding = recorded.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_PROJECTED
    );
    expect(recordedFinding).toBeDefined();
    expect(detailList(recordedFinding.details, 'unprojectedRowIds')).toEqual([
      recordedOnly.rows[0].rowId,
    ]);
    expect(recordedFinding.details.outOfScopeRowIds).toEqual([]);
    expect(recordedFinding.message).toMatch(/records rather than moves/);

    // **We hold no value for what they publish.** Not a difference, and not
    // agreement either — the third thing the message used to call agreement.
    const identical = corpusResolution().rows.find(
      (row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL
    );
    const ours = corpusQuery().standing.find(
      (fixture) => fixture.fixtureId === identical.fixtureId
    );
    const theirs = corpusQuery().rows.find((row) => row.rowId === identical.rowId);
    const oneSided = classifyExternalImport(
      {
        subject: 'a division they publish and we do not hold',
        rows: [{ ...theirs, division: 'Seeding' }],
        standing: corpusQuery().standing.map((fixture) =>
          fixture.fixtureId === ours.fixtureId ? { ...fixture, division: null } : fixture
        ),
        keyFields: ['date', 'home', 'away'],
        comparedFields: ['kickoffMinutes', 'division'],
      },
      corpusRegistry()
    );
    expect(oneSided.rows[0].rowClass).toBe(EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL);
    expect(oneSided.rows[0].oneSidedFields).toEqual(['division']);
    const oneSidedImpact = analyseImportImpact({
      subject: 'accepting a row that carries a value we do not hold',
      resolution: oneSided,
      standing: corpusQuery().standing.map((fixture) =>
        fixture.fixtureId === ours.fixtureId ? { ...fixture, division: null } : fixture
      ),
      query: { acceptedRowIds: [oneSided.rows[0].rowId] },
      graph: corpusGraph(),
      timingTable: corpusTiming(),
    });
    const oneSidedFinding = oneSidedImpact.findings.find(
      (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_PROJECTED
    );
    expect(oneSidedFinding).toBeDefined();
    expect(oneSidedFinding.message).not.toMatch(/already agree/);
    expect(detailList(oneSidedFinding.details, 'oneSidedRowIds')).toEqual([oneSided.rows[0].rowId]);
    expect(oneSidedFinding.details.agreeingRowIds).toEqual([]);

    // **The implementation that would pass this wrongly**: one clause for every
    // unmoved row. The three runs above put their row in three different
    // buckets, and each asserts the other two are empty, so a message with a
    // single bucket cannot satisfy all three.
    expect(scoped.details.outOfScopeRowIds).not.toEqual(recordedFinding.details.outOfScopeRowIds);
    expect(recordedFinding.details.unprojectedRowIds).not.toEqual(
      oneSidedFinding.details.unprojectedRowIds
    );
  });

  it('4 — a surface with no external name and one the graph lacks are two lists', () => {
    const orphan = season2026SurfaceId('Brookside Park', 'Upper 1');
    const ghost = 'alder-park/pitch-9';
    const ghostRegistry = buildExternalMappingRegistry(
      {
        registryId: 'ghost',
        label: 'a record naming ground the graph does not have',
        party: 'external seeding league',
        records: [
          {
            id: 'ghost-pitch',
            kind: EXTERNAL_MAPPING_KIND.VENUE,
            externalLabel: 'Alder Park (Pitch 9)',
            venueId: season2026VenueId('Alder Park'),
            surfaceId: ghost,
            subjectId: null,
            provenance: 'constructed for tests/externalFixtureImport.test.js',
          },
        ],
      },
      { graph: corpusGraph() }
    );

    /**
     * @param {import('@squadlogic/core/externalImport/types.js').ExternalMappingRegistry} registry
     * @param {string[]} surfaceIds
     */
    const exportFor = (registry, surfaceIds) =>
      buildAvoidWindows({
        query: {
          subject: 'two causes, two lists',
          documentId: 'two-lists',
          generatedFor: 'external seeding league',
          dates: ['2026-08-22'],
          surfaceIds,
          excludeFixtureIds: [],
        },
        registry,
        standing: toSeason2026StandingFixtures(corpusGames()),
        graph: corpusGraph(),
      });

    // A surface no record claims: a mapping record has to be **written**.
    const unnamed = exportFor(corpusRegistry(), [orphan]);
    expect(unnamed.unmappedSurfaceIds).toEqual([orphan]);
    expect(unnamed.unknownSurfaceIds).toEqual([]);
    expect(unnamed.ambiguousSurfaceIds).toEqual([]);
    expect(unnamed.excludedSurfaceIds).toEqual([orphan]);

    // A surface a record already claims, which the facility graph does not
    // hold: writing another record would change nothing.
    const unknown = exportFor(ghostRegistry, [ghost]);
    expect(unknown.unmappedSurfaceIds).toEqual([]);
    expect(unknown.unknownSurfaceIds).toEqual([ghost]);
    expect(unknown.ambiguousSurfaceIds).toEqual([]);
    expect(unknown.excludedSurfaceIds).toEqual([ghost]);
    expect(codesOf(unknown.findings)).toContain(
      EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_SURFACE_UNKNOWN
    );

    // **The implementation that would pass this wrongly**: one list for both.
    // The two runs above disagree about which list holds their surface, so a
    // single list cannot be right about both.
    expect(unnamed.unmappedSurfaceIds).not.toEqual(unknown.unmappedSurfaceIds);
    expect(unnamed.unknownSurfaceIds).not.toEqual(unknown.unknownSurfaceIds);
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
