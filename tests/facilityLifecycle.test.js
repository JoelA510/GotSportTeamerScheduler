/**
 * **Effective dating, and the finding that says the question had no date.**
 *
 * `FACILITY_LIFECYCLE_UNJUDGED` cannot fire on the season-2026 corpus: nothing
 * in it carries an effective window, so `stats.datedNodeCount` is 0 and the
 * finding is correctly silent. That silence is not evidence, which is why the
 * count is published either way and why every assertion below runs against a
 * **constructed** graph, in both directions -- dated and undated, dated and
 * judged.
 */

import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FACILITY_REASON,
  buildFacilityGraph,
  checkBooking,
  checkEquipment,
  checkFacilityLifecycle,
  checkFieldEligibility,
  checkLining,
  checkOccupancy,
  checkSizeEligibility,
  findFacilityConflicts,
  occupancyFootprint,
  surfacesConflict,
  isDatedNode,
  isLiveOn,
  retiredOn,
} from '@squadlogic/core/facility/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { buildSeason2026PracticeFacilityGraph } from '@squadlogic/core/facility/index.js';
import { loadFacilityGeometry } from '@squadlogic/core/fixtures/index.js';

/** A one-venue, one-surface graph; `extra` dates the surface. */
const graphWith = (surfaceExtra = {}, venueExtra = {}) =>
  buildFacilityGraph({
    venues: [{ id: 'v1', name: 'Alder', ...venueExtra }],
    surfaces: [
      { id: 's1', venueId: 'v1', name: 'Pitch 1', sizes: ['9v9'], lined: ['9v9'], ...surfaceExtra },
    ],
  });

const lifecycleCodes = (result) =>
  result.findings
    .map((finding) => finding.code)
    .filter(
      (code) => code === FACILITY_REASON.LIFECYCLE_UNJUDGED || code === FACILITY_REASON.NODE_RETIRED
    );

describe('facility lifecycle :: the window is read one way', () => {
  it('treats null bounds as always, and both bounds as inclusive', () => {
    expect(isLiveOn({ effectiveFrom: null, effectiveTo: null }, '2026-09-01')).toBe(true);
    // Inclusive on both ends -- the boundary days are live, the days either
    // side are not. Asserted rather than assumed, because "inclusive" is the
    // one convention this repo uses and a half-open window here would disagree
    // with `blackout_from`/`blackout_until` on the tables it mirrors.
    const window = { effectiveFrom: '2026-03-01', effectiveTo: '2026-06-30' };
    expect(isLiveOn(window, '2026-03-01')).toBe(true);
    expect(isLiveOn(window, '2026-06-30')).toBe(true);
    expect(isLiveOn(window, '2026-02-28')).toBe(false);
    expect(isLiveOn(window, '2026-07-01')).toBe(false);
    // One-sided windows.
    expect(isLiveOn({ effectiveFrom: '2026-03-01', effectiveTo: null }, '2030-01-01')).toBe(true);
    expect(isLiveOn({ effectiveFrom: null, effectiveTo: '2026-06-30' }, '2026-07-01')).toBe(false);
  });

  it('counts a node as dated when either bound is set', () => {
    expect(isDatedNode({ effectiveFrom: null, effectiveTo: null })).toBe(false);
    expect(isDatedNode({ effectiveFrom: '2026-01-01', effectiveTo: null })).toBe(true);
    expect(isDatedNode({ effectiveFrom: null, effectiveTo: '2026-01-01' })).toBe(true);
  });

  it('refuses a window that ends before it starts', () => {
    // A node live on no date would answer "this ground does not exist" for
    // every query, which is the shape incident 3 was. The builder throws on it
    // like every other structural defect.
    expect(() => graphWith({ effectiveFrom: '2026-06-30', effectiveTo: '2026-03-01' })).toThrow(
      /ends before it starts/
    );
    expect(() => graphWith({}, { effectiveFrom: '2026-06-30', effectiveTo: '2026-03-01' })).toThrow(
      /venue "v1"/
    );
    // ... and an ordered window, and a same-day window, are both accepted, so
    // the assertion above is about the inversion and not about dating at all.
    expect(() =>
      graphWith({ effectiveFrom: '2026-03-01', effectiveTo: '2026-06-30' })
    ).not.toThrow();
    expect(() =>
      graphWith({ effectiveFrom: '2026-03-01', effectiveTo: '2026-03-01' })
    ).not.toThrow();
  });
});

