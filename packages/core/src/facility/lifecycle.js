/**
 * **When a piece of the estate is part of the estate.**
 *
 * Phase 8.4 gives venues and surfaces an inclusive effective window. This
 * module is the **single producer** of the answer "is this node live on this
 * date", and of the finding that says the caller never named a date.
 *
 * ## One producer, because the alternative is two answers
 *
 * `fields.active` and `fields.effective_to` both say a field is out of use, and
 * PR 2 keeps both deliberately: the shipped MVP scheduler filters on
 * `.eq('active', true)` at `GameSchedulingPage.jsx:253`, so retiring a field by
 * date alone would leave it in the scheduler's list. Two columns saying one
 * thing is a hazard, and the way it is bounded is that `admin_retire_field`
 * writes them together and a smoke asserts they cannot disagree. The same logic
 * applies here: every consumer asks {@link isLiveOn}, so there is one reading of
 * an effective window rather than one per call site.
 *
 * ## Inclusive on both ends, and compared as strings
 *
 * `effectiveFrom` and `effectiveTo` are inclusive `YYYY-MM-DD`, matching
 * `blackout_from`/`blackout_until` and `available_from`/`available_until` on the
 * tables this mirrors -- one convention, not three. They are compared with `<`
 * and `>` on the strings, which is exact for zero-padded ISO dates and is why
 * the schema pins the format. **No `Date` is constructed here** (GAP-30): the
 * corpus is wall clock, two of its dates fall after DST ends, and a comparison
 * routed through an absolute instant would move a boundary by a day on one
 * machine and not another.
 *
 * ## What `FACILITY_LIFECYCLE_UNJUDGED` is, and what it is not
 *
 * It is not "this ground is retired" -- {@link FACILITY_REASON.NODE_RETIRED}
 * says that, and it is blocking. `LIFECYCLE_UNJUDGED` says the *question* was
 * underspecified: the graph has more than one shape over time and the caller
 * asked about none of them.
 *
 * It fires only when the graph actually holds a dated node. On a graph where
 * every window is `null`/`null` there is exactly one estate and omitting `asOf`
 * costs nothing, so firing there would be noise a reader learns to ignore.
 *
 * **On today's corpus `datedNodeCount` is zero.** Nothing in `season-2026`
 * carries an effective window, so this finding cannot fire on real data and its
 * only exercise is a constructed graph. That is stated rather than left for a
 * reader to infer, and it is why the count is published even at zero: a report
 * reading `datedNodeCount: 0` says *the universe was empty*, where a silent
 * absence would read as "checked, and clean".
 *
 * @module facility/lifecycle
 */

import { createMeta } from './facilityGraph.js';
import { FACILITY_REASON, deriveFacilityStatus, makeFinding } from './reasonCodes.js';

/**
 * Is `node` live on `asOf`?
 *
 * **The one reading of an effective window.** `null` on a bound means unbounded
 * on that side, so `null`/`null` is "always" and answers `true` for every date.
 *
 * @param {{ effectiveFrom: string|null, effectiveTo: string|null }} node
 * @param {string} asOf - inclusive `YYYY-MM-DD`
 * @returns {boolean}
 */
export function isLiveOn(node, asOf) {
  if (node.effectiveFrom !== null && asOf < node.effectiveFrom) return false;
  if (node.effectiveTo !== null && asOf > node.effectiveTo) return false;
  return true;
}

/**
 * Does this node carry an effective window at all?
 *
 * @param {{ effectiveFrom: string|null, effectiveTo: string|null }} node
 * @returns {boolean}
 */
export function isDatedNode(node) {
  return node.effectiveFrom !== null || node.effectiveTo !== null;
}

/**
 * Every node id whose window excludes `asOf`, venues first then surfaces.
 *
 * Enumerated from `graph.venueIds` and `graph.surfaceIds` -- the registries --
 * rather than from anything a retirement would empty, so a node that vanished
 * would be absent from the *registry* and caught by the graph builder, not
 * silently absent from this answer.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} asOf
 * @returns {{ venueIds: string[], surfaceIds: string[] }}
 */
export function retiredOn(graph, asOf) {
  const venueIds = graph.venueIds.filter((id) => !isLiveOn(graph.venues[id], asOf));
  const retiredVenues = new Set(venueIds);
  return {
    venueIds,
    // **A surface at a closed site is retired, whatever its own window says.**
    // The surface-scoped arm of `checkFacilityLifecycle()` has always checked
    // the venue alongside the surface; this arm did not, so the same estate
    // gave two answers depending on which entry point was asked -- twin arms,
    // one corrected. A pitch with no window of its own at a venue that shut in
    // June was reported live here and retired by the surface check.
    surfaceIds: graph.surfaceIds.filter((id) => !surfaceIsLiveOn(graph, id, asOf, retiredVenues)),
  };
}

