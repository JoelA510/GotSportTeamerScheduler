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
    expect(inside.meta.lifecycleNodesJudged).toBe(1);

    const outside = checkFieldEligibility(dated, {
      surfaceId: 's1',
      format: '9v9',
      date: '2026-09-01',
    });
    expect(lifecycleCodes(outside)).toEqual([FACILITY_REASON.NODE_RETIRED]);
    expect(outside.status).toBe('rejected');
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
