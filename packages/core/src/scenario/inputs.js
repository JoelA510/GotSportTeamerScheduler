/**
 * `SeasonInputs`: **one immutable bundle per baseline**, and the digest over it.
 *
 * The distinction this file exists to hold is between an *input* and an
 * *engine*. `buildFacilityGraph()`, `buildAvailabilityCalendar()` and
 * `buildConstraintRegistry()` are pure functions of the record arrays below, so
 * a scenario re-derives its engines from `base ∪ overrides` rather than
 * mutating a graph, a calendar or a registry that a sibling scenario can see.
 *
 * That is what makes *"scenarios must share the fixture and constraint
 * definitions — a constraint fix must not need applying five times"* structural
 * rather than a promise. A record set no override touches is carried through to
 * every branch **by reference**, and `meta.recordSetsShared` counts it, so the
 * sharing is a number a test can falsify rather than a sentence in a docstring.
 *
 * ## The digest
 *
 * {@link seasonInputsDigest} is `publication/snapshot.js`'s
 * {@link import('../publication/snapshot.js').publicationDigest} over a
 * canonical rendering of the record arrays. It is the digest this repository
 * already has, not a second one, and it carries the same honest caveat: FNV-1a
 * is not cryptographic, it catches the accident rather than the forgery.
 *
 * @module scenario/inputs
 */

import { publicationDigest } from '../publication/snapshot.js';

import { SCENARIO_RECORD_SET } from './reasonCodes.js';

/** The override-able record sets a bundle carries, in a fixed order. */
export const SCENARIO_RECORD_SET_ORDER = Object.freeze([
  SCENARIO_RECORD_SET.PERMITS,
  SCENARIO_RECORD_SET.LIGHTING,
  SCENARIO_RECORD_SET.EQUIPMENT,
  SCENARIO_RECORD_SET.CONSTRAINTS,
  SCENARIO_RECORD_SET.WAIVERS,
  SCENARIO_RECORD_SET.RESERVED_SLOTS,
]);

/**
 * Everything the digest covers, in a fixed order.
 *
 * Wider than {@link SCENARIO_RECORD_SET_ORDER} on purpose. The six sets above
 * are what an *override* may edit; these are everything a branch's answer
 * depends on, and a fingerprint that covered only the first would serve a
 * cached result after the facility geometry underneath it had changed.
 */
export const SCENARIO_DIGEST_ORDER = Object.freeze([
  'facilityInput',
  'timingInput',
  ...SCENARIO_RECORD_SET_ORDER,
  'sunsets',
]);

/** The digest's column vocabulary: what a record is, and what it says. */
const DIGEST_COLUMNS = Object.freeze(['recordSet', 'index', 'canonical']);