describe('facility lifecycle :: UNJUDGED fires on the dated graph and only there', () => {
  it('is silent on an undated graph, and still publishes the count', () => {
    // **The direction that makes the finding trustworthy.** Without this, a
    // check that never fired would look identical to one that fires correctly.
    const undated = graphWith();
    expect(undated.stats.datedNodeCount).toBe(0);
    const result = checkFieldEligibility(undated, { surfaceId: 's1', format: '9v9' });
    expect(lifecycleCodes(result)).toEqual([]);
    // Published at zero: "the universe was empty", not "checked and clean".
    expect(result.meta.datedNodeCount).toBe(0);
  });

  it('fires on a dated graph when the query names no date', () => {
    const dated = graphWith({ effectiveTo: '2026-06-30' });
    expect(dated.stats.datedNodeCount).toBe(1);
    const result = checkFieldEligibility(dated, { surfaceId: 's1', format: '9v9' });
    expect(lifecycleCodes(result)).toEqual([FACILITY_REASON.LIFECYCLE_UNJUDGED]);
    expect(result.meta.datedNodeCount).toBe(1);
    expect(
      result.findings.find((f) => f.code === FACILITY_REASON.LIFECYCLE_UNJUDGED).details
    ).toMatchObject({ datedNodeCount: 1 });
  });

  it('stops firing once the query names a date, and judges instead', () => {
    const dated = graphWith({ effectiveTo: '2026-06-30' });
    const inside = checkFieldEligibility(dated, {
      surfaceId: 's1',
      format: '9v9',
      date: '2026-05-01',
    });
    expect(lifecycleCodes(inside)).toEqual([]);
    // **Two, not one: the surface and its venue.** This asserted 1 while the
    // counter was reporting work that had not been done -- the code-review
    // finding. The number now means "nodes actually examined", so a
    // surface-scoped query says 2 and an unknown surface says 0.
    expect(inside.meta.lifecycleNodesJudged).toBe(2);

    const outside = checkFieldEligibility(dated, {
      surfaceId: 's1',
      format: '9v9',
      date: '2026-09-01',
    });
    expect(lifecycleCodes(outside)).toEqual([FACILITY_REASON.NODE_RETIRED]);
    expect(outside.status).toBe('rejected');
  });

  it('judges the whole estate when no surface is named, and counts what it judged', () => {
    // **The finding this pins.** The counter used to be set to the graph's
    // dated count while every judgement sat behind `surfaceId !== null`, so a
    // whole-graph query on an estate where every surface was retired came back
    // `allowed` with zero findings and a counter claiming two nodes examined.
    const dated = buildFacilityGraph({
      venues: [{ id: 'v1', name: 'V' }],
      surfaces: [
        { id: 's1', venueId: 'v1', name: 'A', effectiveTo: '2026-06-30' },
        { id: 's2', venueId: 'v1', name: 'B', effectiveTo: '2026-06-30' },
      ],
    });
    const result = checkFacilityLifecycle(dated, { asOf: '2026-09-01' });
    expect(result.findings.map((f) => f.details.id).sort()).toEqual(['s1', 's2']);
    expect(result.status).toBe('rejected');
    // One venue plus two surfaces really were looked at.
    expect(result.meta.lifecycleNodesJudged).toBe(3);

    // Inside the window the same query is clean, and still counts three -- so
    // the count is "examined", not "found wanting".
    const live = checkFacilityLifecycle(dated, { asOf: '2026-05-01' });
    expect(live.findings).toEqual([]);
    expect(live.meta.lifecycleNodesJudged).toBe(3);
  });

  it('claims no work for a surface it cannot find', () => {
    // An unknown surface is SURFACE_UNKNOWN's business. This module judges
    // nothing and says so, rather than reporting 1 node judged.
    const dated = graphWith({ effectiveTo: '2026-06-30' });
    const result = checkFacilityLifecycle(dated, { asOf: '2026-09-01', surfaceId: 'nope' });
    expect(result.findings).toEqual([]);
    expect(result.meta.lifecycleNodesJudged).toBe(0);
  });

  it('reports a live surface at a closed venue', () => {
    // A surface with no window of its own sits inside a venue that may have
    // one. A check that looked only at the surface would report a live pitch
    // at a site that shut in June.
    const closedVenue = graphWith({}, { effectiveTo: '2026-06-30' });
    const result = checkFacilityLifecycle(closedVenue, { asOf: '2026-09-01', surfaceId: 's1' });
    expect(lifecycleCodes(result)).toEqual([FACILITY_REASON.NODE_RETIRED]);
    // **The subject is the surface that was asked about; the venue is the
    // cause.** This asserted `{kind:'venue', id:'v1'}` -- the shape the scoped
    // arm used to emit, in which `details.id` meant the node that CLOSED while
    // the whole-graph arm's `details.id` meant the node being JUDGED. The two
    // shapes were pinned side by side in this very file, so the divergence was
    // certified rather than caught: the fourth time in this series a passing
    // test has held a defect in place.
    expect(result.findings[0].details).toMatchObject({
      kind: 'surface',
      id: 's1',
      causeKind: 'venue',
      causeId: 'v1',
      causeEffectiveTo: '2026-06-30',
    });
    // The surface has no window of its own, so the message must not claim one.
    expect(result.findings[0].details.effectiveTo).toBeNull();
    expect(result.findings[0].message).toContain('because venue "v1"');
  });

  it('lists what is retired on a date, from the registries', () => {
    const dated = graphWith({ effectiveTo: '2026-06-30' }, { effectiveTo: '2026-06-30' });
    expect(retiredOn(dated, '2026-05-01')).toEqual({ venueIds: [], surfaceIds: [] });
    expect(retiredOn(dated, '2026-09-01')).toEqual({ venueIds: ['v1'], surfaceIds: ['s1'] });
  });
});

