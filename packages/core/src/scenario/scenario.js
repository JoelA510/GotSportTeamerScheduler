/**
 * Branching a baseline: the scenario record, its fingerprint, and the
 * materialiser that turns `base ∪ overrides` back into engines.
 *
 * > *"The source project needed parallel schedules for 'with/without venue A',
 * > 'with/without venue B', and 'with/without equipment at one site on one
 * > date'. Each was a hand-built duplicate of the entire pipeline, separately
 * > verified, and impossible to keep in sync."*
 *
 * ## A scenario owns edits, not records
 *
 * A {@link import('./types.js').ScheduleScenario} holds **no schedule and no
 * records** — an id, a baseline, an optional parent, a list of overrides, and
 * the reason somebody wanted it. Everything else is derived. That is not
 * tidiness: a stored schedule is the source project's failure verbatim, and a
 * *stored diff* is worse, because a diff is only meaningful against the
 * baseline it was computed from. Fix a constraint in the baseline and every
 * stored diff now describes a schedule that no longer exists — incident 1's
 * shape in a new place — and a stored diff cannot answer "which constraints
 * break" at all, because breakage is a property of the *result* rather than of
 * the edit.
 *
 * ## Sharing is structural
 *
 * {@link materialiseScenario} rebuilds only the record arrays an override
 * touches. Every other set is the **same array object** the baseline holds, and
 * `meta.recordSetsShared` counts them — so *"a constraint fix must not need
 * applying five times"* is a number a test can falsify rather than a promise.
 *
 * ## What `remove` is for
 *
 * A blanket permit blackout does beat an open window: `restrictiveness()`
 * returns `+Infinity` for `hasPermit: false` and `resolvePermitWindow()` applies
 * the more restrictive record. But it also emits `PERMIT_PRECEDENCE_AMBIGUOUS`
 * on every consultation for that venue, because two equally-specific records
 * disagree and the calendar never picks a winner silently. So withdrawing a
 * venue means withdrawing its own rows **and** adding the blackout, and
 * {@link expandVenueUnavailable} does both from one stated `venueId` rather than
 * leaving an author to enumerate every weekday and date exception by hand.
 *
 * **The venue stays in the facility graph.** `requireSurface()` throws on an
 * unknown id and the baseline's own games still carry their surfaces; removal is
 * an *availability* fact, not a *geometry* one.
 *
 * ## Not `field_availability_scenarios`
 *
 * `supabase/migrations/20260522120000_field_availability_phase1.sql:93-112`
 * already declares a table of that name. It models **field-availability
 * profiles** — which fields a club may use in a given configuration — and it is
 * fully orphaned: no scheduler and no evaluator reads it (`ARCHITECTURE.md`
 * §6.13). This module models **schedule branches**, is in memory only, writes no
 * SQL, and neither reads the other. See `docs/SCENARIOS.md` §9.
 *
 * @module scenario/scenario
 */

import { buildAvailabilityCalendar, weekdayCodeOf } from '../availability/calendar.js';
import { buildConstraintRegistry, retypeConstraint } from '../constraints/registry.js';
import { buildFacilityGraph } from '../facility/facilityGraph.js';
import { buildFormatTimingTable } from '../timing/formatTiming.js';

import { recordDigest, recordsOf, SCENARIO_RECORD_SET_ORDER } from './inputs.js';
import {
  SCENARIO_OVERRIDE_KIND,
  SCENARIO_RECORD_SET,
  SCENARIO_REASON,
  createScenarioMeta,
  deriveScenarioStatus,
  makeScenarioFinding,
} from './reasonCodes.js';
import { ScheduleScenarioSchema } from './schemas.js';

/** Every weekday code, so a whole-season venue withdrawal cannot miss one. */
const EVERY_WEEKDAY = Object.freeze(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);

/**
 * Parse and freeze a scenario record.
 *
 * @param {Object} input - see `ScheduleScenarioSchema`
 * @returns {import('./types.js').ScheduleScenario}
 */