/**
 * A value rendered with its object keys in a fixed order.
 *
 * Two records that differ only in the order their keys were inserted are the
 * same record, and a digest that disagreed would report drift on every rebuild.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(/** @type {Record<string, unknown>} */ (value))
    .filter(([, inner]) => inner !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(',')}}`;
}

/**
 * A content digest over a set of named record arrays.
 *
 * **Deliberately over the records and nothing else.** Not over a `label`, not
 * over a `createdAt`, not over anything else that travels with a bundle: a
 * fingerprint that included metadata would derive a check's subject from data
 * the corruption it detects would also change.
 *
 * @param {Record<string, ReadonlyArray<Object>>} records
 * @param {ReadonlyArray<string>} [order] - which sets, in which order
 * @returns {string} 16 lowercase hex characters
 */
export function recordDigest(records, order = SCENARIO_DIGEST_ORDER) {
  /** @type {Record<string, string>[]} */
  const rows = [];
  for (const set of order) {
    const bucket = records[set] ?? [];
    bucket.forEach((record, index) => {
      rows.push({ recordSet: set, index: String(index), canonical: canonicalJson(record) });
    });
  }
  return publicationDigest(DIGEST_COLUMNS, rows);
}

/**
 * The digest of a baseline bundle.
 *
 * @param {import('./types.js').SeasonInputs} inputs
 * @returns {string}
 */
export function seasonInputsDigest(inputs) {
  return recordDigest(digestSubjectOf(inputs));
}

/**
 * Everything {@link seasonInputsDigest} reads, by name.
 *
 * @param {import('./types.js').SeasonInputs} inputs
 * @returns {Record<string, ReadonlyArray<Object>>}
 */
export function digestSubjectOf(inputs) {
  return {
    ...recordsOf(inputs),
    facilityInput: [inputs.facilityInput],
    timingInput: [inputs.timingInput],
    sunsets: inputs.sunsets,
  };
}

/**
 * The record arrays a bundle carries, by set name.
 *
 * @param {import('./types.js').SeasonInputs} inputs
 * @returns {Record<string, ReadonlyArray<Object>>}
 */
export function recordsOf(inputs) {
  return {
    [SCENARIO_RECORD_SET.PERMITS]: inputs.permits,
    [SCENARIO_RECORD_SET.LIGHTING]: inputs.lighting,
    [SCENARIO_RECORD_SET.EQUIPMENT]: inputs.equipment,
    [SCENARIO_RECORD_SET.CONSTRAINTS]: inputs.constraints,
    [SCENARIO_RECORD_SET.WAIVERS]: inputs.waivers,
    [SCENARIO_RECORD_SET.RESERVED_SLOTS]: inputs.reservedSlots,
  };
}

/**
 * Refuse an array that is not one, naming the field.
 *
 * @param {unknown} value
 * @param {string} field
 * @returns {ReadonlyArray<Object>}
 */
function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(
      `scenario: makeSeasonInputs() needs ${field} as an array; an absent record set is not an empty one, and a branch built over a set nobody supplied would report every record in it withdrawn`
    );
  }
  return /** @type {ReadonlyArray<Object>} */ (value);
}

/**
 * Assemble one immutable baseline bundle.
 *
 * **Only the top level is frozen, and the record arrays are frozen shells over
 * the caller's own objects.** That is deliberate and it is the point of the
 * sharing guarantee: a correction made to a constraint record in this bundle is
 * seen by every scenario built over it, because every scenario reads the same
 * object. Deep-freezing here would turn "one fix, five branches" back into
 * "rebuild the bundle and re-materialise five branches".
 *
 * The schedule is **not** parsed here. `ScheduleSchema` is the rule engine's
 * and `applyChangeRequest()` parses it on the way in; a second parse would be a
 * second reading of the same rows, free to disagree with the first.
 *
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.label
 * @param {import('../ruleEngine/types.js').Schedule} input.schedule
 * @param {Object} input.facilityInput
 * @param {Object} input.timingInput
 * @param {ReadonlyArray<Object>} input.permits
 * @param {ReadonlyArray<Object>} input.sunsets
 * @param {ReadonlyArray<Object>} [input.lighting]
 * @param {ReadonlyArray<Object>} [input.equipment]
 * @param {ReadonlyArray<Object>} input.constraints
 * @param {ReadonlyArray<Object>} [input.waivers]
 * @param {ReadonlyArray<Object>} [input.reservedSlots]
 * @param {{ name: string, source?: string|null }} input.registry
 * @param {{ sunsetMarginMinutes: number, permitMarginMinutes: number, source?: string|null }} input.calendarOptions
 * @param {Object} [input.venueComplexes]
 * @returns {import('./types.js').SeasonInputs}
 */
export function makeSeasonInputs(input) {
  if (!input || typeof input.id !== 'string' || input.id.length === 0) {
    throw new Error('scenario: a baseline bundle must carry an id');
  }
  if (!input.schedule || !Array.isArray(input.schedule.games)) {
    throw new Error('scenario: a baseline bundle must carry the schedule it is the inputs to');
  }
  if (input.schedule.games.length === 0) {
    throw new Error(
      'scenario: a baseline bundle over a schedule with no games would make every branch of it true of nothing (incident 4)'
    );
  }
  if (!input.facilityInput || !Array.isArray(input.facilityInput.surfaces)) {
    throw new Error(
      'scenario: a baseline bundle needs the facility graph *input*, not a built graph; a scenario re-derives the graph and cannot re-derive one from an object that has already been built'
    );
  }
  if (!input.timingInput || !Array.isArray(input.timingInput.formats)) {
    throw new Error(
      'scenario: a baseline bundle needs the format timing *input*, not a built table, for the same reason it needs the facility graph input'
    );
  }
  if (Object.hasOwn(input.facilityInput, 'equipmentWindows')) {
    // The equipment windows are a record set a scenario overrides — "the 9v9
    // goals are not at Alder on 08/22" is one of the three branches the build
    // plan names — so they live beside the other record arrays and are folded
    // back into the graph input by the materialiser. Two homes for one set is
    // how one of them gets edited and the other one used.
    throw new Error(
      'scenario: pass equipment windows as `equipment`, not inside `facilityInput.equipmentWindows`; they are a record set overrides edit and the materialiser folds them back in'
    );
  }

  const bundle = {
    id: input.id,
    label: input.label ?? input.id,
    schedule: input.schedule,
    facilityInput: input.facilityInput,
    timingInput: input.timingInput,
    permits: requireArray(input.permits, 'permits'),
    sunsets: requireArray(input.sunsets, 'sunsets'),
    lighting: requireArray(input.lighting ?? [], 'lighting'),
    equipment: requireArray(input.equipment ?? [], 'equipment'),
    constraints: requireArray(input.constraints, 'constraints'),
    waivers: requireArray(input.waivers ?? [], 'waivers'),
    reservedSlots: requireArray(input.reservedSlots ?? [], 'reservedSlots'),
    registry: Object.freeze({ name: input.registry.name, source: input.registry.source ?? null }),
    calendarOptions: Object.freeze({
      sunsetMarginMinutes: input.calendarOptions.sunsetMarginMinutes,
      permitMarginMinutes: input.calendarOptions.permitMarginMinutes,
      source: input.calendarOptions.source ?? null,
    }),
    venueComplexes: input.venueComplexes ?? {},
    digest: '',
  };
  bundle.digest = recordDigest(
    digestSubjectOf(/** @type {import('./types.js').SeasonInputs} */ (bundle))
  );
  return /** @type {import('./types.js').SeasonInputs} */ (Object.freeze(bundle));
}

/**
 * The same bundle with one record set replaced.
 *
 * Used by `promoteScenario()` to build the new primary out of the branch's own
 * effective arrays, and by nothing else. Every set the promotion does not
 * replace is carried through by reference, so promotion preserves the sharing
 * rather than forking it.
 *
 * @param {import('./types.js').SeasonInputs} inputs
 * @param {Record<string, ReadonlyArray<Object>>} records
 * @param {{ id: string, label: string, schedule?: import('../ruleEngine/types.js').Schedule }} identity
 * @returns {import('./types.js').SeasonInputs}
 */
export function withRecords(inputs, records, identity) {
  return makeSeasonInputs({
    ...inputs,
    id: identity.id,
    label: identity.label,
    schedule: identity.schedule ?? inputs.schedule,
    permits: records[SCENARIO_RECORD_SET.PERMITS] ?? inputs.permits,
    lighting: records[SCENARIO_RECORD_SET.LIGHTING] ?? inputs.lighting,
    equipment: records[SCENARIO_RECORD_SET.EQUIPMENT] ?? inputs.equipment,
    constraints: records[SCENARIO_RECORD_SET.CONSTRAINTS] ?? inputs.constraints,
    waivers: records[SCENARIO_RECORD_SET.WAIVERS] ?? inputs.waivers,
    reservedSlots: records[SCENARIO_RECORD_SET.RESERVED_SLOTS] ?? inputs.reservedSlots,
  });
}