/**
 * Is this surface live, taking its **whole containment lineage** and its venue
 * into account?
 *
 * **The one reading, because three arms had three answers.** Round 1 propagated
 * a retired venue to its surfaces and stopped there. A surface contained by a
 * retired PARENT surface was still reported live -- a half-pitch of a pitch
 * that closed in June came back bookable in September, in every arm.
 *
 * `lineage` is self plus every ancestor, nearest first, so this covers the
 * surface's own window, its parent's, its grandparent's, and the venue's. A
 * booking cannot stand on ground whose container does not exist.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @param {string} asOf
 * @param {Set<string>} [retiredVenues] - precomputed, when the caller has it
 * @returns {boolean}
 */
function surfaceIsLiveOn(graph, surfaceId, asOf, retiredVenues) {
  const surface = graph.surfaces[surfaceId];
  if (surface === undefined) return true;
  const venueRetired =
    retiredVenues === undefined
      ? !isLiveOn(graph.venues[surface.venueId], asOf)
      : retiredVenues.has(surface.venueId);
  if (venueRetired) return false;
  // Self plus every ancestor. `lineage` always contains the surface itself, so
  // this subsumes the surface's own window rather than checking it twice.
  return surface.lineage.every((id) => isLiveOn(graph.surfaces[id], asOf));
}

/**
 * **Why is this surface not live on `asOf`?** The nearest node that excludes it.
 *
 * A surface with no window of its own can be retired by a parent surface or by
 * its venue, and the whole-graph arm was reporting those as the SURFACE's own
 * retirement: `surface "s1" is effective always onward and 2026-09-01 falls
 * outside it`, with null bounds in `details` -- a sentence that contradicts
 * itself, naming a window that excludes nothing. An operator reading it would
 * go looking for a date on the pitch that does not exist.
 *
 * This walk existed once before, was never called, and was deleted as dead code
 * in round 2. It is back because the arm that needed it is now the caller: the
 * lesson was not "do not write the helper", it was "do not leave it unwired".
 *
 * `lineage` is self-first, so a surface with its own expired window is its own
 * cause and the message is unchanged for that case.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @param {string} asOf
 * @returns {{ kind: string, node: any }|null} null when the surface IS live
 */
function retirementCause(graph, surfaceId, asOf) {
  const surface = graph.surfaces[surfaceId];
  if (surface === undefined) return null;
  for (const id of surface.lineage) {
    if (!isLiveOn(graph.surfaces[id], asOf)) return { kind: 'surface', node: graph.surfaces[id] };
  }
  const venue = graph.venues[surface.venueId];
  if (!isLiveOn(venue, asOf)) return { kind: 'venue', node: venue };
  return null;
}

/**
 * **The lifecycle verdict for one query.**
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {{ asOf?: string|null, surfaceId?: string|null }} [query]
 * @returns {import('./types.js').FacilityCheckResult}
 */
