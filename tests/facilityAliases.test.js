/**
 * Tests for the alias layer (`facility/aliases.js`, Phase 8.3): the published
 * field name as a display layer over surface ids.
 *
 * Both decoder rings are read from the corpus at test time and every figure
 * — 27 codes, 20 shared, 12 disagreements as 11 + 1 — is derived, then
 * compared with the loader's own `compareDecoderRings()` so there is one
 * producer of the comparison and this file proves the two agree rather than
 * restating a number.
 *
 * The wrong-ground block is the acceptance test the plan asks for: a check
 * that reasons over the published name is shown to miss a real clash that the
 * surface-keyed check finds, and its positive control re-points the alias and
 * watches the clash go.
 */

import { describe, it, expect } from 'vitest';

import {
  DECODER_DISAGREEMENT_KIND,
  loadFacilityGeometry,
  loadSeason2026,
  loadSeason2026Practice,
} from '@squadlogic/core/fixtures/index.js';

import {
  ALIAS_GROUND_AGREEMENT,
  ALIAS_LABEL_AGREEMENT,
  FACILITY_REASON,
  FACILITY_REASON_SEVERITY,
  FACILITY_SEVERITY,
  FieldAliasMapInputSchema,
  PRACTICE_SURFACE_RESOLUTION,
  SEASON_2026_ALIAS_RINGS,
  buildFieldAliasMap,
  buildSeason2026PracticeFacilityGraph,
  buildSeason2026VenueComplexMap,
  findFacilityConflicts,
  lookupFieldAlias,
  season2026PracticeSurfaceId,
  season2026SurfaceId,
  season2026VenueId,
  surfacesOfAlias,
  toSeason2026AliasRings,
} from '@squadlogic/core/facility/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus, loaded once                                                         */
/* -------------------------------------------------------------------------- */

const geometry = loadFacilityGeometry();
const season = loadSeason2026();
const practice = loadSeason2026Practice({ season });
const graph = buildSeason2026PracticeFacilityGraph(geometry);
const complexes = buildSeason2026VenueComplexMap();
const rings = toSeason2026AliasRings(practice.fieldAliases, practice.fieldCodeNames);
const map = buildFieldAliasMap(graph, complexes, rings);

const PRACTICE = SEASON_2026_ALIAS_RINGS.PRACTICE_SHEET;
const FIELDS = SEASON_2026_ALIAS_RINGS.FIELDS_SHEET;
const R = PRACTICE_SURFACE_RESOLUTION;

const sid = (venue, field) => season2026SurfaceId(venue, field);
const codesOf = (findings) => findings.map((f) => f.code);
const candidateOf = (displayName, ring) =>
  map.aliases[displayName].candidates.find((c) => c.ring === ring);

const booking = (id, surfaceId, date, startMinutes, endMinutes) => ({
  id,
  surfaceId,
  date,
  startMinutes,
  endMinutes,
  format: null,
  label: id,
});

/* -------------------------------------------------------------------------- */
/* Guard                                                                       */
/* -------------------------------------------------------------------------- */

