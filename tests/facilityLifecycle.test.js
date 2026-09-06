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

import {
  FACILITY_REASON,
  buildFacilityGraph,
  checkBooking,
  checkFacilityLifecycle,
  checkFieldEligibility,
  isDatedNode,
  isLiveOn,
  retiredOn,
} from '@squadlogic/core/facility/index.js';
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
    expect(result.findings[0].details).toMatchObject({ kind: 'venue', id: 'v1' });
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
    // **Finding 11's family: nine `createMeta()` sites, one counter.** Only the
    // lifecycle check counts; the other eight used to publish a literal 0,
    // which reads as "counted, found none" when nothing counted. The ruling to
    // publish the count even at zero was written against exactly that, so the
    // uncounted state is `null` and the counted state is a number -- including
    // 0, which is what the corpus gives.
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
    const scoped = checkFacilityLifecycle(closedSite, { asOf: '2026-09-01', surfaceId: 's1' });
    expect(scoped.findings.map((f) => f.details.id)).toContain('v1');

    // Inside the window both arms are clean, so the assertions above are about
    // the closure and not about the venue being checked at all.
    expect(retiredOn(closedSite, '2026-05-01')).toEqual({ venueIds: [], surfaceIds: [] });
  });
});