export function makeScenario(input) {
  const parsed = ScheduleScenarioSchema.parse(input);
  return /** @type {import('./types.js').ScheduleScenario} */ (
    Object.freeze({
      ...parsed,
      overrides: Object.freeze(parsed.overrides.map((override) => Object.freeze({ ...override }))),
    })
  );
}

/**
 * The overrides that apply to a scenario, parent first.
 *
 * A branch of a branch composes: the parent's edits are applied before the
 * child's, so *"no venue X, and also no lights at Y"* is one scenario naming
 * one override on top of another rather than a second five-record copy.
 *
 * @param {import('./types.js').ScheduleScenario} scenario
 * @param {ReadonlyArray<import('./types.js').ScheduleScenario>} [ancestry] - resolved parents, outermost first
 * @returns {import('./types.js').ScenarioOverride[]}
 */
export function composedOverrides(scenario, ancestry = []) {
  /** @type {import('./types.js').ScenarioOverride[]} */
  const out = [];
  for (const ancestor of ancestry) out.push(...ancestor.overrides);
  out.push(...scenario.overrides);
  return out;
}

/**
 * **The fingerprint.**
 *
 * A structural digest over the base record arrays **plus the override list** —
 * and over nothing else. Never over scenario metadata such as an `updatedAt`:
 * that would derive a check's subject from the very data a corruption would
 * change, which is a check that cannot fail.
 *
 * @param {import('./types.js').SeasonInputs} inputs
 * @param {ReadonlyArray<import('./types.js').ScenarioOverride>} overrides
 * @returns {string}
 */
export function scenarioFingerprint(inputs, overrides) {
  return recordDigest(
    {
      baseline: [{ digest: inputs.digest }],
      overrides: overrides.map((override) => ({
        kind: override.kind,
        recordSet: override.recordSet,
        recordId: override.recordId,
        record: override.record,
        type: override.type,
        weight: override.weight,
        venueId: override.venueId,
        dates: override.dates,
      })),
    },
    ['baseline', 'overrides']
  );
}

/**
 * The permit edits one `venue-unavailable` override becomes.
 *
 * **One record with a `venueId` in, a complete set of edits out.** A
 * whole-season withdrawal withdraws every permit row the venue has and lays down
 * one blackout per weekday, so no date can fall through a weekday nobody
 * enumerated. A date-scoped withdrawal withdraws only the venue's own
 * *date-exception* rows on the named dates — the weekday defaults stay, and are
 * beaten by the date-scoped blackout, because `resolvePermitWindow()` takes an
 * exact-date match over a weekday default rather than comparing the two.
 *
 * Exported so a test can hold the expansion up against the corpus rather than
 * against a paragraph.
 *
 * @param {import('./types.js').ScenarioOverride} override
 * @param {ReadonlyArray<Object>} permits - the base rows
 * @returns {{ removeIds: string[], added: Object[] }}
 */
export function expandVenueUnavailable(override, permits) {
  const venueId = /** @type {string} */ (override.venueId);
  const dates = override.dates ?? null;
  const mine = permits.filter((row) => row.venueId === venueId);

  const removeIds = (
    dates === null ? mine : mine.filter((row) => row.date !== null && dates.includes(row.date))
  ).map((row) => String(row.id));

  const scopes =
    dates === null
      ? EVERY_WEEKDAY.map((weekday) => ({
          suffix: weekday,
          scopeKind: /** @type {const} */ ('weekday-default'),
          weekday,
          date: /** @type {string|null} */ (null),
        }))
      : dates.map((date) => ({
          suffix: date,
          scopeKind: /** @type {const} */ ('date-exception'),
          weekday: weekdayCodeOf(date),
          date,
        }));

  const added = scopes.map((scope) => ({
    id: `${override.kind}:${venueId}:${scope.suffix}`,
    venueId,
    scopeKind: scope.scopeKind,
    // A date-scoped row still carries its weekday: the schema does not demand
    // it and nothing resolves on it, but a blackout that cannot say which day
    // of the week it fell on is a row somebody has to look up a calendar for.
    weekday: scope.weekday,
    date: scope.date,
    hasPermit: false,
    openMinutes: null,
    closeMinutes: null,
    lit: null,
    lightsOffMinutes: null,
    note: override.reason,
    source: `scenario override (${override.by})`,
  }));

  return { removeIds, added };
}

