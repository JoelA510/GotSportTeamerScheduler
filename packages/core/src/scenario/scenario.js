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

import {
  recordDigest,
  recordsOf,
  seasonInputsDigest,
  SCENARIO_RECORD_SET_ORDER,
} from './inputs.js';
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
 * **`by`, `at` and `reason` are part of the override**, not metadata about it,
 * and they are digested for the same reason every other field is: they are
 * written into the records the branch builds. A `venue-unavailable` puts
 * `reason` in each expanded permit row's `note` and `by` in its `source`, and a
 * `retype` puts all three into the constraint's own type-change history. Two
 * branches differing only there build genuinely different records, and a
 * fingerprint that could not tell them apart would call one a valid cache of
 * the other. Scenario metadata — the name, the rationale, who asked, when the
 * branch was created — stays out, because none of it reaches a record.
 *
 * ## The baseline half is recomputed, never read off the bundle
 *
 * `inputs.digest` is the digest as it stood when `makeSeasonInputs()` ran, and
 * reading it here made the fingerprint blind to exactly the workflow
 * `inputs.js` documents: the record arrays are the caller's **own objects**, so
 * *"a constraint fix must not need applying five times"* means somebody
 * corrects one record in place and five branches see it. Against a snapshotted
 * digest that correction moved every branch's answer and invalidated nothing —
 * `ScenarioMemo.check()` returned no finding and `resolve()` served the
 * pre-edit result.
 *
 * The sharing is **not** weakened to close it: nothing is copied and nothing is
 * frozen that was not frozen before. The digest is simply taken when the
 * question is asked rather than when the bundle was built, which costs one
 * canonical rendering of the bundle per materialisation.
 *
 * @param {import('./types.js').SeasonInputs} inputs
 * @param {ReadonlyArray<import('./types.js').ScenarioOverride>} overrides
 * @returns {string}
 */