export function checkFacilityLifecycle(graph, query = {}) {
  const asOf = query.asOf ?? null;
  const surfaceId = query.surfaceId ?? null;
  const meta = createMeta();
  /** @type {import('./types.js').FacilityFinding[]} */
  const findings = [];

  // **Published on every path, including the ones that return early.** The
  // count is the meta-assertion: it says whether there was anything to judge,
  // so a clean result and an empty universe cannot be confused.
  meta.datedNodeCount = graph.stats.datedNodeCount;

  if (asOf === null) {
    if (graph.stats.datedNodeCount > 0) {
      findings.push(
        makeFinding(
          FACILITY_REASON.LIFECYCLE_UNJUDGED,
          `${graph.stats.datedNodeCount} node(s) carry an effective window and this query named no asOf date, so the answer is about an estate that changes shape over time`,
          { datedNodeCount: graph.stats.datedNodeCount }
        )
      );
    }
    return { status: deriveFacilityStatus(findings), findings, meta };
  }

  if (surfaceId === null) {
    // **A whole-graph query judges the whole graph.**
    //
    // The first draft set `lifecycleNodesJudged` to the graph's dated count and
    // then judged nothing, because every judgement sat inside the
    // `surfaceId !== null` branch. Measured: a graph whose every surface was
    // retired came back `findings: []`, `status: 'allowed'`,
    // `lifecycleNodesJudged: 2` -- a clean verdict on an estate that did not
    // exist, with a counter asserting two nodes had been examined. That is the
    // meta-assertion-that-cannot-fail shape exactly, in the counter written to
    // prevent it.
    //
    // `retiredOn()` already enumerates from the registries, so it is the one
    // producer here too rather than a second walk.
    const retired = retiredOn(graph, asOf);
    for (const [kind, ids] of /** @type {Array<[string, string[]]>} */ ([
      ['venue', retired.venueIds],
      ['surface', retired.surfaceIds],
    ])) {
      for (const id of ids) {
        const node = kind === 'venue' ? graph.venues[id] : graph.surfaces[id];
        // **Name the node that actually closed, not the one being reported.**
        // A venue is always its own cause. A surface may be retired by an
        // ancestor or by its venue, and attributing that to the surface
        // produced `is effective always onward and ... falls outside it` --
        // self-contradictory, with null bounds in `details`. The scoped twin at
        // the bottom of this function has always named the ancestor; this arm
        // did not, and that pair was round 2 finding 4. One arm corrected and
        // its twin not, for the second time on the same pair.
        const cause = kind === 'venue' ? { kind, node } : retirementCause(graph, id, asOf);
        // `retiredOn()` put this id in the list, so something excludes `asOf`.
        // A null cause here means the two disagree, which is a defect in one of
        // them and never something to paper over with the node's own window.
        if (cause === null) {
          throw new Error(
            `facility: "${id}" is reported retired on ${asOf} but no node in its lineage or venue excludes that date`
          );
        }
        const bySelf = cause.node.id === id;
        findings.push(
          makeFinding(
            FACILITY_REASON.NODE_RETIRED,
            bySelf
              ? `${kind} "${id}" is effective ${describeWindow(node)} and ${asOf} falls outside it`
              : `${kind} "${id}" is retired on ${asOf} because ${cause.kind} "${cause.node.id}" is effective ${describeWindow(cause.node)}`,
            {
              kind,
              id,
              asOf,
              effectiveFrom: node.effectiveFrom,
              effectiveTo: node.effectiveTo,
              // The node whose window is the reason. Equal to `id`/`kind` when
              // the surface closed on its own dates, so a consumer reading only
              // the cause fields is never wrong, merely redundant.
              causeKind: cause.kind,
              causeId: cause.node.id,
              causeEffectiveFrom: cause.node.effectiveFrom,
              causeEffectiveTo: cause.node.effectiveTo,
            }
          )
        );
      }
    }
    // Every node was looked at, which is what the count now means.
    meta.lifecycleNodesJudged = graph.venueIds.length + graph.surfaceIds.length;
    return { status: deriveFacilityStatus(findings), findings, meta };
  }

  {
    const surface = graph.surfaces[surfaceId];
    // An unknown surface is `SURFACE_UNKNOWN`'s business, not this module's;
    // answering here would give one question two owners. **The counter says
    // zero in that case**, because nothing was judged -- reporting 1 would be
    // the same false testimony the whole-graph path used to give.
    if (surface === undefined) {
      meta.lifecycleNodesJudged = 0;
    } else {
      // **The whole lineage plus the venue, so the count says how many.** It
      // said a flat 2 -- correct only while this arm checked the surface and
      // its venue and nothing else. Once the loop below started walking the
      // lineage, a half-pitch inside a pitch judged three nodes and reported
      // two. A counter that under-reports is worse than no counter: the
      // meta-assertions downstream use it to prove the check did work, so an
      // arm that examined more than it admitted would still look thin enough
      // to be believed.
      meta.lifecycleNodesJudged = surface.lineage.length + 1;
      // **The whole lineage AND the venue, through the one producer both arms
      // use.** A surface with no window of its own sits inside a parent surface
      // and a venue that may each have one; checking only the surface reported
      // a live half-pitch of a pitch that closed in June, at a site that closed
      // in June.
      //
      // **`details.id` is the node REPORTED, and `causeId` the node
      // RESPONSIBLE -- in both arms.** This arm used to emit one finding per
      // blocking node, keyed on the blocker, so `id` meant "the thing that
      // closed" here and "the thing being judged" in the whole-graph arm. For a
      // surface `s1` at a closed venue `v1`, the whole-graph arm said
      // `{kind:'surface', id:'s1', causeId:'v1'}` and this one said
      // `{kind:'venue', id:'v1'}` with no cause at all and `s1` never named --
      // two answers to one question, and a consumer that switched on
      // `details.kind` would take a different branch depending on which entry
      // point it came through. Third time on this pair of twins, and the first
      // two fixes each corrected one arm and left the other.
      //
      // The query asked about ONE surface, so the answer is one finding about
      // that surface, naming what closed it. `retirementCause()` is the single
      // producer of "what closed it", shared with the whole-graph arm, so the
      // two cannot drift apart again without the shared function changing.
      const cause = retirementCause(graph, surfaceId, asOf);
      if (cause !== null) {
        const bySelf = cause.node.id === surfaceId;
        findings.push(
          makeFinding(
            FACILITY_REASON.NODE_RETIRED,
            bySelf
              ? `surface "${surfaceId}" is effective ${describeWindow(surface)} and ${asOf} falls outside it`
              : `surface "${surfaceId}" is retired on ${asOf} because ${cause.kind} "${cause.node.id}" is effective ${describeWindow(cause.node)}`,
            {
              kind: 'surface',
              id: surfaceId,
              asOf,
              effectiveFrom: surface.effectiveFrom,
              effectiveTo: surface.effectiveTo,
              causeKind: cause.kind,
              causeId: cause.node.id,
              causeEffectiveFrom: cause.node.effectiveFrom,
              causeEffectiveTo: cause.node.effectiveTo,
            }
          )
        );
      }
    }
  }

  return { status: deriveFacilityStatus(findings), findings, meta };
}

/**
 * `from X to Y`, with the unbounded sides spelled rather than left blank.
 *
 * @param {{ effectiveFrom: string|null, effectiveTo: string|null }} node
 * @returns {string}
 */
function describeWindow(node) {
  const from = node.effectiveFrom === null ? 'always' : `from ${node.effectiveFrom}`;
  const to = node.effectiveTo === null ? 'onward' : `until ${node.effectiveTo}`;
  return `${from} ${to}`;
}