/**
 * One override reduced to the primitive edits it performs on one record set.
 *
 * @param {import('./types.js').ScenarioOverride} override
 * @param {Record<string, ReadonlyArray<Object>>} base
 * @returns {Array<{ recordSet: string, op: string, recordId: string|null, record: Object|null, override: import('./types.js').ScenarioOverride }>}
 */
function primitiveEditsOf(override, base) {
  if (override.kind === SCENARIO_OVERRIDE_KIND.VENUE_UNAVAILABLE) {
    const expansion = expandVenueUnavailable(override, base[SCENARIO_RECORD_SET.PERMITS] ?? []);
    return [
      ...expansion.removeIds.map((recordId) => ({
        recordSet: SCENARIO_RECORD_SET.PERMITS,
        op: SCENARIO_OVERRIDE_KIND.REMOVE,
        recordId,
        record: null,
        override,
      })),
      ...expansion.added.map((record) => ({
        recordSet: SCENARIO_RECORD_SET.PERMITS,
        op: SCENARIO_OVERRIDE_KIND.ADD,
        recordId: String(record.id),
        record,
        override,
      })),
    ];
  }
  return [
    {
      recordSet: /** @type {string} */ (override.recordSet),
      op: override.kind,
      recordId: override.recordId ?? (override.record ? String(override.record.id) : null),
      record: override.record,
      override,
    },
  ];
}

/**
 * Apply a scenario's overrides to a baseline and build the engines.
 *
 * @param {import('./types.js').SeasonInputs} inputs
 * @param {import('./types.js').ScheduleScenario} scenario
 * @param {{ ancestry?: ReadonlyArray<import('./types.js').ScheduleScenario> }} [options]
 * @returns {import('./types.js').MaterialisedScenario}
 */