export function scenarioFingerprint(inputs, overrides) {
  return recordDigest(
    {
      baseline: [{ digest: seasonInputsDigest(inputs) }],
      overrides: overrides.map((override) => ({
        kind: override.kind,
        recordSet: override.recordSet,
        recordId: override.recordId,
        record: override.record,
        type: override.type,
        weight: override.weight,
        venueId: override.venueId,
        dates: override.dates,
        by: override.by,
        at: override.at,
        reason: override.reason,
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
 * **`current` is the branch as it stands, never the baseline as it started.**
 * Overrides are set operations applied in order, so a `venue-unavailable`
 * expanded against the original permits would walk past a row an earlier
 * override of the same branch had already added for that venue — leaving an
 * open window standing beside the blackout, which is
 * `PERMIT_PRECEDENCE_AMBIGUOUS` on every consultation for that venue and
 * exactly the noise the withdrawal's own `remove` half exists to prevent.
 *
 * @param {import('./types.js').ScenarioOverride} override
 * @param {(set: string) => ReadonlyArray<Object>} current - the effective rows of one record set, so far
 * @returns {Array<{ recordSet: string, op: string, recordId: string|null, record: Object|null, derived: boolean, override: import('./types.js').ScenarioOverride }>}
 */
function primitiveEditsOf(override, current) {
  if (override.kind === SCENARIO_OVERRIDE_KIND.VENUE_UNAVAILABLE) {
    const expansion = expandVenueUnavailable(override, current(SCENARIO_RECORD_SET.PERMITS));
    return [
      ...expansion.removeIds.map((recordId) => ({
        recordSet: SCENARIO_RECORD_SET.PERMITS,
        op: SCENARIO_OVERRIDE_KIND.REMOVE,
        recordId,
        record: null,
        derived: true,
        override,
      })),
      ...expansion.added.map((record) => ({
        recordSet: SCENARIO_RECORD_SET.PERMITS,
        op: SCENARIO_OVERRIDE_KIND.ADD,
        recordId: String(record.id),
        record,
        derived: true,
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
      derived: false,
      override,
    },
  ];
}

/**
 * Do two `venue-unavailable` overrides of one venue cover any day in common?
 *
 * A whole-season withdrawal (`dates === null`) covers every day, so it overlaps
 * anything. Two date-scoped withdrawals overlap only where their date sets do —
 * *"no Alder on 08/22"* and *"no Alder on 09/05"* are two facts about one venue
 * that compose, lay different rows and each keep their own author's reason.
 *
 * @param {import('./types.js').ScenarioOverride} first
 * @param {import('./types.js').ScenarioOverride} second
 * @returns {boolean}
 */
function venueScopesOverlap(first, second) {
  if (first.dates === null || second.dates === null) return true;
  const covered = new Set(first.dates);
  return second.dates.some((date) => covered.has(date));
}

/**
 * Is this ancestry the parent chain the branch actually names?
 *
 * **The check the ancestry never had.** `composedOverrides()` applies whatever
 * array it is handed, parent first, so before this any non-empty array passed:
 * a stranger's overrides composed under the branch's own id and produced a
 * fingerprint that looked entirely legitimate. The chain is checked end to
 * end — outermost first, each link naming the one before it, the last naming
 * the branch's own parent — because a half-checked chain would let the second
 * ancestor be anybody.
 *
 * Returns `null` when the chain resolves, and a finding-shaped description of
 * what is wrong when it does not. It **reports rather than throws** so that
 * {@link import('./run.js').ScenarioMemo.check} — whose every other answer is a
 * finding — can answer this one the same way, while `materialiseScenario()`
 * still refuses outright.
 *
 * @param {import('./types.js').ScheduleScenario} scenario
 * @param {ReadonlyArray<import('./types.js').ScheduleScenario>} ancestry - resolved parents, outermost first
 * @returns {{ message: string, details: Record<string, unknown> }|null}
 */
export function ancestryProblem(scenario, ancestry) {
  const details = {
    scenarioId: scenario.id,
    parentScenarioId: scenario.parentScenarioId,
    ancestryIds: ancestry.map((ancestor) => ancestor.id),
  };
  if (scenario.parentScenarioId === null) {
    if (ancestry.length === 0) return null;
    return {
      message: `"${scenario.id}" names no parent, and an ancestry of ${ancestry.map((a) => `"${a.id}"`).join(', ')} was passed for it; composing edits the branch never claimed would answer a question nobody asked`,
      details,
    };
  }
  if (ancestry.length === 0) {
    return {
      message: `"${scenario.id}" names parent "${scenario.parentScenarioId}" and no ancestry was passed; its overrides cannot compose and the branch would be missing half its edits`,
      details,
    };
  }
  const nearest = ancestry[ancestry.length - 1];
  if (nearest.id !== scenario.parentScenarioId) {
    return {
      message: `"${scenario.id}" names parent "${scenario.parentScenarioId}" and the ancestry passed ends at "${nearest.id}"; the wrong parent's overrides would compose under this branch's own fingerprint`,
      details,
    };
  }
  for (let index = 0; index < ancestry.length; index += 1) {
    const expected = index === 0 ? null : ancestry[index - 1].id;
    const claimed = ancestry[index].parentScenarioId;
    if (claimed !== expected) {
      return {
        message: `the ancestry passed for "${scenario.id}" is not a chain: "${ancestry[index].id}" names parent ${claimed === null ? 'nothing' : `"${claimed}"`} where the chain puts ${expected === null ? 'nothing' : `"${expected}"`} before it`,
        details: { ...details, brokenAt: ancestry[index].id },
      };
    }
    if (ancestry[index].baselineId !== scenario.baselineId) {
      return {
        message: `the ancestry passed for "${scenario.id}" crosses baselines: "${ancestry[index].id}" branches from "${ancestry[index].baselineId}" and this branch from "${scenario.baselineId}"`,
        details: { ...details, brokenAt: ancestry[index].id },
      };
    }
  }
  return null;
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
  const misresolved = ancestryProblem(scenario, ancestry);
  if (misresolved !== null) throw new Error(`scenario: ${misresolved.message}`);

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
  /**
   * Which record ids an authored override has already claimed, **per scenario
   * that wrote one**.
   *
   * Two overrides of one author naming one record id is a contradiction: they
   * are set operations applied before anything is built, so there is no
   * consultation at which one could beat the other.
   *
   * **Keyed by the scenario that authored the override, not by the record id
   * alone** — the same treatment, and for the same reason, as
   * {@link claimedVenues} below. A child refining or superseding an edit its
   * parent wrote is ordinary composition, and it is *why* a branch may name a
   * parent; claiming the id across the composed list made the inherited edit
   * one of the two overrides, so the child's own edit was refused at blocking,
   * skipped, and the branch materialised its parent's edit while the message
   * attributed both to the child.
   *
   * @type {Map<string, import('./types.js').ScenarioOverride>}
   */
  const claimedIds = new Map();
  /**
   * The last edit each record id actually received, and who wrote it — keyed by
   * record, **across all authors**, which is the opposite of {@link claimedIds}
   * and deliberately so.
   *
   * `claimedIds` answers "may this edit apply?"; this answers "why did it find
   * what it found?". A descendant's `remove` of a record its ancestor removed
   * lands on the missing-target refusal, and a descendant's `add` of an id its
   * ancestor added lands on the collision refusal — both used to tell the
   * operator the baseline was the reason, which since the claim became per
   * author is routinely false. Derived edits count: a parent's
   * `venue-unavailable` lays blackout rows, so a child colliding with one is
   * colliding with the parent's edit.
   *
   * @type {Map<string, { author: string, op: string, reason: string }>}
   */
  const appliedTo = new Map();
  /** @type {Array<{ recordId: string, type: string, weight: number|null, override: import('./types.js').ScenarioOverride }>} */
  const retypes = [];
  /**
   * Which venues a `venue-unavailable` has already been written for, **per
   * scenario that wrote one**.
   *
   * A withdrawal is the one override kind whose edits are **derived**, and the
   * derived edits deliberately make no claim on a record id — an author naming
   * a venue whose rows another *kind* of override happens to touch is
   * composition, and round one stopped that from reporting a contradiction.
   * Two withdrawals of the *same venue over the same days written in one
   * scenario* are not that: they are one fact written twice, and the second
   * one's removes delete the first one's blackout rows before its adds put them
   * back, so nothing collides and the later author's reason silently replaces
   * the earlier author's on every row. That is provenance lost exactly the way
   * incident 9 lost a waiver, so the duplicate is claimed here, at the venue,
   * where the authorship is.
   *
   * **Keyed by the scenario that authored the override, not by the venue
   * alone.** A child branch refining or broadening a parent's withdrawal is
   * ordinary composition — it is *why* a branch may name a parent — and
   * claiming the venue across the composed list made the inherited withdrawal
   * one of the two authors: the child's own override was refused at blocking,
   * skipped, and the branch materialised its parent's narrower withdrawal while
   * the message attributed both edits to the child. Within one author's edit
   * list a second withdrawal is still the duplicate above, whichever scenario
   * in the chain wrote it.
   *
   * @type {Map<string, import('./types.js').ScenarioOverride[]>}
   */
  const claimedVenues = new Map();
  /**
   * Which scenario wrote each override, by object identity.
   *
   * @type {Map<import('./types.js').ScenarioOverride, string>}
   */
  const authorOf = new Map();
  for (const ancestor of ancestry) {
    for (const inherited of ancestor.overrides) authorOf.set(inherited, ancestor.id);
  }
  for (const own of scenario.overrides) authorOf.set(own, scenario.id);

  const working = (set) => {
    if (!rebuilt.has(set)) rebuilt.set(set, [...(base[set] ?? [])]);
    return /** @type {Array<Object>} */ (rebuilt.get(set));
  };
  /**
   * A record set as the branch has it *so far*, without forcing a rebuild.
   *
   * Reading through `working()` would copy the array on every consultation and
   * silently revoke the sharing guarantee for sets no override touches.
   */
  const current = (set) =>
    /** @type {ReadonlyArray<Object>} */ (rebuilt.get(set) ?? base[set] ?? []);

  for (const override of overrides) {
    let appliedThisOverride = 0;
    const author = authorOf.get(override) ?? scenario.id;
    if (override.kind === SCENARIO_OVERRIDE_KIND.VENUE_UNAVAILABLE) {
      const venueId = /** @type {string} */ (override.venueId);
      const venueKey = `${author}\u0000${venueId}`;
      const claimants = claimedVenues.get(venueKey) ?? [];
      const clash = claimants.find((claimed) => venueScopesOverlap(claimed, override));
      if (clash !== undefined) {
        findings.push(
          makeScenarioFinding(
            SCENARIO_REASON.SCENARIO_OVERRIDE_CONFLICT,
            `two overrides of "${author}" both withdraw venue "${venueId}" over days they share ("${clash.reason}" and "${override.reason}"); the second withdrawal writes the same blackout rows the first did, so applying it would replace one author's stated reason with the other's on every row — a contradiction to remove rather than a precedence to resolve`,
            {
              scenarioId: scenario.id,
              authoredBy: author,
              recordSet: SCENARIO_RECORD_SET.PERMITS,
              venueId,
              firstReason: clash.reason,
              secondReason: override.reason,
              firstBy: clash.by,
              secondBy: override.by,
              firstDates: clash.dates,
              secondDates: override.dates,
            }
          )
        );
        continue;
      }
      claimants.push(override);
      claimedVenues.set(venueKey, claimants);
    }
    for (const edit of primitiveEditsOf(override, current)) {
      const key = `${author}\u0000${edit.recordSet}|${edit.recordId}`;
      // A derived edit is not an authored claim on a record id. One author
      // naming one record twice is the contradiction this reports; an author
      // naming a *venue* whose rows another override happens to touch is
      // composition, and so is a child editing a record its parent edited —
      // both are answered by the set operations in order, without a precedence
      // ladder, which is why the claim is keyed by the authoring scenario.
      // A second `venue-unavailable` for the same venue is caught above, at the
      // venue — **not** here and not by SCENARIO_OVERRIDE_ID_COLLIDES, which
      // never sees it: the second withdrawal removes the first's blackout rows
      // before re-adding them, so by the time the add runs there is nothing
      // left to collide with.
      // The set operations answer every such pair **but one**: a `retype` is
      // deferred until the registry exists, so a later `remove` of the same
      // constraint leaves it nothing to write on. That pair is refused below,
      // by SCENARIO_OVERRIDE_RETYPE_WITHDRAWN, rather than composed.
      const claimed = edit.derived ? undefined : claimedIds.get(key);
      if (claimed !== undefined) {
        // Two overrides of one author, one record id. **Not a precedence
        // question**: overrides are set operations applied before anything is
        // built, so there is no consultation at which one could beat the other,
        // and inventing a fourth specificity ladder to pick a winner would be
        // exactly the parallel machinery this phase exists to avoid.
        findings.push(
          makeScenarioFinding(
            SCENARIO_REASON.SCENARIO_OVERRIDE_CONFLICT,
            `two overrides of "${author}" both touch ${edit.recordSet} record "${edit.recordId}" ("${claimed.reason}" and "${override.reason}"); overrides are set operations rather than competing scopes, so this is a contradiction to remove rather than a precedence to resolve`,
            {
              scenarioId: scenario.id,
              authoredBy: author,
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
      if (!edit.derived) claimedIds.set(key, override);

      const bucket = working(edit.recordSet);
      const index = bucket.findIndex((record) => String(record.id) === edit.recordId);
      // The last edit this record id actually received, whoever wrote it. The
      // two refusals below used to say "the baseline" whatever had happened
      // before them, and since the record-id claim became per author that is
      // routinely false: an ancestor's `remove` is why a descendant's `remove`
      // now finds nothing, and an ancestor's `add` is why a descendant's `add`
      // collides. A finding is what an operator acts on, so it names the edit
      // and the author responsible rather than pointing at a baseline that is
      // exactly as its author left it.
      const preceding = appliedTo.get(`${edit.recordSet}|${edit.recordId}`) ?? null;

      if (edit.op === SCENARIO_OVERRIDE_KIND.ADD) {
        if (index !== -1) {
          const addedBefore =
            preceding !== null && preceding.op === SCENARIO_OVERRIDE_KIND.ADD ? preceding : null;
          findings.push(
            makeScenarioFinding(
              SCENARIO_REASON.SCENARIO_OVERRIDE_ID_COLLIDES,
              `override "${override.reason}" adds ${edit.recordSet} record "${edit.recordId}", which ${addedBefore === null ? 'the baseline already holds' : `the baseline never held and "${addedBefore.author}" already added ("${addedBefore.reason}")`}; an add that silently replaced it would be a remove nobody wrote`,
              {
                scenarioId: scenario.id,
                authoredBy: author,
                recordSet: edit.recordSet,
                recordId: edit.recordId,
                precededBy: addedBefore === null ? null : addedBefore.author,
                precedingReason: addedBefore === null ? null : addedBefore.reason,
              }
            )
          );
          continue;
        }
        bucket.push(/** @type {Object} */ (edit.record));
        meta.recordsAdded += 1;
      } else if (edit.op === SCENARIO_OVERRIDE_KIND.REMOVE) {
        if (index === -1) {
          const removedBefore =
            preceding !== null && preceding.op === SCENARIO_OVERRIDE_KIND.REMOVE ? preceding : null;
          findings.push(
            makeScenarioFinding(
              SCENARIO_REASON.SCENARIO_OVERRIDE_TARGET_MISSING,
              `override "${override.reason}" withdraws ${edit.recordSet} record "${edit.recordId}", which ${removedBefore === null ? 'the baseline does not hold' : `the baseline holds and "${removedBefore.author}" already withdrew ("${removedBefore.reason}")`}; the branch models something other than what its author wrote`,
              {
                scenarioId: scenario.id,
                authoredBy: author,
                recordSet: edit.recordSet,
                recordId: edit.recordId,
                precededBy: removedBefore === null ? null : removedBefore.author,
                precedingReason: removedBefore === null ? null : removedBefore.reason,
              }
            )
          );
          continue;
        }
        // **A queued retype is not something a withdrawal can compose with.**
        // `retypeConstraint()` writes the change into the record's own history
        // and runs after the registry is built, so a record withdrawn under it
        // left `requireConstraint()` throwing out of a function whose whole
        // contract is to report — the crash the record-id claim's relaxation
        // unmasked. The withdrawal is refused rather than the retype dropped:
        // every other refusal in this loop reports and skips *before* anything
        // is applied, which is what keeps each `SCENARIO_OVERRIDE_APPLIED` true
        // and the counters honest. Dropping the retype afterwards would leave
        // an `applied` finding standing for an edit that never landed, which is
        // the same misdirection the two messages above just stopped doing.
        const queued =
          edit.recordSet === SCENARIO_RECORD_SET.CONSTRAINTS
            ? retypes.find((entry) => entry.recordId === edit.recordId)
            : undefined;
        if (queued !== undefined) {
          const retypedBy = authorOf.get(queued.override) ?? scenario.id;
          findings.push(
            makeScenarioFinding(
              SCENARIO_REASON.SCENARIO_OVERRIDE_RETYPE_WITHDRAWN,
              `override "${override.reason}" withdraws constraint "${edit.recordId}", which "${retypedBy}" retypes to "${queued.type}" ("${queued.override.reason}"); a hardness change is written into the record's own history, so there is nowhere to write it once the record is gone, and "this rule is a preference" and "this rule does not exist" are two different seasons rather than one refined by the other — the withdrawal is refused, and one of the two edits has to go`,
              {
                scenarioId: scenario.id,
                authoredBy: author,
                recordSet: edit.recordSet,
                recordId: edit.recordId,
                retypedBy,
                retypeReason: queued.override.reason,
                retypeType: queued.type,
              }
            )
          );
          continue;
        }
        bucket.splice(index, 1);
        meta.recordsRemoved += 1;
      } else if (edit.op === SCENARIO_OVERRIDE_KIND.RETYPE) {
        if (index === -1) {
          const removedBefore =
            preceding !== null && preceding.op === SCENARIO_OVERRIDE_KIND.REMOVE ? preceding : null;
          findings.push(
            makeScenarioFinding(
              SCENARIO_REASON.SCENARIO_OVERRIDE_TARGET_MISSING,
              `override "${override.reason}" retypes constraint "${edit.recordId}", which ${removedBefore === null ? 'the registry does not hold' : `"${removedBefore.author}" withdrew ("${removedBefore.reason}")`}`,
              {
                scenarioId: scenario.id,
                authoredBy: author,
                recordSet: edit.recordSet,
                recordId: edit.recordId,
                precededBy: removedBefore === null ? null : removedBefore.author,
                precedingReason: removedBefore === null ? null : removedBefore.reason,
              }
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

      appliedTo.set(`${edit.recordSet}|${edit.recordId}`, {
        author,
        op: edit.op,
        reason: override.reason,
      });
      meta.recordEditsApplied += 1;
      appliedThisOverride += 1;
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
    // **One override is one override**, however many primitive edits it becomes.
    // Counting the edits here put "17 applied against 1 declared" in the vacuity
    // finding's own details, which reads as a bug in the materialiser rather
    // than as one `venue-unavailable` doing what it is for.
    if (appliedThisOverride > 0) meta.overridesApplied += 1;
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