describe('alias layer :: corpus guard', () => {
  it('is built from both real rings, not an empty shell', () => {
    expect(map.rings).toEqual([PRACTICE, FIELDS]);
    expect(map.stats.entryCount).toBe(
      practice.fieldAliases.length + practice.fieldCodeNames.length
    );
    expect(map.stats.entryCount).toBe(47);
    expect(map.stats.aliasCount).toBe(27);
    expect(map.displayNames).toHaveLength(27);
    expect(map.stats.sharedCount).toBe(20);
    expect(map.stats.candidateCount).toBe(47);
    expect(map.stats.resolvedCandidateCount).toBeGreaterThan(30);
    expect(map.stats.unresolvedCandidateCount).toBeGreaterThan(0);
    expect(Object.isFrozen(map.aliases)).toBe(true);
  });

  it('re-derives the ring comparison and agrees with the loader: 12 = 11 label conflicts + 1 blank', () => {
    const loader = practice.decoderRings;
    expect(loader.disagreements).toHaveLength(12);
    expect(map.stats.disagreementCount).toBe(loader.disagreements.length);
    expect(map.stats.labelConflictCount).toBe(
      loader.disagreements.filter((d) => d.kind === DECODER_DISAGREEMENT_KIND.LABEL_CONFLICT).length
    );
    expect(map.stats.blankVsLabelCount).toBe(
      loader.disagreements.filter((d) => d.kind === DECODER_DISAGREEMENT_KIND.BLANK_VS_LABEL).length
    );
    expect(map.stats.labelConflictCount).toBe(11);
    expect(map.stats.blankVsLabelCount).toBe(1);
    // Code by code, the same codes with the same kind.
    const derived = map.displayNames
      .filter((name) => map.aliases[name].labelAgreement !== ALIAS_LABEL_AGREEMENT.AGREE)
      .filter((name) => map.aliases[name].labelAgreement !== ALIAS_LABEL_AGREEMENT.SINGLE_RING)
      .map((name) => `${name}:${map.aliases[name].labelAgreement}`)
      .sort();
    expect(derived).toEqual(loader.disagreements.map((d) => `${d.code}:${d.kind}`).sort());
    const disagreeFindings = map.findings.filter(
      (f) => f.code === FACILITY_REASON.ALIAS_RINGS_DISAGREE
    );
    expect(disagreeFindings).toHaveLength(12);
    expect(map.stats.sharedCount).toBe(loader.shared.length);
  });

  it('registers a severity for every alias code', () => {
    const aliasCodes = Object.values(FACILITY_REASON).filter((code) => code.startsWith('ALIAS_'));
    expect(aliasCodes.length).toBe(9);
    for (const code of aliasCodes) {
      expect(Object.values(FACILITY_SEVERITY)).toContain(FACILITY_REASON_SEVERITY[code]);
    }
    expect(FACILITY_REASON_SEVERITY[FACILITY_REASON.ALIAS_UNKNOWN]).toBe(
      FACILITY_SEVERITY.BLOCKING
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Following neither ring                                                      */
/* -------------------------------------------------------------------------- */

describe('alias layer :: carries every ring, follows none', () => {
  it('holds "7v7 Field 1" as Cedarbrook on one ring and an unresolved, uncertain Larkfield label on the other', () => {
    const alias = map.aliases['7v7 Field 1'];
    expect(alias.labelAgreement).toBe(ALIAS_LABEL_AGREEMENT.LABEL_CONFLICT);
    expect(alias.groundAgreement).toBe(ALIAS_GROUND_AGREEMENT.UNDECIDABLE);
    expect(candidateOf('7v7 Field 1', PRACTICE)).toMatchObject({
      label: 'Cedarbrook Park Field 1',
      resolution: R.RESOLVED,
      surfaceIds: [sid('Cedarbrook Park', 'Field 1')],
    });
    expect(candidateOf('7v7 Field 1', FIELDS)).toMatchObject({
      label: 'Larkfield Green Field 2?',
      uncertain: true,
      resolution: R.SURFACE_UNKNOWN,
      venueIds: [season2026VenueId('Larkfield Green')],
      surfaceIds: [],
    });
    const named = map.findings.filter((f) => f.details.displayName === '7v7 Field 1');
    expect(codesOf(named).sort()).toEqual([
      FACILITY_REASON.ALIAS_RINGS_DISAGREE,
      FACILITY_REASON.ALIAS_SOURCE_UNCERTAIN,
      FACILITY_REASON.ALIAS_SURFACE_UNKNOWN,
    ]);
    const ground = surfacesOfAlias(map, '7v7 Field 1');
    expect(ground.surfaces).toEqual([
      { surfaceId: sid('Cedarbrook Park', 'Field 1'), rings: [PRACTICE] },
    ]);
    // The unresolved candidate is counted, so a check over `surfaces` cannot
    // call itself complete.
    expect(ground.unresolvedCandidates).toBe(1);
  });

  it('resolves the practice spelling "Maplewood" to the complex and breaks no tie by ring', () => {
    // Field 1 exists on both halves: the practice candidate carries both and
    // says so; the fields candidate names the back explicitly. Neither is
    // read through the other.
    const junior1 = map.aliases['Junior Field 1'];
    expect(candidateOf('Junior Field 1', PRACTICE)).toMatchObject({
      venue: 'Maplewood',
      resolution: R.AMBIGUOUS,
      venueIds: [season2026VenueId('Maplewood Back'), season2026VenueId('Maplewood Front')],
      surfaceIds: [sid('Maplewood Back', 'Field 1'), sid('Maplewood Front', 'Field 1')],
    });
    expect(candidateOf('Junior Field 1', FIELDS)).toMatchObject({
      venue: 'Maplewood Back',
      resolution: R.RESOLVED,
      surfaceIds: [sid('Maplewood Back', 'Field 1')],
    });
    expect(junior1.groundAgreement).toBe(ALIAS_GROUND_AGREEMENT.DIFFERENT);
    expect(junior1.labelAgreement).toBe(ALIAS_LABEL_AGREEMENT.LABEL_CONFLICT);
    expect(surfacesOfAlias(map, 'Junior Field 1').surfaces).toEqual([
      { surfaceId: sid('Maplewood Back', 'Field 1'), rings: [PRACTICE, FIELDS] },
      { surfaceId: sid('Maplewood Front', 'Field 1'), rings: [PRACTICE] },
    ]);
    expect(
      map.findings.filter((f) => f.code === FACILITY_REASON.ALIAS_SURFACE_AMBIGUOUS)
    ).toHaveLength(1);

    // Field 2-7 exist on the back only, so structure alone resolves them — and
    // the labels still disagree, exactly as the loader says they do.
    for (const n of [2, 3, 4, 5, 6, 7]) {
      const alias = map.aliases[`Junior Field ${n}`];
      expect(alias.labelAgreement).toBe(ALIAS_LABEL_AGREEMENT.LABEL_CONFLICT);
      expect(alias.groundAgreement).toBe(ALIAS_GROUND_AGREEMENT.SAME);
      expect(alias.surfaceIds).toEqual([sid('Maplewood Back', `Field ${n}`)]);
    }
  });

  it('places the eight Maplewood aliases at the complex, venue-level, on the practice ring', () => {
    const maplewood = practice.fieldAliases.filter((row) => row.venue === 'Maplewood');
    expect(maplewood).toHaveLength(8);
    for (const row of maplewood) {
      expect(candidateOf(row.displayName, PRACTICE).venueIds).toEqual([
        season2026VenueId('Maplewood Back'),
        season2026VenueId('Maplewood Front'),
      ]);
    }
    // ... and no venue in the graph is spelled `Maplewood`: no third spelling.
    expect(graph.venueIds.map((id) => graph.venues[id].name)).not.toContain('Maplewood');
  });

  it('keeps "Rookerie Park" as a venue the graph does not hold rather than bridging the spelling', () => {
    for (const code of ['9v9 Field 1', '9v9 Field 2']) {
      expect(candidateOf(code, FIELDS)).toMatchObject({
        venue: 'Rookerie Park',
        resolution: R.VENUE_UNKNOWN,
        surfaceIds: [],
      });
      expect(candidateOf(code, PRACTICE).resolution).toBe(R.RESOLVED);
    }
    expect(candidateOf('9v9 Field 1', PRACTICE).surfaceIds).toEqual([
      season2026PracticeSurfaceId('Rookery Park', 'Turf Field 2', 'A'),
    ]);
    expect(map.findings.filter((f) => f.code === FACILITY_REASON.ALIAS_VENUE_UNKNOWN)).toHaveLength(
      2
    );
  });

  it('reports the blank code, the venue-only codes and the venue-half named as a field', () => {
    expect(candidateOf('11v11 Field 2', PRACTICE).resolution).toBe('blank');
    expect(map.aliases['11v11 Field 2'].labelAgreement).toBe(ALIAS_LABEL_AGREEMENT.BLANK_VS_LABEL);
    // `11v11 Field 1` has a label and no venue on the practice sheet: blank ground.
    expect(candidateOf('11v11 Field 1', PRACTICE).resolution).toBe('blank');
    expect(map.findings.filter((f) => f.code === FACILITY_REASON.ALIAS_BLANK)).toHaveLength(2);
    const venueOnly = map.findings.filter((f) => f.code === FACILITY_REASON.ALIAS_VENUE_ONLY);
    expect(venueOnly.map((f) => f.details.displayName).sort()).toEqual([
      '11v11 Field 3',
      '7v7 Field 4',
      '7v7 Field 5',
      '9v9 Field 5',
      '9v9 Field 6',
    ]);
    // `7v7 Field 2` -> `Maplewood / Front`: a venue half written as a field.
    expect(candidateOf('7v7 Field 2', PRACTICE).resolution).toBe(R.SURFACE_UNKNOWN);
    expect(candidateOf('7v7 Field 2', FIELDS).surfaceIds).toEqual([
      sid('Maplewood Front', 'Field 1'),
    ]);
  });

  it('answers an unknown published name with a blocking finding, not an empty success', () => {
    const missing = lookupFieldAlias(map, 'Senior Field 9');
    expect(missing.alias).toBeNull();
    expect(codesOf(missing.findings)).toEqual([FACILITY_REASON.ALIAS_UNKNOWN]);
    expect(missing.findings[0].severity).toBe(FACILITY_SEVERITY.BLOCKING);
    expect(surfacesOfAlias(map, 'Senior Field 9').surfaces).toEqual([]);
    expect(lookupFieldAlias(map, 'constructor').alias).toBeNull();
    expect(lookupFieldAlias(map, 'Junior Field 1').alias).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The wrong-ground test                                                       */
/* -------------------------------------------------------------------------- */

describe('alias layer :: a check over the published name is checking the wrong ground', () => {
  const DATE = '2026-09-15';
  const backField2 = sid('Maplewood Back', 'Field 2');

  /**
   * The check this test exists to condemn: keyed on the label each booking
   * was made under. It is the shape a name-keyed scheduler has.
   *
   * @param {Array<{ id: string, publishedName: string, startMinutes: number, endMinutes: number }>} rows
   */
  function nameKeyedClashes(rows) {
    const clashes = [];
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        const overlap = a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
        if (overlap && a.publishedName === b.publishedName) clashes.push([a.id, b.id]);
      }
    }
    return clashes;
  }

  /** The same rows, placed on ground through the alias layer. */
  function surfaceKeyedClashes(aliasMap, rows) {
    const bookings = rows.flatMap((row) => {
      const ground = row.surfaceId
        ? [{ surfaceId: row.surfaceId, rings: [] }]
        : surfacesOfAlias(aliasMap, row.publishedName).surfaces;
      return ground.map(({ surfaceId }) =>
        booking(`${row.id}@${surfaceId}`, surfaceId, DATE, row.startMinutes, row.endMinutes)
      );
    });
    const scan = findFacilityConflicts(graph, bookings);
    expect(scan.meta.bookingPairsCompared).toBeGreaterThan(0);
    return scan.conflicts.map((f) => [f.details.bookingAId, f.details.bookingBId]);
  }

  it('misses a practice booked by published name against a game on the same ground', () => {
    const rows = [
      {
        id: 'practice',
        publishedName: 'Junior Field 2',
        startMinutes: 16 * 60,
        endMinutes: 17 * 60,
      },
      {
        id: 'game',
        publishedName: 'Field 2',
        surfaceId: backField2,
        startMinutes: 16 * 60,
        endMinutes: 17 * 60,
      },
    ];
    // The name-keyed check: "Junior Field 2" is not "Field 2", so no clash.
    expect(nameKeyedClashes(rows)).toEqual([]);
    // The ground: both stand on Maplewood Back / Field 2 at four o'clock.
    expect(surfaceKeyedClashes(map, rows)).toEqual([
      [`practice@${backField2}`, `game@${backField2}`],
    ]);
  });

  it('calls two different grounds a clash because they share a published name', () => {
    // Two rings, one code, two surfaces. Booked at once under the same name.
    const rows = [
      { id: 'a', publishedName: '7v7 Field 1', startMinutes: 16 * 60, endMinutes: 17 * 60 },
      { id: 'b', publishedName: '7v7 Field 1', startMinutes: 16 * 60, endMinutes: 17 * 60 },
    ];
    expect(nameKeyedClashes(rows)).toEqual([['a', 'b']]);
    // Through the layer, each lands on every candidate surface and the clash
    // is reported *per surface*, naming the ground — which is what an operator
    // needs, and what the name can never tell them.
    const clashes = surfaceKeyedClashes(map, rows);
    expect(clashes).toEqual([
      [`a@${sid('Cedarbrook Park', 'Field 1')}`, `b@${sid('Cedarbrook Park', 'Field 1')}`],
    ]);
    // A ring-constructed twin: the same code on two resolvable grounds.
    const twin = buildFieldAliasMap(graph, complexes, {
      rings: [
        {
          ring: 'x',
          entries: [
            { displayName: 'Q', venue: 'Alder Park', field: 'Pitch 2A', label: 'Alder 2A' },
          ],
        },
        {
          ring: 'y',
          entries: [
            { displayName: 'Q', venue: 'Alder Park', field: 'Pitch 3A', label: 'Alder 3A' },
          ],
        },
      ],
    });
    expect(twin.aliases.Q.groundAgreement).toBe(ALIAS_GROUND_AGREEMENT.DIFFERENT);
    const twinRows = [
      { id: 'a', publishedName: 'Q', startMinutes: 16 * 60, endMinutes: 17 * 60 },
      { id: 'b', publishedName: 'Q', startMinutes: 16 * 60, endMinutes: 17 * 60 },
    ];
    expect(nameKeyedClashes(twinRows)).toEqual([['a', 'b']]);
    const perSurface = surfaceKeyedClashes(twin, twinRows);
    expect(perSurface).toHaveLength(2);
    expect(perSurface.map(([a]) => String(a).split('@')[1]).sort()).toEqual([
      season2026PracticeSurfaceId('Alder Park', 'Pitch 2A', null),
      season2026PracticeSurfaceId('Alder Park', 'Pitch 3A', null),
    ]);
  });

  it('proves the surface check reads the alias resolution: re-point the alias and the clash goes (positive control)', () => {
    const rows = [
      {
        id: 'practice',
        publishedName: 'Junior Field 2',
        startMinutes: 16 * 60,
        endMinutes: 17 * 60,
      },
      {
        id: 'game',
        publishedName: 'Field 2',
        surfaceId: backField2,
        startMinutes: 16 * 60,
        endMinutes: 17 * 60,
      },
    ];
    const rePointed = buildFieldAliasMap(graph, complexes, {
      rings: [
        {
          ring: PRACTICE,
          entries: [
            {
              displayName: 'Junior Field 2',
              venue: 'Maplewood',
              field: 'Field 3',
              label: 'Maplewood Field 3',
            },
          ],
        },
      ],
    });
    expect(surfacesOfAlias(rePointed, 'Junior Field 2').surfaces).toEqual([
      { surfaceId: sid('Maplewood Back', 'Field 3'), rings: [PRACTICE] },
    ]);
    expect(surfaceKeyedClashes(rePointed, rows)).toEqual([]);
    // ... and the name-keyed check is unmoved by any of it, which is the point.
    expect(nameKeyedClashes(rows)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Controls on the builder                                                     */
/* -------------------------------------------------------------------------- */

describe('alias layer :: the builder refuses what it must and reports what it reads', () => {
  it('reads the first occurrence of a code listed twice in one ring, and reports the second', () => {
    const doubled = buildFieldAliasMap(graph, complexes, {
      rings: [
        {
          ring: 'r',
          entries: [
            { displayName: 'Z', venue: 'Alder Park', field: 'Pitch 2A', label: 'first' },
            { displayName: 'Z', venue: 'Alder Park', field: 'Pitch 3A', label: 'second' },
          ],
        },
      ],
    });
    expect(doubled.aliases.Z.candidates).toHaveLength(1);
    expect(doubled.aliases.Z.candidates[0].label).toBe('first');
    expect(codesOf(doubled.findings)).toEqual([FACILITY_REASON.ALIAS_CODE_DUPLICATED]);
    expect(doubled.stats.entryCount).toBe(2);
    expect(doubled.stats.candidateCount).toBe(1);
  });

  it('carries a published name that is also a prototype member', () => {
    const entry = (displayName) => ({
      displayName,
      venue: 'Alder Park',
      field: 'Pitch 2A',
      label: 'l',
    });
    const built = buildFieldAliasMap(graph, complexes, {
      rings: [
        { ring: 'r', entries: [entry('constructor'), entry('__proto__'), entry('hasOwnProperty')] },
      ],
    });
    expect(built.stats.aliasCount).toBe(3);
    expect(built.displayNames).toEqual(['__proto__', 'constructor', 'hasOwnProperty']);
    expect(lookupFieldAlias(built, 'constructor').alias.surfaceIds).toEqual([
      season2026PracticeSurfaceId('Alder Park', 'Pitch 2A', null),
    ]);
    expect(lookupFieldAlias(map, 'toString').alias).toBeNull();
  });

  it('refuses a ring given twice, an unknown key, and no rings at all', () => {
    const entry = { displayName: 'Z', venue: 'Alder Park', field: 'Pitch 2A', label: 'l' };
    expect(() =>
      buildFieldAliasMap(graph, complexes, {
        rings: [
          { ring: 'r', entries: [entry] },
          { ring: 'r', entries: [entry] },
        ],
      })
    ).toThrow(/given twice/);
    expect(
      FieldAliasMapInputSchema.safeParse({
        rings: [{ ring: 'r', entries: [{ ...entry, extra: 1 }] }],
      }).success
    ).toBe(false);
    expect(FieldAliasMapInputSchema.safeParse({ rings: [] }).success).toBe(false);
    expect(FieldAliasMapInputSchema.safeParse(rings).success).toBe(true);
  });

  it('reads a blank cell on the fields ring as an absence, as the practice ring does', () => {
    // Round 2, finding 3. `parseFieldCodeNames()` writes `trim(cell)` where
    // `parsePracticeFieldAliases()` writes `orNull(cell)`, so an empty `venue`
    // or `actual_label` reached the adapter as `''`. Passed through, it threw
    // out of `buildFieldAliasMap()` (`AliasRingEntrySchema` is non-empty or
    // null) and took the whole map with it -- the ring with the stricter parser
    // was the one that could not be read, on a shape the practice ring reports
    // as `ALIAS_BLANK`.
    const fieldsRow = (over) => ({
      rowIndex: 0,
      codeName: 'Blank Cell',
      actualLabel: 'Alder Park Pitch 2A',
      venue: 'Alder Park',
      remainder: 'Pitch 2A',
      uncertain: false,
      confirmed: null,
      usedFor: null,
      ...over,
    });

    for (const { column, over } of [
      { column: 'venue', over: { venue: '' } },
      { column: 'actual_label', over: { actualLabel: '' } },
    ]) {
      const built = buildFieldAliasMap(
        graph,
        complexes,
        toSeason2026AliasRings([], [fieldsRow(over)])
      );
      const candidate = built.aliases['Blank Cell'].candidates[0];
      expect(candidate.ring, column).toBe(FIELDS);
      expect(candidate.surfaceIds, column).toEqual([]);
      expect(codesOf(built.findings), column).toContain(FACILITY_REASON.ALIAS_BLANK);
      // The map still builds, and the blank row is one unresolved candidate
      // rather than a thrown parse.
      expect(built.stats.aliasCount, column).toBe(1);
      expect(built.stats.unresolvedCandidateCount, column).toBe(1);
    }

    // The sibling's answer on the same shape, so "as the practice ring does" is
    // asserted rather than asserted about.
    const practiceRow = {
      rowIndex: 0,
      displayName: 'Blank Cell',
      actualLabel: 'Alder Park Pitch 2A',
      venue: null,
      field: 'Pitch 2A',
      subunit: null,
    };
    const sibling = buildFieldAliasMap(graph, complexes, toSeason2026AliasRings([practiceRow], []));
    expect(codesOf(sibling.findings)).toContain(FACILITY_REASON.ALIAS_BLANK);
    expect(sibling.aliases['Blank Cell'].candidates[0].surfaceIds).toEqual([]);

    // Positive control: the empty string reaching the schema is still refused,
    // so the fix is the adapter's mapping and not a loosened schema.
    expect(
      FieldAliasMapInputSchema.safeParse({
        rings: [{ ring: FIELDS, entries: [{ displayName: 'Blank Cell', venue: '' }] }],
      }).success
    ).toBe(false);
    expect(() =>
      buildFieldAliasMap(graph, complexes, {
        rings: [{ ring: FIELDS, entries: [{ displayName: 'Blank Cell', venue: '' }] }],
      })
    ).toThrow();
  });

  it('does not mutate its input and returns a frozen map', () => {
    const input = toSeason2026AliasRings(practice.fieldAliases, practice.fieldCodeNames);
    const before = JSON.stringify(input);
    const built = buildFieldAliasMap(graph, complexes, input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.aliases['Junior Field 1'].candidates)).toBe(true);
    expect(Object.isFrozen(built.findings)).toBe(true);
  });
});