export function materialiseScenario(inputs, scenario, options = {}) {
  if (scenario.baselineId !== inputs.id) {
    throw new Error(
      `scenario: "${scenario.id}" branches from baseline "${scenario.baselineId}" and was handed "${inputs.id}"; a branch materialised against the wrong baseline would answer a question nobody asked`
    );
  }
  const ancestry = options.ancestry ?? [];
  if (scenario.parentScenarioId !== null && ancestry.length === 0) {
    throw new Error(
      `scenario: "${scenario.id}" names parent "${scenario.parentScenarioId}"; pass it in options.ancestry so its overrides compose, rather than materialising a branch missing half its edits`
    );
  }

  const meta = createScenarioMeta();
  /** @type {import('./types.js').ScenarioFinding[]} */
  const findings = [];
  const overrides = composedOverrides(scenario, ancestry);
  meta.overridesDeclared = overrides.length;

  if (ancestry.length > 0) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_BRANCHED_FROM_SCENARIO,
        `"${scenario.id}" branches from ${ancestry.map((a) => `"${a.id}"`).join(' then ')}, so ${overrides.length - scenario.overrides.length} inherited override(s) apply before its own ${scenario.overrides.length}`,
        {
          scenarioId: scenario.id,
          ancestryIds: ancestry.map((a) => a.id),
          inheritedOverrides: overrides.length - scenario.overrides.length,
          ownOverrides: scenario.overrides.length,
        }
      )
    );
  }

  const base = recordsOf(inputs);
  /** @type {Map<string, Array<Object>>} */
  const rebuilt = new Map();
  /** @type {Map<string, import('./types.js').ScenarioOverride>} */
  const claimedIds = new Map();
  /** @type {Array<{ recordId: string, type: string, weight: number|null, override: import('./types.js').ScenarioOverride }>} */
  const retypes = [];

  const working = (set) => {
    if (!rebuilt.has(set)) rebuilt.set(set, [...(base[set] ?? [])]);
    return /** @type {Array<Object>} */ (rebuilt.get(set));
  };

  for (const override of overrides) {
    for (const edit of primitiveEditsOf(override, base)) {
      const key = `${edit.recordSet}|${edit.recordId}`;
      const claimed = claimedIds.get(key);
      if (claimed !== undefined) {
        // Two overrides, one record id. **Not a precedence question**: overrides
        // are set operations applied before anything is built, so there is no
        // consultation at which one could beat the other, and inventing a
        // fourth specificity ladder to pick a winner would be exactly the
        // parallel machinery this phase exists to avoid.
        findings.push(
          makeScenarioFinding(
            SCENARIO_REASON.SCENARIO_OVERRIDE_CONFLICT,
            `two overrides of "${scenario.id}" both touch ${edit.recordSet} record "${edit.recordId}" ("${claimed.reason}" and "${override.reason}"); overrides are set operations rather than competing scopes, so this is a contradiction to remove rather than a precedence to resolve`,
            {
              scenarioId: scenario.id,
              recordSet: edit.recordSet,
              recordId: edit.recordId,
              firstReason: claimed.reason,
              secondReason: override.reason,
              firstBy: claimed.by,
              secondBy: override.by,
            }
          )
        );
        continue;
      }
      claimedIds.set(key, override);

      const bucket = working(edit.recordSet);
      const index = bucket.findIndex((record) => String(record.id) === edit.recordId);

      if (edit.op === SCENARIO_OVERRIDE_KIND.ADD) {
        if (index !== -1) {
          findings.push(
            makeScenarioFinding(
              SCENARIO_REASON.SCENARIO_OVERRIDE_ID_COLLIDES,
              `override "${override.reason}" adds ${edit.recordSet} record "${edit.recordId}", which the baseline already holds; an add that silently replaced it would be a remove nobody wrote`,
              { scenarioId: scenario.id, recordSet: edit.recordSet, recordId: edit.recordId }
            )
          );
          continue;
        }
        bucket.push(/** @type {Object} */ (edit.record));
        meta.recordsAdded += 1;
      } else if (edit.op === SCENARIO_OVERRIDE_KIND.REMOVE) {
        if (index === -1) {
          findings.push(
            makeScenarioFinding(
              SCENARIO_REASON.SCENARIO_OVERRIDE_TARGET_MISSING,
              `override "${override.reason}" withdraws ${edit.recordSet} record "${edit.recordId}", which the baseline does not hold; the branch models something other than what its author wrote`,
              { scenarioId: scenario.id, recordSet: edit.recordSet, recordId: edit.recordId }
            )
          );
          continue;
        }
        bucket.splice(index, 1);
        meta.recordsRemoved += 1;
      } else if (edit.op === SCENARIO_OVERRIDE_KIND.RETYPE) {
        if (index === -1) {
          findings.push(
            makeScenarioFinding(
              SCENARIO_REASON.SCENARIO_OVERRIDE_TARGET_MISSING,
              `override "${override.reason}" retypes constraint "${edit.recordId}", which the registry does not hold`,
              { scenarioId: scenario.id, recordSet: edit.recordSet, recordId: edit.recordId }
            )
          );
          continue;
        }
        // Deferred to after the registry is built: `retypeConstraint()` is the
        // one place a type change is written, and it writes the change into the
        // record's own history. Editing `record.type` here would be a second
        // way to change hardness, with no history behind it.
        retypes.push({
          recordId: /** @type {string} */ (edit.recordId),
          type: /** @type {string} */ (override.type),
          weight: override.weight,
          override,
        });
        meta.recordsRetyped += 1;
      } else {
        throw new Error(`scenario: unknown override operation "${edit.op}"`);
      }

      meta.overridesApplied += 1;
      findings.push(
        makeScenarioFinding(
          SCENARIO_REASON.SCENARIO_OVERRIDE_APPLIED,
          `${edit.op} on ${edit.recordSet} record "${edit.recordId}": ${override.reason} (${override.by})`,
          {
            scenarioId: scenario.id,
            kind: override.kind,
            operation: edit.op,
            recordSet: edit.recordSet,
            recordId: edit.recordId,
            by: override.by,
            at: override.at,
          }
        )
      );
    }
  }

  /** @type {Record<string, ReadonlyArray<Object>>} */
  const records = {};
  /** @type {string[]} */
  const shared = [];
  for (const set of SCENARIO_RECORD_SET_ORDER) {
    if (rebuilt.has(set)) {
      records[set] = /** @type {ReadonlyArray<Object>} */ (rebuilt.get(set));
      meta.recordSetsRebuilt += 1;
      continue;
    }
    // **The same array object the baseline holds**, not a copy. This is the
    // sharing guarantee, and `recordSetsShared` is what makes it checkable.
    records[set] = base[set];
    shared.push(set);
    meta.recordSetsShared += 1;
  }

  const graph = buildFacilityGraph({
    ...inputs.facilityInput,
    equipmentWindows: [...records[SCENARIO_RECORD_SET.EQUIPMENT]],
  });
  const table = buildFormatTimingTable(inputs.timingInput);
  const calendar = buildAvailabilityCalendar({
    permitWindows: [...records[SCENARIO_RECORD_SET.PERMITS]],
    sunsets: [...inputs.sunsets],
    lighting: [...records[SCENARIO_RECORD_SET.LIGHTING]],
    sunsetMarginMinutes: inputs.calendarOptions.sunsetMarginMinutes,
    permitMarginMinutes: inputs.calendarOptions.permitMarginMinutes,
    source: inputs.calendarOptions.source,
  });

  let registry = buildConstraintRegistry({
    name: inputs.registry.name,
    source: inputs.registry.source,
    constraints: [...records[SCENARIO_RECORD_SET.CONSTRAINTS]],
  });
  for (const retype of retypes) {
    registry = retypeConstraint(registry, retype.recordId, {
      type: retype.type,
      by: retype.override.by,
      // `ConstraintTypeChange.at` is a calendar **date** — the day a decision
      // was taken — while a scenario override carries the naive timestamp every
      // record in this package is stamped with. The date is the leading ten
      // characters of the stamp and no `Date` is constructed to get it; taking
      // the whole stamp would be rejected by the constraint schema, and
      // inventing a different date would be a second answer to "when".
      at: retype.override.at === null ? null : retype.override.at.slice(0, 10),
      note: retype.override.reason,
      ...(retype.weight === null ? {} : { weight: retype.weight }),
    });
  }
  if (retypes.length > 0) {
    // The registry the branch actually consults carries the retyped records, so
    // the effective constraint array is read back out of it rather than out of
    // the pre-retype working copy. A promotion that took the working copy would
    // drop the very history `retypeConstraint()` just wrote.
    //
    // Guarded, because an unconditional assignment would replace the shared
    // array with a rebuilt one on every branch — including the ones that retype
    // nothing — and silently revoke the sharing guarantee for the record set
    // the build plan names ("a constraint fix must not need applying five
    // times") while `recordSetsShared` went on claiming otherwise.
    records[SCENARIO_RECORD_SET.CONSTRAINTS] = registry.constraints;
    if (shared.includes(SCENARIO_RECORD_SET.CONSTRAINTS)) {
      shared.splice(shared.indexOf(SCENARIO_RECORD_SET.CONSTRAINTS), 1);
      meta.recordSetsShared -= 1;
      meta.recordSetsRebuilt += 1;
    }
  }

  const engines = {
    graph,
    table,
    calendar,
    registry,
    resources: {
      graph,
      timingTable: table,
      calendar,
      venueComplexes: inputs.venueComplexes,
    },
  };

  return /** @type {import('./types.js').MaterialisedScenario} */ ({
    scenario,
    inputs,
    overrides: Object.freeze(overrides),
    records,
    sharedRecordSets: Object.freeze(shared),
    engines,
    fingerprint: scenarioFingerprint(inputs, overrides),
    findings,
    status: deriveScenarioStatus(findings),
    meta,
  });
}