describe('facility lifecycle :: the corpus is undated, and says so', () => {
  it('reports datedNodeCount 0 on the season-2026 graph', () => {
    // The claim the module docstring makes, checked rather than asserted in
    // prose: this is why UNJUDGED has no corpus exercise. If season-2026 ever
    // gains a dated node this fails, and the docstring has to change with it.
    const graph = buildSeason2026PracticeFacilityGraph(loadFacilityGeometry());
    expect(graph.stats.datedNodeCount).toBe(0);
    // ... and the graph is not empty, so the zero is a measurement rather than
    // an artefact of having built nothing.
    expect(graph.surfaceIds.length).toBeGreaterThan(0);
  });
});

describe('facility lifecycle :: a count nobody made is not a count of zero', () => {
  it('reports null from checks that never counted, and a number from the one that does', () => {
    // **The invariant, with no tally in it.** This comment used to say "nine
    // `createMeta()` sites"; the source said ten in one line and eleven in the
    // next; `grep -c` said something else again. Three hand-kept numbers for
    // one enumeration, none of them recomputable, and the fifth miscount in
    // this series. The number was never the claim -- the claim is that a check
    // which did not count publishes `null` and the one that did publishes a
    // number, including 0 when the graph genuinely has none. That is asserted
    // below by calling the checks, so it cannot drift the way a written count
    // does.
    const dated = graphWith({ effectiveTo: '2026-06-30' });

    // An unknown surface never reaches the lifecycle check.
    const unknown = checkBooking(dated, {
      id: 'b1',
      surfaceId: 'not-a-surface',
      date: '2026-05-01',
      startMinutes: 600,
      endMinutes: 700,
    });
    expect(unknown.meta.datedNodeCount).toBeNull();

    // The lifecycle check publishes a real number.
    const counted = checkFacilityLifecycle(dated, { asOf: '2026-05-01', surfaceId: 's1' });
    expect(counted.meta.datedNodeCount).toBe(1);

    // ... and 0 when the graph really has none, which is the ruling's case.
    const undated = checkFieldEligibility(graphWith(), { surfaceId: 's1', format: '9v9' });
    expect(undated.meta.datedNodeCount).toBe(0);

    // **Every producer, derived -- because the fix for three hand-written
    // tallies was a fourth hand-written literal.** The replacement listed four
    // closures and claimed to be *every* exported check that never counts. It
    // was 4 of 7: `occupancyFootprint`, `surfacesConflict` and
    // `findFacilityConflicts` also build a `createMeta()` and were absent. And
    // `expect(nonCounting.length).toBeGreaterThan(3)` over a four-element
    // literal cannot fail -- a guard that reads like a meta-assertion and is
    // arithmetic on a constant.
    //
    // The producer set is now scanned out of the source, and the invocation map
    // is held to it EXACTLY. Adding a producer without deciding whether it
    // counts fails here rather than being quietly left out.
    const booking = {
      id: 'b1',
      surfaceId: 's1',
      date: '2026-05-01',
      startMinutes: 600,
      endMinutes: 700,
    };
    /** Every producer, and what it is expected to publish. */
    const producers = {
      checkSizeEligibility: () => checkSizeEligibility(dated, { surfaceId: 's1', format: '9v9' }),
      checkLining: () => checkLining(dated, { surfaceId: 's1', format: '9v9' }),
      checkEquipment: () =>
        checkEquipment(dated, { surfaceId: 's1', format: '9v9', date: '2026-05-01' }),
      checkOccupancy: () => checkOccupancy(dated, booking, []),
      occupancyFootprint: () => occupancyFootprint(dated, 's1'),
      surfacesConflict: () => surfacesConflict(dated, 's1', 's1'),
      findFacilityConflicts: () => findFacilityConflicts(dated, [booking]),
      // The counting ones, listed so the map is the whole set rather than the
      // half that suits the assertion.
      checkFacilityLifecycle: () => checkFacilityLifecycle(dated, { asOf: '2026-05-01' }),
      checkFieldEligibility: () => checkFieldEligibility(dated, { surfaceId: 's1', format: '9v9' }),
      checkBooking: () => checkBooking(dated, booking),
    };
    const COUNTING = ['checkFacilityLifecycle', 'checkFieldEligibility', 'checkBooking'];

    const source = ['eligibility.js', 'lifecycle.js', 'occupancy.js']
      .map((file) => readFileSync(path.join(REPO_ROOT, 'packages/core/src/facility', file), 'utf8'))
      .join('\n');
    const scanned = [...source.matchAll(/export function (\w+)\([\s\S]*?\n\}/g)]
      .filter((m) => m[0].includes('createMeta()'))
      .map((m) => m[1])
      .sort();
    // The scan found producers at all, and found them in more than one file --
    // a regex that matched nothing would make the equality below assert that
    // the map is empty, which is the vacuous shape this whole exercise is about.
    expect(scanned.length).toBeGreaterThanOrEqual(8);
    expect(scanned).toContain('occupancyFootprint');
    expect(scanned).toContain('checkFacilityLifecycle');
    // Exact, in both directions: a new producer fails, and so does one removed
    // from the source but left in the map.
    expect(Object.keys(producers).sort()).toEqual(scanned);

    for (const [name, run] of Object.entries(producers)) {
      const published = run().meta.datedNodeCount;
      if (COUNTING.includes(name)) {
        expect(published, `${name} should publish a count`).toBeTypeOf('number');
      } else {
        expect(published, `${name} counted nothing and must say so with null`).toBeNull();
      }
    }
  });
});

describe('facility lifecycle :: a surface at a closed site is retired', () => {
  it('propagates a retired venue to its surfaces in every arm', () => {
    // **Finding 12: twin arms, one corrected.** The surface-scoped arm always
    // checked the venue; `retiredOn()` and the whole-graph arm did not, so the
    // same estate gave two answers depending on the entry point.
    const closedSite = buildFacilityGraph({
      venues: [{ id: 'v1', name: 'Closed', effectiveTo: '2026-06-30' }],
      surfaces: [{ id: 's1', venueId: 'v1', name: 'Pitch' }],
    });
    // The surface carries no window of its own.
    expect(closedSite.surfaces.s1.effectiveTo).toBeNull();

    expect(retiredOn(closedSite, '2026-09-01')).toEqual({
      venueIds: ['v1'],
      surfaceIds: ['s1'],
    });
    // The whole-graph arm agrees with the surface-scoped arm.
    const whole = checkFacilityLifecycle(closedSite, { asOf: '2026-09-01' });
    expect(whole.findings.map((f) => f.details.id).sort()).toEqual(['s1', 'v1']);
    // **The scoped arm says the same thing about `s1` as the whole-graph arm
    // does**, field for field. Asserted as an equality rather than as a
    // membership test: `toContain` passed for both the old shape and the new
    // one, which is why the divergence lived through three rounds of fixes to
    // this pair.
    const scoped = checkFacilityLifecycle(closedSite, { asOf: '2026-09-01', surfaceId: 's1' });
    expect(scoped.findings).toHaveLength(1);
    expect(scoped.findings[0].details).toEqual(
      whole.findings.find((f) => f.details.id === 's1').details
    );
    expect(scoped.findings[0].details.causeId).toBe('v1');

    // Inside the window both arms are clean, so the assertions above are about
    // the closure and not about the venue being checked at all.
    expect(retiredOn(closedSite, '2026-05-01')).toEqual({ venueIds: [], surfaceIds: [] });
  });
});

describe('facility lifecycle :: a sub-surface of a retired surface is retired', () => {
  // **Finding 4 of round 2, and the family the venue fix did not finish.**
  // Containment has two edges, not one: surface -> venue, and surface ->
  // parent surface. Round 1 fixed the venue edge in every arm and left the
  // parent edge unchecked, so a half-pitch inside a retired full pitch was
  // reported live. `surfaceIsLiveOn()` now walks the whole `lineage` -- self
  // plus every ancestor -- rather than the surface alone.
  const nested = (extra = {}) =>
    buildFacilityGraph({
      venues: [{ id: 'v1', name: 'Alder' }],
      surfaces: [
        {
          id: 'full',
          venueId: 'v1',
          name: 'Full',
          effectiveTo: '2026-06-30',
          childIds: ['half'],
          ...extra,
        },
        { id: 'half', venueId: 'v1', name: 'Half A', parentId: 'full', childIds: ['quarter'] },
        { id: 'quarter', venueId: 'v1', name: 'Quarter A1', parentId: 'half' },
      ],
    });

  it('propagates a retired parent down the whole lineage, in every arm', () => {
    const graph = nested();
    // The descendants carry no window of their own, so anything that finds
    // them retired did so through the lineage and not through their own dates.
    expect(graph.surfaces.half.effectiveTo).toBeNull();
    expect(graph.surfaces.quarter.effectiveTo).toBeNull();
    // ... and the lineage really is more than one deep, or "walks the lineage"
    // and "checks the surface" are the same assertion.
    expect(graph.surfaces.quarter.lineage).toEqual(['quarter', 'half', 'full']);

    expect(retiredOn(graph, '2026-09-01')).toEqual({
      venueIds: [],
      surfaceIds: ['full', 'half', 'quarter'],
    });

    const whole = checkFacilityLifecycle(graph, { asOf: '2026-09-01' });
    expect(whole.findings.map((f) => f.details.id).sort()).toEqual(['full', 'half', 'quarter']);

    // **The two arms now answer in one shape.** The scoped arm reports the
    // surface that was asked about and names the ancestor as the CAUSE, which
    // is exactly what the whole-graph arm says about the same surface.
    const scoped = checkFacilityLifecycle(graph, { asOf: '2026-09-01', surfaceId: 'quarter' });
    expect(scoped.findings).toHaveLength(1);
    expect(scoped.findings[0].details).toMatchObject({
      kind: 'surface',
      id: 'quarter',
      causeKind: 'surface',
      causeId: 'full',
    });
    const fromWhole = whole.findings.find((f) => f.details.id === 'quarter');
    expect(scoped.findings[0].details).toEqual(fromWhole.details);
  });

  it('leaves the lineage alone inside the window, so the check is about closure', () => {
    // The negative direction. Without it, an arm that reported everything
    // retired always would pass the test above.
    const graph = nested();
    expect(retiredOn(graph, '2026-05-01')).toEqual({ venueIds: [], surfaceIds: [] });
    expect(checkFacilityLifecycle(graph, { asOf: '2026-05-01' }).findings).toEqual([]);
  });

  it('counts every node the scoped arm judged, not a constant', () => {
    // The counter beside the lineage loop said a flat 2 -- the surface and its
    // venue -- while the loop walked the whole lineage. Three nodes judged,
    // two reported. Asserted at two depths so a constant cannot satisfy both.
    const graph = nested();
    const deep = checkFacilityLifecycle(graph, { asOf: '2026-05-01', surfaceId: 'quarter' });
    expect(graph.surfaces.quarter.lineage).toHaveLength(3);
    expect(deep.meta.lifecycleNodesJudged).toBe(4);

    const shallow = checkFacilityLifecycle(graph, { asOf: '2026-05-01', surfaceId: 'full' });
    expect(graph.surfaces.full.lineage).toHaveLength(1);
    expect(shallow.meta.lifecycleNodesJudged).toBe(2);

    // An unknown surface judged nothing, and says zero rather than inventing a
    // depth for a surface it never found.
    const missing = checkFacilityLifecycle(graph, { asOf: '2026-05-01', surfaceId: 'nope' });
    expect(missing.meta.lifecycleNodesJudged).toBe(0);
  });

  it('names the node that closed, not the one being reported', () => {
    // **Round 3 finding 4, and the third time on this same pair of twins.** The
    // whole-graph arm attributed an ancestor's or a venue's retirement to the
    // SURFACE, emitting `surface "quarter" is effective always onward and
    // 2026-09-01 falls outside it` -- a sentence that contradicts itself, with
    // null bounds in `details`. An operator would go hunting for a date on the
    // pitch that does not exist. The scoped twin has always named the ancestor.
    const graph = nested();
    const whole = checkFacilityLifecycle(graph, { asOf: '2026-09-01' });
    const quarter = whole.findings.find((f) => f.details.id === 'quarter');
    expect(quarter).toBeDefined();

    // The surface genuinely has no window of its own, so a message quoting one
    // is quoting nothing.
    expect(quarter.details.effectiveTo).toBeNull();
    expect(quarter.details.causeId).toBe('full');
    expect(quarter.details.causeKind).toBe('surface');
    expect(quarter.details.causeEffectiveTo).toBe('2026-06-30');
    expect(quarter.message).toContain('because surface "full"');
    // ... and it does NOT claim the surface's own window excludes the date.
    expect(quarter.message).not.toContain('always onward and');

    // A surface that closed on its OWN dates is its own cause, and its message
    // is the direct one -- so the fix did not simply reword every finding.
    const full = whole.findings.find((f) => f.details.id === 'full');
    expect(full.details.causeId).toBe('full');
    expect(full.message).toContain('is effective');
    expect(full.message).not.toContain('because');

    // A venue is always its own cause.
    const closedSite = buildFacilityGraph({
      venues: [{ id: 'v1', name: 'Closed', effectiveTo: '2026-06-30' }],
      surfaces: [{ id: 's1', venueId: 'v1', name: 'Pitch' }],
    });
    const siteWide = checkFacilityLifecycle(closedSite, { asOf: '2026-09-01' });
    const venue = siteWide.findings.find((f) => f.details.kind === 'venue');
    expect(venue.details.causeId).toBe('v1');
    expect(venue.details.causeKind).toBe('venue');
    // ... and the surface under it points at the venue, across the other edge.
    const surface = siteWide.findings.find((f) => f.details.kind === 'surface');
    expect(surface.details.causeId).toBe('v1');
    expect(surface.details.causeKind).toBe('venue');
    expect(surface.message).toContain('because venue "v1"');
  });

  it('gives byte-identical details from both arms, across every shape', () => {
    // **The twins, asserted as ONE contract rather than two that happen to
    // agree today.** Every previous check on this pair was a membership test --
    // `toContain('full')` -- which passed for both the divergent shape and the
    // unified one. That is how `details.id` came to mean "node reported" in one
    // arm and "node that closed it" in the other, through three rounds of
    // fixing this pair, with tests in this file pinning both shapes side by
    // side.
    //
    // Every retirement shape the module can produce, checked field for field.
    const cases = [
      // closed by its own window
      buildFacilityGraph({
        venues: [{ id: 'v1', name: 'V' }],
        surfaces: [{ id: 's1', venueId: 'v1', name: 'P', effectiveTo: '2026-06-30' }],
      }),
      // closed by its venue
      buildFacilityGraph({
        venues: [{ id: 'v1', name: 'V', effectiveTo: '2026-06-30' }],
        surfaces: [{ id: 's1', venueId: 'v1', name: 'P' }],
      }),
      // closed by a parent surface
      buildFacilityGraph({
        venues: [{ id: 'v1', name: 'V' }],
        surfaces: [
          { id: 'p1', venueId: 'v1', name: 'Full', effectiveTo: '2026-06-30', childIds: ['s1'] },
          { id: 's1', venueId: 'v1', name: 'Half', parentId: 'p1' },
        ],
      }),
      // closed by a grandparent
      nested(),
    ];
    const targets = ['s1', 's1', 's1', 'quarter'];

    for (const [index, graph] of cases.entries()) {
      const id = targets[index];
      const whole = checkFacilityLifecycle(graph, { asOf: '2026-09-01' });
      const scoped = checkFacilityLifecycle(graph, { asOf: '2026-09-01', surfaceId: id });
      const fromWhole = whole.findings.find((f) => f.details.id === id);
      // Both arms found it at all -- otherwise `undefined === undefined` would
      // satisfy the equality below and this loop would prove nothing.
      expect(fromWhole, `whole-graph arm missed ${id} in case ${index}`).toBeDefined();
      const fromScoped = scoped.findings.find((f) => f.code === FACILITY_REASON.NODE_RETIRED);
      expect(fromScoped, `scoped arm missed ${id} in case ${index}`).toBeDefined();
      expect(fromScoped.details).toEqual(fromWhole.details);
      expect(fromScoped.message).toBe(fromWhole.message);
    }
    // The loop ran over every case, rather than over an array that lost its
    // entries to a bad edit.
    expect(cases).toHaveLength(4);
  });

  it('reaches the eligibility check, on both of its paths', () => {
    // **The family closed downstream.** Liveness is consulted at three arms --
    // `retiredOn`, the whole-graph arm (which delegates to it) and the
    // surface-scoped arm -- and `checkFieldEligibility` is the consumer that
    // turns the answer into "may a team play here". A lineage fix that stopped
    // at the lifecycle module would leave the scheduler booking a half-pitch
    // inside a pitch that closed, which is the only form of this defect anyone
    // outside this file would ever notice.
    const graph = nested();
    // Both paths: the dateless-format one and the full one. The first is the
    // path a caller uses to ask about a surface generally, and it returns
    // early -- so it is where a lifecycle check is easiest to lose.
    const bare = checkFieldEligibility(graph, {
      surfaceId: 'quarter',
      format: null,
      date: '2026-09-01',
    });
    // The subject is the surface asked about; the ancestor is the cause. A
    // consumer switching on `details.kind` gets the same branch here as it does
    // from the whole-graph arm, which was the point of unifying them.
    const retiredFinding = (result) =>
      result.findings.find((f) => f.code === FACILITY_REASON.NODE_RETIRED);
    expect(retiredFinding(bare).details).toMatchObject({ id: 'quarter', causeId: 'full' });
    const full = checkFieldEligibility(graph, {
      surfaceId: 'quarter',
      format: '9v9',
      date: '2026-09-01',
    });
    expect(retiredFinding(full).details).toMatchObject({ id: 'quarter', causeId: 'full' });

    // Inside the window neither path reports a retirement, so the assertions
    // above are about the closure rather than about eligibility failing for
    // some unrelated reason.
    const open = checkFieldEligibility(graph, {
      surfaceId: 'quarter',
      format: null,
      date: '2026-05-01',
    });
    expect(open.findings.filter((f) => f.code === FACILITY_REASON.NODE_RETIRED)).toEqual([]);
  });

  it('retires only the branch that closed, not every sibling', () => {
    // A parent edge that propagated to the whole graph would satisfy the first
    // test too. Closing one half must leave its sibling and its parent open.
    const graph = buildFacilityGraph({
      venues: [{ id: 'v1', name: 'Alder' }],
      surfaces: [
        { id: 'full', venueId: 'v1', name: 'Full', childIds: ['a', 'b'] },
        {
          id: 'a',
          venueId: 'v1',
          name: 'Half A',
          parentId: 'full',
          effectiveTo: '2026-06-30',
          childIds: ['a1'],
        },
        { id: 'b', venueId: 'v1', name: 'Half B', parentId: 'full' },
        { id: 'a1', venueId: 'v1', name: 'Quarter A1', parentId: 'a' },
      ],
    });
    expect(retiredOn(graph, '2026-09-01')).toEqual({
      venueIds: [],
      surfaceIds: ['a', 'a1'],
    });
  });
});
